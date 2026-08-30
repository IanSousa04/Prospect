import type { AtendimentoComContexto, EstagioOperacional } from "@prospect/shared";
import { KANBAN_COLUNAS, STATUS_META } from "../../components/statusMeta.js";

/** Panorama da operação em uma linha, pra o operador não precisar contar
 * cards. "Aguardando humano" ganha destaque quando tem alguém na fila — é a
 * única coluna que representa trabalho parado esperando por uma pessoa. */
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
        const alerta = estagio === "aguardando_humano" && total > 0;
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
