import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

interface BuscarProdutosInput {
  termo?: string;
}

interface ProdutoResumo {
  id: string;
  nome: string;
  categoria: string | null;
  descricao_comercial: string | null;
  preco: number;
  preco_promocional: number | null;
  disponivel: boolean;
  restricoes: string | null;
}

async function buscarProdutosBase(
  ctx: ToolContext,
  termo: string | undefined,
  tipo: "produto" | "combo",
): Promise<{ resultados: ProdutoResumo[] }> {
  let query = supabaseAdmin
    .from("produtos")
    .select("id, nome, descricao_comercial, preco, preco_promocional, disponivel, restricoes, categoria:categorias(nome)")
    .eq("empresa_id", ctx.empresaId)
    .eq("status", "ativo")
    .eq("tipo", tipo)
    .limit(15);

  if (termo?.trim()) {
    query = query.ilike("nome", `%${termo.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`erro_ao_buscar_produtos: ${error.message}`);

  const resultados: ProdutoResumo[] = (data ?? []).map((p: any) => ({
    id: p.id,
    nome: p.nome,
    categoria: p.categoria?.nome ?? null,
    descricao_comercial: p.descricao_comercial,
    preco: Number(p.preco),
    preco_promocional: p.preco_promocional != null ? Number(p.preco_promocional) : null,
    disponivel: p.disponivel,
    restricoes: p.restricoes,
  }));
  return { resultados };
}

registerTool({
  nome: "buscar_produtos",
  descricao:
    "Busca produtos do cardápio por nome (busca parcial). Sem termo, lista os produtos ativos. Nunca afirme preço/disponibilidade sem antes chamar esta ferramenta.",
  parametrosJsonSchema: {
    type: "object",
    properties: { termo: { type: "string", description: "Nome ou parte do nome do produto — opcional." } },
  },
  risco: "baixo",
  executor: async (input: BuscarProdutosInput, ctx) => buscarProdutosBase(ctx, input.termo, "produto"),
});

registerTool({
  nome: "buscar_combos",
  descricao: "Busca combos do cardápio por nome (busca parcial). Sem termo, lista os combos ativos.",
  parametrosJsonSchema: {
    type: "object",
    properties: { termo: { type: "string", description: "Nome ou parte do nome do combo — opcional." } },
  },
  risco: "baixo",
  executor: async (input: BuscarProdutosInput, ctx) => buscarProdutosBase(ctx, input.termo, "combo"),
});

interface ProdutoIdInput {
  produto_id: string;
}

interface GrupoResumo {
  nome: string;
  tipo: string;
  obrigatorio: boolean;
  minimo: number;
  maximo: number;
  opcoes: Array<{ id: string; nome: string; preco_adicional: number; disponivel: boolean }>;
}

async function buscarGruposDoProduto(
  ctx: ToolContext,
  produtoId: string,
  tipoFiltro?: string,
): Promise<{ grupos: GrupoResumo[] } | { erro: string }> {
  const { data: produto } = await supabaseAdmin
    .from("produtos")
    .select("id")
    .eq("id", produtoId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (!produto) return { erro: "produto_nao_encontrado" };

  let query = supabaseAdmin
    .from("grupos_opcoes")
    .select("nome, tipo, obrigatorio, minimo, maximo, opcoes(id, nome, preco_adicional, disponivel)")
    .eq("empresa_id", ctx.empresaId)
    .eq("produto_id", produtoId);
  if (tipoFiltro) query = query.eq("tipo", tipoFiltro);

  const { data, error } = await query;
  if (error) throw new Error(`erro_ao_buscar_opcoes: ${error.message}`);

  return { grupos: (data ?? []) as unknown as GrupoResumo[] };
}

registerTool({
  nome: "buscar_opcoes",
  descricao:
    "Lista todos os grupos de personalização de um produto (adicionar, remover, substituir, escolher) com suas regras de obrigatoriedade e quantidade. Use antes de aceitar qualquer personalização do cliente.",
  parametrosJsonSchema: {
    type: "object",
    properties: { produto_id: { type: "string", description: "ID do produto, obtido via buscar_produtos/buscar_combos." } },
    required: ["produto_id"],
  },
  risco: "baixo",
  executor: async (input: ProdutoIdInput, ctx) => buscarGruposDoProduto(ctx, input.produto_id),
});

registerTool({
  nome: "buscar_adicionais",
  descricao: "Lista só os grupos de adicionais (tipo 'adicionar') de um produto, com preço de cada adicional.",
  parametrosJsonSchema: {
    type: "object",
    properties: { produto_id: { type: "string", description: "ID do produto." } },
    required: ["produto_id"],
  },
  risco: "baixo",
  executor: async (input: ProdutoIdInput, ctx) => buscarGruposDoProduto(ctx, input.produto_id, "adicionar"),
});

registerTool({
  nome: "buscar_recomendacoes",
  descricao: "Lista produtos recomendados (combina com, frequentemente comprado com, alternativa, similar) para um produto — use para sugerir upsell/cross-sell.",
  parametrosJsonSchema: {
    type: "object",
    properties: { produto_id: { type: "string", description: "ID do produto." } },
    required: ["produto_id"],
  },
  risco: "baixo",
  executor: async (input: ProdutoIdInput, ctx: ToolContext) => {
    const { data, error } = await supabaseAdmin
      .from("produto_relacionados")
      .select("tipo, relacionado:produtos!produto_relacionados_relacionado_id_fkey(id, nome, preco, preco_promocional)")
      .eq("empresa_id", ctx.empresaId)
      .eq("produto_id", input.produto_id);

    if (error) throw new Error(`erro_ao_buscar_recomendacoes: ${error.message}`);
    return {
      recomendacoes: (data ?? []).map((r: any) => ({
        tipo: r.tipo,
        produto_id: r.relacionado.id,
        nome: r.relacionado.nome,
        preco: Number(r.relacionado.preco_promocional ?? r.relacionado.preco),
      })),
    };
  },
});
