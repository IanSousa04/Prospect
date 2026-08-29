import { avaliarRiscoCriarPedido, criarPedidoComItens } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";
import {
  carregarPedidoEmConstrucao,
  salvarPedidoEmConstrucao,
  carregarConfirmacaoPendente,
  salvarConfirmacaoPendente,
  carregarUltimoPedidoCriado,
  salvarUltimoPedidoCriado,
} from "../agent/sessao.js";
import { calcularSubtotal, pedidoVazio, calcularHashConfirmacao } from "../agent/pedido-contexto.js";
import { validarPreRequisitosDeCriacao } from "../agent/checkout/validacao-criacao.js";

interface PedidoIdInput {
  pedido_id?: string;
}

/**
 * Resolve qual pedido consultar: se `pedidoId` for informado, só é aceito
 * se pertencer ao MESMO cliente e empresa desta conversa (nunca confia num
 * ID solto vindo do LLM/cliente — impede um cliente consultar o pedido de
 * outro só adivinhando/inventando um UUID). Sem `pedidoId`, cai pro pedido
 * mais recente não cancelado deste atendimento.
 */
async function resolverPedidoId(ctx: ToolContext, pedidoId: string | undefined): Promise<string | null> {
  if (pedidoId) {
    const { data } = await supabaseAdmin
      .from("pedidos")
      .select("id")
      .eq("id", pedidoId)
      .eq("cliente_id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    return data?.id ?? null;
  }

  const { data } = await supabaseAdmin
    .from("pedidos")
    .select("id")
    .eq("atendimento_id", ctx.atendimentoId)
    .eq("empresa_id", ctx.empresaId)
    .neq("status", "cancelado")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

registerTool({
  nome: "consultar_pedido",
  descricao:
    "Consulta os detalhes completos (itens, personalizações, total, status, pagamento) do pedido atual desta conversa, ou de um pedido específico do próprio cliente.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      pedido_id: { type: "string", description: "Opcional — se omitido, usa o pedido mais recente desta conversa." },
    },
  },
  risco: "baixo",
  executor: async (input: PedidoIdInput, ctx: ToolContext) => {
    const pedidoId = await resolverPedidoId(ctx, input.pedido_id);
    if (!pedidoId) return { erro: "pedido_nao_encontrado" };

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select(
        "status, tipo_entrega, taxa_entrega, forma_pagamento, status_pagamento, subtotal, total, criado_em, itens:itens_pedido(nome_produto, quantidade, preco_unitario, opcoes:itens_pedido_opcoes(nome_opcao, preco_adicional))",
      )
      .eq("id", pedidoId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();

    if (error) throw new Error(`erro_ao_consultar_pedido: ${error.message}`);
    if (!data) return { erro: "pedido_nao_encontrado" };
    return data;
  },
});

registerTool({
  nome: "consultar_status",
  descricao: "Consulta só o status atual do pedido desta conversa (mais leve que consultar_pedido) — use para 'cadê meu pedido'.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      pedido_id: { type: "string", description: "Opcional — se omitido, usa o pedido mais recente desta conversa." },
    },
  },
  risco: "baixo",
  executor: async (input: PedidoIdInput, ctx: ToolContext) => {
    const pedidoId = await resolverPedidoId(ctx, input.pedido_id);
    if (!pedidoId) return { erro: "pedido_nao_encontrado" };

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select("status, total, criado_em")
      .eq("id", pedidoId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();

    if (error) throw new Error(`erro_ao_consultar_status: ${error.message}`);
    if (!data) return { erro: "pedido_nao_encontrado" };
    return data;
  },
});

registerTool({
  nome: "criar_pedido",
  descricao:
    "Confirma e cria de verdade o pedido a partir do carrinho desta conversa. AÇÃO IRREVERSÍVEL COM IMPACTO FINANCEIRO REAL (CLAUDE.md regra 6). SOMENTE WORKFLOW (tarefa 0081): só agent/checkout/transicoes.ts pode chamar, depois de validar deterministicamente a confirmação do cliente — nunca é oferecida ao LLM.",
  parametrosJsonSchema: { type: "object", properties: {} },
  risco: "alto",
  somenteWorkflow: true,
  executor: async (_input: unknown, ctx: ToolContext) => {
    const [pedido, confirmacaoPendente, ultimoPedidoCriado] = await Promise.all([
      carregarPedidoEmConstrucao(ctx),
      carregarConfirmacaoPendente(ctx),
      carregarUltimoPedidoCriado(ctx),
    ]);

    // Toda a validação de pré-requisito vive numa função pura (tarefa 0081,
    // agent/checkout/validacao-criacao.ts) — a mesma regra que o gabarito
    // determinístico exercita, sem cópia paralela que possa divergir.
    const validacao = validarPreRequisitosDeCriacao({
      pedido,
      confirmacao: confirmacaoPendente,
      ultimoPedidoCriado,
      config: ctx.fluxoPedido,
    });

    if (validacao.situacao === "ja_criado") {
      return { pedido_criado: true, pedido_id: validacao.pedido_id, idempotente: true };
    }
    if (validacao.situacao === "recusado") {
      return validacao.pendencias
        ? { erro: validacao.motivo, pendencias: validacao.pendencias }
        : { erro: validacao.motivo };
    }

    // Gate de risco real (campos de `ia_permissoes` que existiam desde a
    // migration 0010 mas nunca eram lidos em lugar nenhum — ver tarefa
    // 0023, "risco real na matriz de decisão", ainda pendente pra tools
    // genéricas; aqui, na ação mais crítica de todas, o gate já entra
    // agora). Ausência de configuração = permissivo (mesmo padrão de
    // `comportamento_json`) — só limite/exigência EXPLICITAMENTE
    // configurados pela empresa bloqueiam a criação automática.
    const permissao = ctx.permissoes.get("criar_pedido");
    const total = calcularSubtotal(pedido.itens); // taxa de entrega ainda não é calculada (fora de escopo desta tarefa)
    const risco = avaliarRiscoCriarPedido(permissao, total);

    if (risco.bloqueado) {
      return { erro: "confirmacao_humana_necessaria", motivo: risco.motivo, total };
    }

    const resultado = await criarPedidoComItens(supabaseAdmin, {
      empresaId: ctx.empresaId,
      clienteId: ctx.clienteId,
      atendimentoId: ctx.atendimentoId,
      origem: "ia",
      tipoEntrega: pedido.tipo_entrega!,
      enderecoJson: pedido.endereco,
      taxaEntrega: 0,
      formaPagamento: pedido.forma_pagamento,
      observacoes: null,
      itens: pedido.itens.map((item) => ({
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        observacoes: item.observacoes,
        opcoes: item.opcoes.map((o) => ({ opcao_id: o.opcao_id })),
      })),
    });

    if (!resultado.ok) return { erro: resultado.erro };

    // Grava a evidência ANTES de resetar o carrinho: se o processo morrer
    // no meio, é melhor sobrar um ponteiro pra um pedido real do que perder
    // o registro de que ele existe (é ele que impede uma segunda criação e
    // que mantém o estado `pedido_criado` depois do reset).
    await salvarUltimoPedidoCriado(ctx, {
      pedido_id: resultado.pedido.id,
      hash: calcularHashConfirmacao(pedido),
      criado_em: new Date().toISOString(),
    });
    // Reseta o Order Context desta conversa — o pedido confirmado agora
    // vive em `pedidos`/`itens_pedido` (fonte real, já visível no painel
    // "Pedido" existente); um pedido novo na mesma conversa começa do zero.
    await salvarPedidoEmConstrucao(ctx, pedidoVazio());
    // Limpa a confirmação usada — nunca deixa um hash "gasto" disponível
    // pra ser reaproveitado por engano numa chamada futura.
    await salvarConfirmacaoPendente(ctx, undefined);

    // Devolve o resumo completo (não só id/total) — a mensagem de
    // confirmação pro cliente é montada em código a partir DESTE retorno
    // (ver agent/confirmacao-pedido.ts), nunca escrita livre pelo Atendente,
    // então precisa ter tudo que aparece nela: itens, entrega, pagamento.
    return {
      pedido_criado: true,
      pedido_id: resultado.pedido.id,
      total: resultado.pedido.total,
      itens: pedido.itens.map((item) => ({ nome_produto: item.nome_produto, quantidade: item.quantidade })),
      tipo_entrega: pedido.tipo_entrega,
      endereco: pedido.endereco,
      forma_pagamento: pedido.forma_pagamento,
    };
  },
});
