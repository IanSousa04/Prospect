import { avaliarRiscoCriarPedido, criarPedidoComItens } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";
import { carregarPedidoEmConstrucao, salvarPedidoEmConstrucao } from "../agent/sessao.js";
import { calcularSubtotal, informacoesPendentes, pedidoVazio } from "../agent/pedido-contexto.js";

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
    "Confirma e cria de verdade o pedido a partir do carrinho desta conversa. AÇÃO IRREVERSÍVEL COM IMPACTO FINANCEIRO REAL (CLAUDE.md regra 6) — só chame depois que o cliente confirmar explicitamente o resumo final (ex.: 'pode confirmar', 'é isso mesmo', 'fechar assim'). 'Quero mais um X' ou qualquer pedido de item NUNCA é confirmação — isso é adicionar_ao_carrinho, não criar_pedido. Nunca chame se a mensagem do cliente for ambígua sobre o que está confirmando.",
  parametrosJsonSchema: { type: "object", properties: {} },
  risco: "alto",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    const pendencias = informacoesPendentes(pedido);

    // Só a confirmação final pode faltar — carrinho, entrega e pagamento
    // já precisam estar todos resolvidos (CLAUDE.md regra 6: nunca
    // finalizar com informação incompleta).
    if (pendencias.length !== 1 || pendencias[0] !== "confirmacao_final") {
      return { erro: "pedido_incompleto", pendencias };
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

    // Reseta o Order Context desta conversa — o pedido confirmado agora
    // vive em `pedidos`/`itens_pedido` (fonte real, já visível no painel
    // "Pedido" existente); um pedido novo na mesma conversa começa do zero.
    await salvarPedidoEmConstrucao(ctx, pedidoVazio());

    return { pedido_criado: true, pedido_id: resultado.pedido.id, total: resultado.pedido.total };
  },
});
