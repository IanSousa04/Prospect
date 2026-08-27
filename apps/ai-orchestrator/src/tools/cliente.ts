import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

// Nenhuma destas tools aceita um `cliente_id` de parâmetro — sempre usa
// `ctx.clienteId` (o cliente da própria conversa). Isso é deliberado: um
// parâmetro de cliente_id vindo do LLM seria uma superfície direta de
// extração de dado de outro cliente (R3 do plano da camada de IA — mesma
// categoria de ataque testada no Eddy).

const semParametros = { type: "object" as const, properties: {} };

/** Produto/combo com mais unidades pedidas pelo cliente entre os pedidos
 * não cancelados — mesmo padrão de agregação por `Map` usado em
 * apps/api/src/routes/analytics.ts (produtos_mais_vendidos), aqui por
 * cliente em vez de por empresa. Calculado on-the-fly a partir de
 * `itens_pedido` (fonte real) a cada chamada — nunca persistido em
 * `clientes.preferencias_json`, pra nunca arriscar a IA citar um dado
 * desatualizado (CLAUDE.md regra 1). */
async function buscarProdutoFavorito(
  ctx: ToolContext,
): Promise<{ nome_produto: string; quantidade_pedidos: number } | null> {
  // Duas queries em vez de filtro aninhado em join — mesmo padrão de
  // apps/api/src/routes/analytics.ts (produtos_mais_vendidos).
  const { data: pedidos, error: erroPedidos } = await supabaseAdmin
    .from("pedidos")
    .select("id")
    .eq("cliente_id", ctx.clienteId)
    .eq("empresa_id", ctx.empresaId)
    .neq("status", "cancelado");

  if (erroPedidos) throw new Error(`erro_ao_consultar_produto_favorito: ${erroPedidos.message}`);
  const pedidoIds = (pedidos ?? []).map((p) => p.id);
  if (pedidoIds.length === 0) return null;

  const { data: itens, error: erroItens } = await supabaseAdmin
    .from("itens_pedido")
    .select("nome_produto, quantidade")
    .eq("empresa_id", ctx.empresaId)
    .in("pedido_id", pedidoIds);

  if (erroItens) throw new Error(`erro_ao_consultar_produto_favorito: ${erroItens.message}`);
  if (!itens || itens.length === 0) return null;

  const porProduto = new Map<string, number>();
  for (const item of itens) {
    porProduto.set(item.nome_produto, (porProduto.get(item.nome_produto) ?? 0) + item.quantidade);
  }

  const [nomeProduto, quantidade] = [...porProduto.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { nome_produto: nomeProduto, quantidade_pedidos: quantidade };
}

registerTool({
  nome: "consultar_cliente",
  descricao:
    "Consulta o cadastro do cliente desta conversa (nome, telefone, tags, endereço salvo da última entrega, primeira/última interação) e, quando a empresa permite, o produto favorito dele (mais pedido no histórico) — use para personalizar sugestões (ex.: repetir o de sempre ou sugerir novidade) e para confirmar reuso do endereço salvo antes de pedir tudo de novo.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const { data, error } = await supabaseAdmin
      .from("clientes")
      .select("nome, telefone, tags, endereco_json, primeiro_contato_em, ultima_interacao_em")
      .eq("id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();

    if (error) throw new Error(`erro_ao_consultar_cliente: ${error.message}`);
    if (!data) return { erro: "cliente_nao_encontrado" };

    // `false` explícito desliga — ausente/true segue o padrão permissivo dos
    // demais campos de comportamento comercial (ver ComportamentoJsonSchema).
    if (ctx.comportamento.personalizar_com_historico === false) return data;

    const produtoFavorito = await buscarProdutoFavorito(ctx);
    return produtoFavorito ? { ...data, produto_favorito: produtoFavorito } : data;
  },
});

registerTool({
  nome: "consultar_historico",
  descricao: "Consulta os últimos pedidos do cliente desta conversa (status, itens, total, data) — use para personalizar recomendações ou responder 'o que eu costumo pedir'.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select("id, status, total, criado_em, itens:itens_pedido(nome_produto, quantidade)")
      .eq("cliente_id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId)
      .neq("status", "cancelado")
      .order("criado_em", { ascending: false })
      .limit(5);

    if (error) throw new Error(`erro_ao_consultar_historico: ${error.message}`);
    return { pedidos: data ?? [] };
  },
});
