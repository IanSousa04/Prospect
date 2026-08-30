import { useEffect, useRef } from "react";
import "./ConfirmDialog.css";

export interface ConfirmDialogProps {
  titulo: string;
  /** Explica o que vai acontecer, em português operacional. Nunca "tem
   * certeza?" — a confirmação existe pra o operador saber a consequência,
   * não pra ele clicar duas vezes. */
  descricao: string;
  labelConfirmar: string;
  labelCancelar?: string;
  destrutivo?: boolean;
  emExecucao?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export default function ConfirmDialog({
  titulo,
  descricao,
  labelConfirmar,
  labelCancelar = "Cancelar",
  destrutivo = false,
  emExecucao = false,
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  // Foco inicial no botão de VOLTAR, não no de confirmar: quem abriu o
  // diálogo sem querer aperta Enter e não muda estado nenhum.
  const cancelarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelarRef.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onCancelar]);

  return (
    <div className="cd-overlay" onClick={onCancelar}>
      <div
        className="cd-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cd-titulo"
        aria-describedby="cd-descricao"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="cd-titulo" id="cd-titulo">
          {titulo}
        </p>
        <p className="cd-descricao" id="cd-descricao">
          {descricao}
        </p>
        <div className="cd-acoes">
          <button className="cd-btn cd-btn-ghost" ref={cancelarRef} onClick={onCancelar} disabled={emExecucao}>
            {labelCancelar}
          </button>
          <button
            className={`cd-btn ${destrutivo ? "cd-btn-destrutivo" : "cd-btn-primario"}`}
            onClick={onConfirmar}
            disabled={emExecucao}
          >
            {emExecucao ? "Aguarde…" : labelConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
