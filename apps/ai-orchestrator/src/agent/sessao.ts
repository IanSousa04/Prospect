// Wiring de `ia_sessoes` (migration 0009) — memória curta derivada da
// conversa, para dados que não dá pra recalcular barato a partir do
// histórico bruto de `mensagens`. Escopo atual: só "último produto/combo
// mencionado" — o suficiente pra resolver referência pronominal ("e esse
// aí, tem em outro tamanho?") quando a janela de histórico carregada pelo
// poller não cobre mais a mensagem onde o produto foi citado.
//
// A IA não mantém mais estado de pedido/carrinho aqui: o carrinho é o Order
// Context do link público (`ia_sessoes.estado_json.pedido`), gerenciado pela
// página pública e pelo painel humano, nunca pela IA.
import { supabaseAdmin } from "../lib/supabase.js";
import type { ToolContext } from "../tools/index.js";
import type { EvidenciaColetada } from "./investigador.js";

interface EstadoSessao {
  ultimo_produto_mencionado?: {
    id: string;
    nome: string;
  };
}

/** Lê o `estado_json` bruto desta sessão (ou `{}` se não existe linha
 * ainda) — usado internamente por toda escrita, pra nunca sobrescrever um
 * campo que outra parte do código já tinha salvo (`ia_sessoes` guarda
 * várias coisas na mesma linha/coluna jsonb, ver `EstadoSessao` acima). */
async function lerEstadoBruto(ctx: ToolContext): Promise<EstadoSessao> {
  const { data, error } = await supabaseAdmin
    .from("ia_sessoes")
    .select("estado_json")
    .eq("empresa_id", ctx.empresaId)
    .eq("atendimento_id", ctx.atendimentoId)
    .maybeSingle();

  if (error || !data) return {};
  return (data.estado_json as EstadoSessao) ?? {};
}

/** Mescla `patch` sobre o `estado_json` existente (nunca substitui a linha
 * inteira) e faz upsert. Nunca lança — sessão é memória auxiliar, uma falha
 * aqui não pode derrubar a resposta ao cliente. */
async function mesclarEstado(ctx: ToolContext, patch: Partial<EstadoSessao>): Promise<void> {
  const atual = await lerEstadoBruto(ctx);
  const novoEstado: EstadoSessao = { ...atual, ...patch };

  const { error } = await supabaseAdmin
    .from("ia_sessoes")
    .upsert(
      {
        empresa_id: ctx.empresaId,
        atendimento_id: ctx.atendimentoId,
        estado_json: novoEstado,
      },
      { onConflict: "atendimento_id" },
    );

  if (error) {
    console.error("[ai-orchestrator] falha ao salvar ia_sessoes:", error);
  }
}

/** Ferramentas cujo resultado pode conter um produto/combo específico —
 * ver tools/catalogo.ts (`ProdutoResumo` sempre tem `id`/`nome`). */
const FERRAMENTAS_COM_PRODUTO = new Set(["buscar_produtos", "buscar_combos"]);

export async function carregarSessao(ctx: ToolContext): Promise<EstadoSessao | null> {
  const estado = await lerEstadoBruto(ctx);
  return Object.keys(estado).length > 0 ? estado : null;
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
 * resposta ao cliente. */
export async function atualizarSessaoComEvidencias(
  ctx: ToolContext,
  evidencias: EvidenciaColetada[],
): Promise<void> {
  const produto = extrairUltimoProduto(evidencias);
  if (!produto) return;

  await mesclarEstado(ctx, { ultimo_produto_mencionado: produto });
}
