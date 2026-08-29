// Log de invariantes do workflow transacional (tarefa 0081, item 16 da
// especificação). Cada evento aqui descreve uma situação que, por desenho,
// NUNCA deveria acontecer — se acontecer, é bug de arquitetura, não erro de
// operação. Registrar é o que transforma "a IA às vezes faz coisa estranha"
// em algo detectável e mensurável sem depender de alguém reler conversa.
//
// Nunca lança: observabilidade não pode derrubar a resposta ao cliente
// (mesmo princípio de `atualizarSessaoComEvidencias`, agent/sessao.ts).
import { supabaseAdmin } from "../../lib/supabase.js";
import type { ToolContext } from "../../tools/index.js";

export type EventoInvariante =
  /** Confirmação válida do cliente foi reconhecida, mas nenhum pedido real
   * nasceu dela (nem por bloqueio de risco, que tem evento próprio). */
  | "confirmation_without_order"
  /** `criar_pedido` retornou sucesso sem que houvesse confirmação
   * registrada — só possível se alguém contornar a validação da tool. */
  | "order_without_confirmation"
  /** Handoff criado num turno que afirmava ter criado um pedido, sem
   * `pedido_id` real por trás. */
  | "handoff_without_order"
  /** `criarHandoff` não devolveu id — sem isso nada prova que o handoff
   * existe, e o Atendente não pode dizer que transferiu. */
  | "handoff_without_handoff_id"
  /** O estado persistido mudou sem uma execução de ferramenta
   * correspondente nesta rodada. */
  | "state_mutation_without_tool"
  /** A intenção extraída da mensagem exigia uma mutação e nenhuma
   * ferramenta correspondente rodou (o bug do episódio "Barbara"). */
  | "tool_expected_but_not_called"
  /** A ferramenta retornou sucesso mas a releitura do estado real mostrou
   * que nada mudou — sucesso reportado sem efeito. */
  | "tool_success_without_state_change"
  /** O texto gerado afirmava um fato transacional sem evidência
   * persistida — bloqueado pelo TransactionTruthGate. */
  | "transactional_claim_without_evidence"
  /** O texto afirmava uma regra de negócio (disponibilidade, entrega,
   * pagamento, horário, política) que nenhum fato desta rodada sustenta —
   * bloqueado pelo gate de lastro (tarefa 0082). */
  | "business_claim_without_evidence"
  /** O texto afirmava que algo existe quando um fato coletado dizia o
   * contrário (ex.: "temos várias opções" depois de uma busca vazia). */
  | "claim_contradicts_evidence"
  /** O cliente perguntou sobre um assunto de negócio e nenhuma ferramenta
   * correspondente chegou a rodar — a resposta sairia sem lastro. */
  | "question_without_tool_call";

export async function registrarInvariante(
  ctx: ToolContext,
  evento: EventoInvariante,
  detalhe: Record<string, unknown>,
): Promise<void> {
  // Prefixo estável: `grep "\[invariante\]"` nos logs do processo já dá a
  // lista completa sem precisar consultar o banco.
  console.warn(`[invariante] ${evento}`, JSON.stringify({ atendimento_id: ctx.atendimentoId, ...detalhe }));

  const { error } = await supabaseAdmin.from("ia_invariantes").insert({
    empresa_id: ctx.empresaId,
    atendimento_id: ctx.atendimentoId,
    mensagem_id: ctx.mensagemId,
    evento,
    detalhe_json: detalhe,
  });
  if (error) {
    console.error("[ai-orchestrator] falha ao registrar invariante:", error.message);
  }
}
