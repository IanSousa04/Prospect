import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

interface BuscarConhecimentoInput {
  termo: string;
}

interface ConhecimentoResultado {
  categoria: string;
  titulo: string;
  conteudo: string;
}

/**
 * Busca em conhecimento_itens usando o tsvector nativo do Postgres (ver
 * migration 0009_ia_fundacao.sql) — decisão consciente de não usar
 * embeddings nesta fase (volume pequeno por empresa, ver plano da camada de IA).
 *
 * `ctx.empresaId` nunca vem do input do modelo — sempre do contexto da
 * sessão, injetado pelo orquestrador (CLAUDE.md regra 5).
 */
async function executor(input: BuscarConhecimentoInput, ctx: ToolContext): Promise<{ resultados: ConhecimentoResultado[] }> {
  const termo = input.termo?.trim();
  if (!termo) return { resultados: [] };

  const { data, error } = await supabaseAdmin
    .from("conhecimento_itens")
    .select("categoria, titulo, conteudo")
    .eq("empresa_id", ctx.empresaId)
    .eq("status", "ativo")
    .textSearch("conteudo_busca", termo, { type: "websearch", config: "portuguese" })
    .limit(5);

  if (error) {
    throw new Error(`erro_ao_buscar_conhecimento: ${error.message}`);
  }

  return { resultados: (data ?? []) as ConhecimentoResultado[] };
}

registerTool({
  nome: "buscar_conhecimento",
  descricao:
    "Busca informações institucionais cadastradas pela empresa (FAQ, políticas, procedimentos, entrega, pagamento, cancelamento, promoções, horários, região). Use para qualquer pergunta que não seja sobre um produto específico do cardápio.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      termo: {
        type: "string",
        description: "Termo ou pergunta em português a buscar — ex: 'política de cancelamento', 'horário de funcionamento'.",
      },
    },
    required: ["termo"],
  },
  risco: "baixo",
  executor,
});
