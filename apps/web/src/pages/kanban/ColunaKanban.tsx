import type { EstagioOperacional } from "@prospect/shared";
import { STATUS_META } from "../../components/statusMeta.js";

export default function ColunaKanban({
  estagio,
  total,
  children,
}: {
  estagio: EstagioOperacional;
  total: number;
  children: React.ReactNode;
}) {
  const meta = STATUS_META[estagio];
  return (
    <section
      className={`col col-${estagio}`}
      style={{ "--accent": meta.accentVar, "--accent-bg": meta.accentBgVar } as React.CSSProperties}
      aria-label={`${meta.label} — ${total} atendimento(s)`}
    >
      <header className="col-head">
        <span className="col-icone" aria-hidden="true">
          {meta.icon}
        </span>
        <h2 className="col-title">{meta.label}</h2>
        <span className="col-count mono">{total}</span>
      </header>
      <div className="col-body">{children}</div>
    </section>
  );
}
