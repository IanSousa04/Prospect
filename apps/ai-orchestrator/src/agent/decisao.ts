import type { Confianca, Decisao, RelatorioInvestigacao } from "./types.js";

/**
 * Matriz de decisão do MVP 1 — simplificada porque nenhuma tool de escrita
 * existe ainda (risco é sempre 'baixo'; a matriz completa com risco real
 * entra no MVP 2, ver plano da camada de IA):
 *
 *   ambiguidade != nenhuma → pedir esclarecimento, nunca escolhe sozinha.
 *   confiança baixa        → handoff (falha de conhecimento).
 *   confiança média/alta   → responde.
 */
export function decidir(
  relatorio: RelatorioInvestigacao,
  confianca: Confianca,
): Decisao {
  if (relatorio.ambiguidade.tipo !== "nenhuma") {
    return { acao: "pedir_esclarecimento" };
  }
  if (confianca === "baixa") {
    return { acao: "handoff", motivoHandoff: "falha_conhecimento" };
  }
  return { acao: "responder" };
}
