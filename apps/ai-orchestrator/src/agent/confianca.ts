import { TIPOS_COMERCIAIS, type Afirmacao, type Confianca, type RelatorioInvestigacao } from "./types.js";

/** Afirmações comerciais (preço/disponibilidade/promoção/taxa/horário) sem
 * fonte real desta rodada — o mesmo veto que `computeConfianca` aplica pra
 * derrubar confiança pra "baixa" (CLAUDE.md regra 1), exposto separado pra
 * `investigador.ts` poder dar ao modelo uma chance determinística de
 * rechecar com ferramenta ANTES de aceitar isso como handoff definitivo
 * (ver `investigar()`, retry por "semFonte"). */
export function afirmacoesComerciaisSemFonte(relatorio: RelatorioInvestigacao): Afirmacao[] {
  return relatorio.afirmacoes.filter((a) => TIPOS_COMERCIAIS.has(a.tipo) && !a.fonte_tool_execucao_id);
}

/**
 * Confiança calculada mecanicamente a partir do relatório — nunca pedida
 * como "opinião" ao LLM (ver plano da camada de IA, réplica direta do
 * `computeConfidence` do Eddy em apps/query-api/src/agent.ts).
 */
export function computeConfianca(relatorio: RelatorioInvestigacao): Confianca {
  // "Sem investigação" (social etc.) — confiança/risco não se aplicam: não há
  // nada factual pra poder estar errado. Espelha o `confidence = null` do Eddy
  // pros marcadores NO_INVESTIGATION: a resposta sai direto, nunca handoff.
  if (relatorio.sem_investigacao) return "alta";

  if (relatorio.ambiguidade.tipo !== "nenhuma") return "baixa";

  if (relatorio.afirmacoes.length === 0) {
    // Nada foi afirmado. Só é seguro tratar como "alta" (responder direto,
    // ex.: saudação social) quando NENHUMA ferramenta sequer foi chamada —
    // sinal determinístico, não depende do LLM lembrar de marcar
    // ambiguidade. Se ferramentas FORAM chamadas e mesmo assim não saiu
    // nenhuma afirmação (ex.: buscou um produto e não achou, mas o modelo
    // esqueceu de sinalizar isso), é mais seguro tratar como baixa e
    // escalar do que arriscar o Atendente "preencher a lacuna" sozinho.
    return relatorio.ferramentasChamadas === 0 ? "alta" : "baixa";
  }

  // Veto duro: toda afirmação comercial sem fonte_tool_execucao_id real é
  // uma alucinação potencial (CLAUDE.md regra 1) — derruba pra baixa
  // independente de qualquer outra coisa.
  if (afirmacoesComerciaisSemFonte(relatorio).length > 0) return "baixa";

  const cobertura = new Set(relatorio.afirmacoes.map((a) => a.fonte_tool).filter((t): t is string => t !== null))
    .size;
  if (cobertura === 0) return "media";
  if (cobertura === 1) return "media";
  return "alta";
}
