// Wiring de `ia_sessoes` (migration 0009) — memória curta derivada da
// conversa, para dados que não dá pra recalcular barato a partir do
// histórico bruto de `mensagens` (ver docs/ROADMAP.md §1 "ia_sessoes em
// uso"). Escopo desta primeira versão: só "último produto/combo
// mencionado" — o suficiente pra resolver referência pronominal ("e esse
// aí, tem em outro tamanho?") quando a janela de histórico carregada pelo
// poller não cobre mais a mensagem onde o produto foi citado.
//
// Deliberadamente NÃO cobre "carrinho em construção" nem "confirmação
// pendente com hash" — esses dois pertencem ao desenho da tool de escrita
// `criar_pedido` (tarefa 0017), que ainda não existe. Ver observação nesse
// arquivo de tarefa.
import { supabaseAdmin } from "../lib/supabase.js";
import type { ToolContext } from "../tools/index.js";
import type { EvidenciaColetada } from "./investigador.js";

interface EstadoSessao {
  ultimo_produto_mencionado?: {
    id: string;
    nome: string;
  };
}

/** Ferramentas cujo resultado pode conter um produto/combo específico —
 * ver tools/catalogo.ts (`ProdutoResumo` sempre tem `id`/`nome`). */
const FERRAMENTAS_COM_PRODUTO = new Set(["buscar_produtos", "buscar_combos"]);

export async function carregarSessao(ctx: ToolContext): Promise<EstadoSessao | null> {
  const { data, error } = await supabaseAdmin
    .from("ia_sessoes")
    .select("estado_json")
    .eq("empresa_id", ctx.empresaId)
    .eq("atendimento_id", ctx.atendimentoId)
    .maybeSingle();

  if (error) {
    // Sessão é memória auxiliar, não fonte de verdade — nunca derruba o
    // atendimento por falha de leitura aqui, só segue sem contexto extra.
    return null;
  }
  return (data?.estado_json as EstadoSessao | null) ?? null;
}

/** Deriva "último produto mencionado" das evidências reais desta rodada —
 * só quando exatamente um produto foi retornado (busca ambígua/genérica com
 * vários resultados não conta como "o produto que o cliente quer"). */
function extrairUltimoProduto(evidencias: EvidenciaColetada[]): EstadoSessao["ultimo_produto_mencionado"] | null {
  for (let i = evidencias.length - 1; i >= 0; i--) {
    const evidencia = evidencias[i]!;
    if (!FERRAMENTAS_COM_PRODUTO.has(evidencia.toolNome)) continue;

    const output = evidencia.output as { resultados?: Array<{ id: string; nome: string }> } | null;
    if (output?.resultados?.length === 1) {
      const { id, nome } = output.resultados[0]!;
      return { id, nome };
    }
  }
  return null;
}

/** Atualiza a sessão com o produto mencionado nesta rodada, se houver
 * algum identificável. Nunca lança — falha aqui não pode derrubar a
 * resposta ao cliente, que já foi decidida antes desta chamada. */
export async function atualizarSessaoComEvidencias(
  ctx: ToolContext,
  evidencias: EvidenciaColetada[],
): Promise<void> {
  const produto = extrairUltimoProduto(evidencias);
  if (!produto) return;

  const estado: EstadoSessao = { ultimo_produto_mencionado: produto };

  const { error } = await supabaseAdmin
    .from("ia_sessoes")
    .upsert(
      {
        empresa_id: ctx.empresaId,
        atendimento_id: ctx.atendimentoId,
        estado_json: estado,
      },
      { onConflict: "atendimento_id" },
    );

  if (error) {
    console.error("[ai-orchestrator] falha ao salvar ia_sessoes:", error);
  }
}
