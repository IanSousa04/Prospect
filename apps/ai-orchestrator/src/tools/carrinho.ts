// Tools de carrinho — mutam o Order Context ("pedido em construção",
// apps/ai-orchestrator/src/agent/pedido-contexto.ts, tarefa 0053) guardado
// em `ia_sessoes.estado_json.pedido`. Nenhuma cria um pedido real em
// `pedidos`/`itens_pedido` — isso é a confirmação explícita da tarefa 0055.
//
// Decisão de escopo: 4 tools registradas, não 5 — `consultar_carrinho` já
// devolve o subtotal calculado (`calcularSubtotal`), então não existe uma
// tool separada equivalente a "calculate_cart" do desenho original (0017):
// nunca faria sentido o LLM chamar "calcule o carrinho" sem também querer
// ver os itens, então são a mesma chamada.
//
// O LLM nunca monta o item sozinho: toda adição/atualização passa por
// `montarItensComSnapshot` (packages/pedidos-core), a mesma função usada por
// `POST /pedidos` — preço, nome e disponibilidade sempre vêm do catálogo
// real no momento da chamada (CLAUDE.md regra 1), nunca do que o modelo
// "lembra" de uma busca anterior.
import { randomUUID } from "node:crypto";
import { montarItensComSnapshot } from "@prospect/pedidos-core";
import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";
import { carregarPedidoEmConstrucao, salvarPedidoEmConstrucao } from "../agent/sessao.js";
import {
  aplicarMutacaoCarrinho,
  encontrarLinhaEquivalente,
  resumoPedidoIa,
  type ItemCarrinho,
} from "../agent/pedido-contexto.js";
import type { EnderecoEntrega, FormaPagamento, TipoEntrega } from "@prospect/shared";

interface OpcaoInput {
  opcao_id: string;
}

registerTool({
  nome: "adicionar_ao_carrinho",
  descricao:
    "Adiciona um produto/combo ao carrinho do pedido em construção desta conversa. Use o produto_id exato de uma busca real (buscar_produtos/buscar_combos) — nunca invente um id. Sempre revalida preço e disponibilidade no catálogo no momento da chamada.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      produto_id: { type: "string", description: "ID do produto/combo, obtido via buscar_produtos/buscar_combos." },
      quantidade: { type: "integer", minimum: 1 },
      observacoes: { type: "string", description: "Observação do cliente pra este item (ex.: 'sem cebola') — opcional." },
      opcoes: {
        type: "array",
        description: "Opções escolhidas (adicionais, sabores etc.) — ids obtidos via buscar_opcoes/buscar_adicionais.",
        items: { type: "object", properties: { opcao_id: { type: "string" } }, required: ["opcao_id"] },
      },
    },
    required: ["produto_id", "quantidade"],
  },
  risco: "baixo",
  executor: async (
    input: { produto_id: string; quantidade: number; observacoes?: string | null; opcoes?: OpcaoInput[] },
    ctx: ToolContext,
  ) => {
    const observacoes = input.observacoes ?? null;
    const opcoes = input.opcoes ?? [];
    const pedido = await carregarPedidoEmConstrucao(ctx);

    // Mesmo produto + mesmas opções + mesma observação já no carrinho —
    // soma na linha existente em vez de duplicar (ver encontrarLinhaEquivalente).
    const linhaExistente = encontrarLinhaEquivalente(
      pedido.itens,
      input.produto_id,
      observacoes,
      opcoes.map((o) => o.opcao_id),
    );
    const quantidadeFinal = (linhaExistente?.quantidade ?? 0) + input.quantidade;

    const montagem = await montarItensComSnapshot(
      supabaseAdmin,
      [{ produto_id: input.produto_id, quantidade: quantidadeFinal, observacoes, opcoes }],
      ctx.empresaId,
    );
    if (!montagem.ok) return { erro: montagem.erro };

    const itemAtualizado: ItemCarrinho = {
      ...montagem.itens[0]!,
      linha_id: linhaExistente?.linha_id ?? randomUUID(),
    };
    const novosItens = linhaExistente
      ? pedido.itens.map((item) => (item.linha_id === linhaExistente.linha_id ? itemAtualizado : item))
      : [...pedido.itens, itemAtualizado];

    const atualizado = aplicarMutacaoCarrinho(pedido, novosItens);
    await salvarPedidoEmConstrucao(ctx, atualizado);

    return resumoPedidoIa(atualizado);
  },
});

registerTool({
  nome: "remover_do_carrinho",
  descricao: "Remove uma linha do carrinho do pedido em construção, pelo linha_id devolvido por consultar_carrinho ou por uma adição anterior.",
  parametrosJsonSchema: {
    type: "object",
    properties: { linha_id: { type: "string" } },
    required: ["linha_id"],
  },
  risco: "baixo",
  executor: async (input: { linha_id: string }, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    if (!pedido.itens.some((item) => item.linha_id === input.linha_id)) {
      return { erro: "linha_nao_encontrada" };
    }

    const novosItens = pedido.itens.filter((item) => item.linha_id !== input.linha_id);
    const atualizado = aplicarMutacaoCarrinho(pedido, novosItens);
    await salvarPedidoEmConstrucao(ctx, atualizado);

    return resumoPedidoIa(atualizado);
  },
});

registerTool({
  nome: "atualizar_item_carrinho",
  descricao:
    "Muda a quantidade e/ou observação de uma linha já existente no carrinho, pelo linha_id. Revalida preço/disponibilidade no catálogo — não é só editar um número.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      linha_id: { type: "string" },
      quantidade: { type: "integer", minimum: 1, description: "Nova quantidade — omitir mantém a atual." },
      observacoes: { type: "string", description: "Nova observação — omitir mantém a atual." },
    },
    required: ["linha_id"],
  },
  risco: "baixo",
  executor: async (input: { linha_id: string; quantidade?: number; observacoes?: string | null }, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    const itemAtual = pedido.itens.find((item) => item.linha_id === input.linha_id);
    if (!itemAtual) return { erro: "linha_nao_encontrada" };

    const montagem = await montarItensComSnapshot(
      supabaseAdmin,
      [
        {
          produto_id: itemAtual.produto_id,
          quantidade: input.quantidade ?? itemAtual.quantidade,
          observacoes: input.observacoes !== undefined ? input.observacoes : itemAtual.observacoes,
          opcoes: itemAtual.opcoes.map((o) => ({ opcao_id: o.opcao_id })),
        },
      ],
      ctx.empresaId,
    );
    if (!montagem.ok) return { erro: montagem.erro };

    const itemAtualizado: ItemCarrinho = { ...montagem.itens[0]!, linha_id: input.linha_id };
    const novosItens = pedido.itens.map((item) => (item.linha_id === input.linha_id ? itemAtualizado : item));
    const atualizado = aplicarMutacaoCarrinho(pedido, novosItens);
    await salvarPedidoEmConstrucao(ctx, atualizado);

    return resumoPedidoIa(atualizado);
  },
});

registerTool({
  nome: "definir_tipo_entrega",
  descricao:
    "Define se o pedido é para entrega ou retirada no local, depois de perguntar ao cliente — nunca escolha sozinho. Escolher 'retirada' limpa qualquer endereço já salvo neste pedido (não se aplica).",
  parametrosJsonSchema: {
    type: "object",
    properties: { tipo_entrega: { type: "string", enum: ["entrega", "retirada"] } },
    required: ["tipo_entrega"],
  },
  risco: "baixo",
  executor: async (input: { tipo_entrega: TipoEntrega }, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    const atualizado = {
      ...pedido,
      tipo_entrega: input.tipo_entrega,
      endereco: input.tipo_entrega === "retirada" ? null : pedido.endereco,
      carrinho_confirmado: false,
    };
    await salvarPedidoEmConstrucao(ctx, atualizado);
    return resumoPedidoIa(atualizado);
  },
});

registerTool({
  nome: "definir_endereco_entrega",
  descricao:
    "Define o endereço de entrega deste pedido — implica tipo de entrega 'entrega' (nunca chame pra retirada). Sempre chame depois de o cliente confirmar/informar o endereço, nunca antes (se ele já tem endereço salvo em consultar_cliente, confirme reuso primeiro em vez de pedir tudo de novo). Salva como o endereço padrão do cliente pra próxima conversa.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      rua: { type: "string" },
      numero: { type: "string" },
      complemento: { type: "string" },
      bairro: { type: "string" },
      cidade: { type: "string" },
      referencia: { type: "string" },
    },
    required: ["rua", "numero", "bairro", "cidade"],
  },
  risco: "baixo",
  executor: async (input: EnderecoEntrega, ctx: ToolContext) => {
    const endereco: EnderecoEntrega = {
      rua: input.rua,
      numero: input.numero,
      complemento: input.complemento,
      bairro: input.bairro,
      cidade: input.cidade,
      referencia: input.referencia,
    };

    const pedido = await carregarPedidoEmConstrucao(ctx);
    const atualizado = { ...pedido, tipo_entrega: "entrega" as TipoEntrega, endereco, carrinho_confirmado: false };
    await salvarPedidoEmConstrucao(ctx, atualizado);

    // Salva como endereço padrão do cliente pra reuso na próxima conversa
    // (tarefa 0020) — não falha a resposta se isso der erro, o pedido atual
    // já foi salvo com sucesso, que é o que importa agora.
    const { error: erroCliente } = await supabaseAdmin
      .from("clientes")
      .update({ endereco_json: endereco })
      .eq("id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId);
    if (erroCliente) console.error("[ai-orchestrator] falha ao salvar endereço padrão do cliente:", erroCliente);

    return resumoPedidoIa(atualizado);
  },
});

registerTool({
  nome: "definir_forma_pagamento",
  descricao:
    "Registra a forma de pagamento escolhida pelo cliente pra este pedido — pergunte antes de chamar, nunca escolha sozinho. Não existe cobrança real ainda, é só registrar a escolha.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      forma_pagamento: { type: "string", enum: ["dinheiro", "cartao_credito", "cartao_debito", "pix", "outro"] },
    },
    required: ["forma_pagamento"],
  },
  risco: "baixo",
  executor: async (input: { forma_pagamento: FormaPagamento }, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    const atualizado = { ...pedido, forma_pagamento: input.forma_pagamento, carrinho_confirmado: false };
    await salvarPedidoEmConstrucao(ctx, atualizado);
    return resumoPedidoIa(atualizado);
  },
});

registerTool({
  nome: "consultar_carrinho",
  descricao: "Consulta o estado atual do carrinho do pedido em construção desta conversa (itens, subtotal, o que ainda falta pra fechar o pedido).",
  parametrosJsonSchema: { type: "object", properties: {} },
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    return resumoPedidoIa(pedido);
  },
});
