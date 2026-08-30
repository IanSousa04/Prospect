// Ponte entre `PublicoConfig` (guardada em ia_configuracoes.publico_json) e o
// que a página pública precisa pra renderizar: variáveis CSS na raiz do
// componente e uma classe de layout. A página inteira é movida por
// `--primary`/`--primary-hover`/`--font-ui` (ver PedidoPublico.css), então
// sobrescrever esses tokens é suficiente pra personalizar a marca sem abrir
// uma segunda paleta.

import type { CSSProperties } from "react";
import type { FontePublico, PublicoConfig } from "@prospect/shared";

/** Stacks de sistema, sem dependência de rede. `padrao` nem aparece aqui —
 * deixa a `--font-ui` original do painel (Manrope) valer. */
export const FONTE_STACKS: Record<Exclude<FontePublico, "padrao">, string> = {
  serifada: `Georgia, "Times New Roman", serif`,
  moderna: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
};

export function aparenciaVars(aparencia: PublicoConfig): CSSProperties {
  const vars: Record<string, string> = {};
  if (aparencia.cor_primaria) {
    // Hover igual à cor base: escurecer hex sem lib de cor é reinventar roda,
    // e pra um MVP o hover igual não quebra nada visualmente.
    vars["--primary"] = aparencia.cor_primaria;
    vars["--primary-hover"] = aparencia.cor_primaria;
  }
  if (aparencia.fonte !== "padrao") {
    vars["--font-ui"] = FONTE_STACKS[aparencia.fonte];
  }
  return vars as CSSProperties;
}

export function aparenciaClasse(aparencia: PublicoConfig): string {
  return aparencia.layout === "grade" ? "pp-grade" : "pp-lista";
}
