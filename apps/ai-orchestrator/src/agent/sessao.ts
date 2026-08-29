// Wiring de `ia_sessoes` (migration 0009) — memória curta derivada da
// conversa, para dados que não dá pra recalcular barato a partir do
// histórico bruto de `mensagens` (ver docs/ROADMAP.md §1 "ia_sessoes em
// uso"). Escopo desta primeira versão: só "último produto/combo
// mencionado" — o suficiente pra resolver referência pronominal ("e esse
// aí, tem em outro tamanho?") quando a janela de histórico carregada pelo
// poller não cobre mais a mensagem onde o produto foi citado.
//
// Também guarda, desde a tarefa 0053, o Order Context ("pedido em
// construção" — ver agent/pedido-contexto.ts) na mesma linha/tabela.
// "Confirmação pendente com hash" ainda não é coberta — pertence à tarefa
// 0055 (confirmação explícita + criação real do pedido).
import { supabaseAdmin } from "../lib/supabase.js";
import type { ToolContext } from "../tools/index.js";
import type { EvidenciaColetada } from "./investigador.js";
import { pedidoVazio, type OrderContext } from "./pedido-contexto.js";
import type { AguardandoConfirmacao, UltimoPedidoCriado } from "@prospect/shared";

interface EstadoSessao {
  ultimo_produto_mencionado?: {
    id: string;
    nome: string;
  };
  pedido?: OrderContext;
  /** Confirmação pendente do resumo final do pedido (tarefa 0022) — irmã
   * de `pedido`, nunca dentro dele: é estado da CONVERSA (o que já foi
   * mostrado ao cliente), não do carrinho em si. */
  aguardando_confirmacao?: AguardandoConfirmacao;
  /** Ponteiro pro último pedido REAL criado nesta conversa (tarefa 0081) —
   * evidência que sobrevive ao reset do carrinho e chave de idempotência
   * de `criar_pedido`. Ver `UltimoPedidoCriado` em packages/shared. */
  ultimo_pedido_criado?: UltimoPedidoCriado;
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
 * aqui não pode derrubar a resposta ao cliente, que já foi decidida antes
 * desta chamada. */
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

/** Pedido em construção desta conversa — nunca `null`: sem sessão/pedido
 * salvo ainda, retorna o estado inicial vazio (ver `pedidoVazio()`), o
 * mesmo estado que uma tool de carrinho (tarefa 0054) parte para montar o
 * primeiro item. */
export async function carregarPedidoEmConstrucao(ctx: ToolContext): Promise<OrderContext> {
  const estado = await lerEstadoBruto(ctx);
  return estado.pedido ?? pedidoVazio();
}

/** Persiste o Order Context desta conversa — usado pelas tools de carrinho
 * (tarefa 0054) a cada mutação. Mescla sobre o `estado_json` existente
 * (nunca sobrescreve `ultimo_produto_mencionado`). */
export async function salvarPedidoEmConstrucao(ctx: ToolContext, pedido: OrderContext): Promise<void> {
  await mesclarEstado(ctx, { pedido });
}

/** Confirmação pendente do resumo final desta conversa (tarefa 0022) —
 * nunca `null` explícito no banco, sempre ausente (`undefined`) quando não
 * há nenhuma, mesmo padrão do resto deste arquivo. */
export async function carregarConfirmacaoPendente(ctx: ToolContext): Promise<AguardandoConfirmacao | null> {
  const estado = await lerEstadoBruto(ctx);
  return estado.aguardando_confirmacao ?? null;
}

/** Salva (ou limpa, passando `undefined`) a confirmação pendente — chamado
 * por `consultar_carrinho` (refresca sempre que o resumo é mostrado de
 * novo) e por `criar_pedido` (limpa depois de criar de verdade, pra nunca
 * sobrar uma confirmação "usada" que pudesse ser reaproveitada). */
export async function salvarConfirmacaoPendente(
  ctx: ToolContext,
  confirmacao: AguardandoConfirmacao | undefined,
): Promise<void> {
  await mesclarEstado(ctx, { aguardando_confirmacao: confirmacao });
}

/** Último pedido real criado nesta conversa (tarefa 0081) — `null` quando
 * a IA ainda não fechou nenhum pedido aqui. É a evidência persistida que
 * `derivarEstadoCheckout` usa pra manter o estado `pedido_criado` depois do
 * carrinho ser resetado, e a chave de idempotência de `criar_pedido`. */
export async function carregarUltimoPedidoCriado(ctx: ToolContext): Promise<UltimoPedidoCriado | null> {
  const estado = await lerEstadoBruto(ctx);
  return estado.ultimo_pedido_criado ?? null;
}

/** Grava (ou limpa, passando `undefined`) o ponteiro do pedido criado.
 * Chamado só por `criar_pedido` (tools/pedido.ts), sempre ANTES de resetar
 * o Order Context — a ordem importa: se o processo morrer no meio, é melhor
 * sobrar um ponteiro pra um pedido real do que perder a evidência de que
 * ele foi criado. */
export async function salvarUltimoPedidoCriado(
  ctx: ToolContext,
  ultimo: UltimoPedidoCriado | undefined,
): Promise<void> {
  await mesclarEstado(ctx, { ultimo_pedido_criado: ultimo });
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
 * resposta ao cliente, que já foi decidida antes desta chamada. */
export async function atualizarSessaoComEvidencias(
  ctx: ToolContext,
  evidencias: EvidenciaColetada[],
): Promise<void> {
  const produto = extrairUltimoProduto(evidencias);
  if (!produto) return;

  await mesclarEstado(ctx, { ultimo_produto_mencionado: produto });
}
