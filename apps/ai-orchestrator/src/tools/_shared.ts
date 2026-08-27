import { supabaseAdmin } from "../lib/supabase.js";

interface ConhecimentoResumo {
  titulo: string;
  conteudo: string;
}

/** Compartilhado pelas tools de operação (horário/taxa/região/política) —
 * todas são, na prática, `conhecimento_itens` filtrado por categoria fixa.
 * Sempre escopado por empresa; nunca aceita categoria vinda do LLM (cada
 * tool chama isto com uma categoria fixa hardcoded). */
export async function buscarConhecimentoPorCategoria(
  empresaId: string,
  categoria: string,
): Promise<{ resultados: ConhecimentoResumo[] }> {
  const { data, error } = await supabaseAdmin
    .from("conhecimento_itens")
    .select("titulo, conteudo")
    .eq("empresa_id", empresaId)
    .eq("categoria", categoria)
    .eq("status", "ativo")
    .order("titulo", { ascending: true })
    .limit(10);

  if (error) throw new Error(`erro_ao_buscar_conhecimento: ${error.message}`);
  return { resultados: (data ?? []) as ConhecimentoResumo[] };
}
