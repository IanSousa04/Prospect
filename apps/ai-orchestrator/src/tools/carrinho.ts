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
import { aplicarMutacaoCarrinho, calcularSubtotal, informacoesPendentes, type ItemCarrinho, type OrderContext } from "../agent/pedido-contexto.js";

interface OpcaoInput {
  opcao_id: string;
}

/** Resumo devolvido por toda tool de carrinho — o Investigador usa isso
 * como evidência real pra afirmar o estado atual ao Atendente (nunca o
 * LLM "lembrando" o carrinho por conta própria). */
function resumoCarrinho(pedido: OrderContext) {
  return {
    itens: pedido.itens.map((item) => ({
      linha_id: item.linha_id,
      produto_id: item.produto_id,
      nome_produto: item.nome_produto,
      quantidade: item.quantidade,
      preco_unitario: item.preco_unitario,
      observacoes: item.observacoes,
      opcoes: item.opcoes,
    })),
    subtotal: calcularSubtotal(pedido.itens),
    carrinho_confirmado: pedido.carrinho_confirmado,
    pendencias: informacoesPendentes(pedido),
  };
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
    const montagem = await montarItensComSnapshot(
      supabaseAdmin,
      [
        {
          produto_id: input.produto_id,
          quantidade: input.quantidade,
          observacoes: input.observacoes ?? null,
          opcoes: input.opcoes ?? [],
        },
      ],
      ctx.empresaId,
    );
    if (!montagem.ok) return { erro: montagem.erro };

    const novoItem: ItemCarrinho = { ...montagem.itens[0]!, linha_id: randomUUID() };
    const pedido = await carregarPedidoEmConstrucao(ctx);
    const atualizado = aplicarMutacaoCarrinho(pedido, [...pedido.itens, novoItem]);
    await salvarPedidoEmConstrucao(ctx, atualizado);

    return resumoCarrinho(atualizado);
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

    return resumoCarrinho(atualizado);
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

    return resumoCarrinho(atualizado);
  },
});

registerTool({
  nome: "consultar_carrinho",
  descricao: "Consulta o estado atual do carrinho do pedido em construção desta conversa (itens, subtotal, o que ainda falta pra fechar o pedido).",
  parametrosJsonSchema: { type: "object", properties: {} },
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const pedido = await carregarPedidoEmConstrucao(ctx);
    return resumoCarrinho(pedido);
  },
});
