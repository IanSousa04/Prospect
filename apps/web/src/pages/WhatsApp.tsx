import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { WhatsappConexao } from "@prospect/shared";
import { api } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import Topbar from "../components/Topbar.js";
import "./WhatsApp.css";

type StatusResposta = Omit<WhatsappConexao, "empresa_id">;

const LABEL_STATUS: Record<StatusResposta["status"], string> = {
  desconectado: "Desconectado",
  aguardando_qr: "Aguardando leitura do QR code",
  conectado: "Conectado",
};

/** Tempo máximo que o spinner fica preso esperando o worker refletir o
 * comando no status real — evita loading infinito se o processo do worker
 * estiver fora do ar (ele nunca vai limpar o `comando`/mudar o status
 * sozinho nesse caso). */
const TIMEOUT_ACAO_MS = 20000;

export default function WhatsApp() {
  const [status, setStatus] = useState<StatusResposta | null>(null);
  const [qrImagem, setQrImagem] = useState<string | null>(null);
  // Qual ação está em andamento — o botão fica em loading não só durante a
  // chamada HTTP (que só grava o comando), mas até o whatsapp-worker
  // realmente executar e publicar o novo status (via realtime).
  const [acao, setAcao] = useState<"conectando" | "desconectando" | null>(null);

  async function carregar() {
    const resposta = await api.buscarStatusWhatsapp();
    setStatus(resposta);
  }

  useEffect(() => {
    carregar();

    // Realtime: o whatsapp-worker publica o status real (qr/ready/
    // disconnected) direto na tabela — RLS já filtra pela empresa do
    // usuário logado, mesmo padrão usado no Kanban (ver Kanban.tsx).
    const channel = supabase
      .channel("whatsapp-conexao")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conexoes" }, () => carregar())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!status?.qr_code) {
      setQrImagem(null);
      return;
    }
    QRCode.toDataURL(status.qr_code, { width: 260, margin: 1 })
      .then(setQrImagem)
      .catch(() => setQrImagem(null));
  }, [status?.qr_code]);

  // Encerra o loading assim que o status publicado pelo worker reflete a
  // ação em andamento — "desconectando" termina quando o status vira
  // "desconectado"; "conectando" termina em qualquer status diferente de
  // "desconectado" (já apareceu o QR, ou já conectou direto com sessão salva).
  useEffect(() => {
    if (!status || !acao) return;
    if (acao === "desconectando" && status.status === "desconectado") setAcao(null);
    if (acao === "conectando" && status.status !== "desconectado") setAcao(null);
  }, [status, acao]);

  useEffect(() => {
    if (!acao) return;
    const timeout = setTimeout(() => setAcao(null), TIMEOUT_ACAO_MS);
    return () => clearTimeout(timeout);
  }, [acao]);

  async function desconectar() {
    if (!window.confirm("Desconectar o WhatsApp agora? O atendimento fica parado até reconectar.")) return;
    setAcao("desconectando");
    try {
      await api.desconectarWhatsapp();
    } catch (error) {
      setAcao(null);
      throw error;
    }
  }

  async function reconectar() {
    setAcao("conectando");
    try {
      await api.reconectarWhatsapp();
    } catch (error) {
      setAcao(null);
      throw error;
    }
  }

  if (!status) {
    return <div className="empty-state">Carregando…</div>;
  }

  return (
    <div className="whatsapp-page">
      <Topbar />

      <div className="page-header">
        <p className="page-title">WhatsApp</p>
        <p className="page-sub">Status da conexão do número usado nos atendimentos, desconectar ou trocar de número.</p>
      </div>

      <div className="whatsapp-scroll">
        <section className="secao">
          <div className="whatsapp-status-row">
            <span className={`whatsapp-badge whatsapp-badge-${status.status}`}>{LABEL_STATUS[status.status]}</span>
            {status.status === "conectado" && status.numero_conectado && (
              <span className="whatsapp-numero">conectado como {status.numero_conectado}</span>
            )}
          </div>

          {status.status === "desconectado" && (
            <div className="whatsapp-acao-bloco">
              <p className="secao-desc">Nenhum WhatsApp conectado no momento — mensagens de clientes não chegam ao painel.</p>
              <button className="whatsapp-botao whatsapp-botao-primario" disabled={acao !== null} onClick={reconectar}>
                {acao === "conectando" && <span className="whatsapp-spinner" />}
                {acao === "conectando" ? "Conectando…" : "Conectar"}
              </button>
            </div>
          )}

          {status.status === "aguardando_qr" && (
            <div className="whatsapp-acao-bloco">
              <p className="secao-desc">Abra o WhatsApp no celular que vai atender, vá em Aparelhos conectados e escaneie o QR code abaixo.</p>
              {qrImagem ? (
                <img className="whatsapp-qr" src={qrImagem} alt="QR code para conectar o WhatsApp" width={260} height={260} />
              ) : (
                <div className="whatsapp-qr whatsapp-qr-vazio">Gerando QR code…</div>
              )}
            </div>
          )}

          {status.status === "conectado" && (
            <div className="whatsapp-acao-bloco whatsapp-acoes-linha">
              <button className="whatsapp-botao whatsapp-botao-perigo" disabled={acao !== null} onClick={desconectar}>
                {acao === "desconectando" && <span className="whatsapp-spinner" />}
                {acao === "desconectando" ? "Desconectando…" : "Desconectar"}
              </button>
              <button className="whatsapp-botao" disabled={acao !== null} onClick={reconectar}>
                {acao === "conectando" && <span className="whatsapp-spinner" />}
                {acao === "conectando" ? "Conectando…" : "Conectar outro número"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
