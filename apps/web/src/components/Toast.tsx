import { createContext, useCallback, useContext, useRef, useState } from "react";
import "./Toast.css";

type TipoToast = "sucesso" | "erro";
interface Toast {
  id: number;
  mensagem: string;
  tipo: TipoToast;
}

const DURACAO_MS = 3200;

const ToastContext = createContext<(mensagem: string, tipo?: TipoToast) => void>(() => {});

/** Feedback discreto pós-ação — substitui o `window.alert` que o painel usava
 * pra erro. Não bloqueia o fluxo: some sozinho e não rouba foco. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);

  const mostrar = useCallback((mensagem: string, tipo: TipoToast = "sucesso") => {
    const id = proximoId.current++;
    setToasts((atuais) => [...atuais, { id, mensagem, tipo }]);
    setTimeout(() => setToasts((atuais) => atuais.filter((t) => t.id !== id)), DURACAO_MS);
  }, []);

  return (
    <ToastContext.Provider value={mostrar}>
      {children}
      <div className="toast-pilha" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tipo}`}>
            <span className="toast-marca" aria-hidden="true">
              {t.tipo === "sucesso" ? "✓" : "!"}
            </span>
            <span>{t.mensagem}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
