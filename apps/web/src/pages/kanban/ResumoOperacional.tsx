import type { AtendimentoComContexto, EstagioOperacional } from "@prospect/shared";
import { KANBAN_COLUNAS, STATUS_META } from "../../components/statusMeta.js";

/** Panorama da operação em uma linha, pra o operador não precisar contar
 * cards. "Em atendimento" ganha destaque quando tem alguém esperando por uma
 * pessoa (status solicitou_humano) — é o único caso que representa trabalho
 * parado esperando por ação humana. */
export default function ResumoOperacional({
  porColuna,
}: {
  porColuna: Map<EstagioOperacional, AtendimentoComContexto[]>;
}) {
  return (
    <div className="resumo" role="status" aria-live="polite">
      {KANBAN_COLUNAS.map((estagio) => {
        const meta = STATUS_META[estagio];
        const total = porColuna.get(estagio)?.length ?? 0;
        const alerta =
          estagio === "em_atendimento" && (porColuna.get(estagio)?.some((a) => a.status === "solicitou_humano") ?? false);
        return (
          <div
            className={`resumo-item${alerta ? " resumo-item-alerta" : ""}`}
            key={estagio}
            style={{ "--accent": meta.accentVar, "--accent-bg": meta.accentBgVar } as React.CSSProperties}
          >
            <span className="resumo-icone" aria-hidden="true">
              {meta.icon}
            </span>
            <span className="resumo-label">{meta.label}</span>
            <span className="resumo-count mono">{total}</span>
          </div>
        );
      })}
    </div>
  );
}
