import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  AtendimentoComContexto,
  MensagemComMidia,
  MidiaFalhaMensagem,
  MidiaMensagem,
  PedidoDetalhado,
  StatusPedido,
} from "@prospect/shared";
import { STATUS_PEDIDO_EDITAVEIS } from "@prospect/shared";
import { api } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import { STATUS_META } from "../components/statusMeta.js";
import PedidoBuilder from "../components/PedidoBuilder.js";
import "./Atendimento.css";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Espelha TRANSICOES de apps/api/src/routes/pedidos.ts — só pra filtrar o
// select e evitar que o usuário escolha uma transição que o servidor recusa.
const TRANSICOES_PEDIDO: Record<StatusPedido, StatusPedido[]> = {
  aberto: ["aberto", "confirmado", "cancelado"],
  confirmado: ["confirmado", "em_preparo", "cancelado"],
  em_preparo: ["em_preparo", "pronto", "cancelado"],
  pronto: ["pronto", "saiu_para_entrega", "entregue", "cancelado"],
  saiu_para_entrega: ["saiu_para_entrega", "entregue", "cancelado"],
  entregue: ["entregue"],
  cancelado: ["cancelado"],
};

const STATUS_PEDIDO_LABEL: Record<StatusPedido, string> = {
  aberto: "Aberto",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  pronto: "Pronto",
  saiu_para_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

const IconBack = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const IconArrowRight = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const IconSend = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);
const IconArrowLeft = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);
const IconCheck = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const IconDownload = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
  </svg>
);
const IconMidiaIndisponivel = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 16l5-5 4 4 3-3 6 6M14 9h.01" />
    <path d="M3 3l18 18" />
  </svg>
);

const RESUMO_MIDIA: Record<MidiaMensagem["tipo"], string> = {
  imagem: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  documento: "Documento",
};

/**
 * Mídia (foto/áudio/vídeo/documento) que o cliente mandou — ver
 * docs/ROADMAP.md §1 "Cliente manda imagem/áudio". A IA não processa nada
 * disso ainda; aqui é só exibição + download pro humano que assumiu via
 * handoff. `m.midia_url` é uma signed URL de curta duração (a API gera na
 * hora, ver apps/api/src/routes/mensagens.ts) — nunca cacheie/reuse fora
 * desta renderização.
 */
function renderizarConteudoMensagem(m: MensagemComMidia): JSX.Element {
  const midia = (m.metadata_json as { midia?: MidiaMensagem } | null)?.midia;
  const midiaFalha = (
    m.metadata_json as { midia_falha?: MidiaFalhaMensagem } | null
  )?.midia_falha;

  // Download falhou (ver apps/whatsapp-worker/src/lib/media.ts) — sem
  // preview nenhum pra mostrar, mas nunca deixa isso implícito só no texto:
  // indicativo visual claro de que chegou mídia, mesmo sem conseguir exibir.
  if (midiaFalha && !m.midia_url) {
    return (
      <div className="msg-bubble msg-bubble-midia-falha">
        {IconMidiaIndisponivel}
        <div>
          <div className="msg-midia-falha-titulo">
            {RESUMO_MIDIA[midiaFalha.tipo]} recebida — sem preview
          </div>
          <div className="msg-midia-falha-texto">
            Não foi possível baixar automaticamente.
          </div>
        </div>
      </div>
    );
  }

  if (!midia || !m.midia_url) {
    return <div className="msg-bubble">{m.conteudo}</div>;
  }

  // O placeholder legível ("[Imagem recebida]" etc, ver
  // apps/whatsapp-worker/src/lib/media.ts) não precisa aparecer como
  // legenda duplicada — só mostra m.conteudo como legenda quando o cliente
  // mandou uma de verdade junto com a mídia.
  const legenda = /^\[.+\]$/.test(m.conteudo) ? null : m.conteudo;

  return (
    <div className="msg-bubble msg-bubble-midia">
      {midia.tipo === "imagem" && (
        <img src={m.midia_url} alt={legenda ?? "Imagem enviada pelo cliente"} />
      )}
      {midia.tipo === "audio" && (
        <audio controls src={m.midia_url}>
          Seu navegador não suporta áudio.
        </audio>
      )}
      {midia.tipo === "video" && <video controls src={m.midia_url} />}
      {midia.tipo === "documento" && (
        <div className="msg-midia-arquivo">
          <span>{RESUMO_MIDIA[midia.tipo]}</span>
        </div>
      )}
      {legenda && <div className="msg-midia-legenda">{legenda}</div>}
      <a
        className="msg-midia-download"
        href={m.midia_url}
        target="_blank"
        rel="noreferrer"
      >
        {IconDownload}
        Baixar {RESUMO_MIDIA[midia.tipo].toLowerCase()}
      </a>
    </div>
  );
}

function iniciais(nome: string | null): string {
  if (!nome) return "?";
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export default function Atendimento() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [atendimento, setAtendimento] = useState<AtendimentoComContexto | null>(
    null,
  );
  const [mensagens, setMensagens] = useState<MensagemComMidia[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState<PedidoDetalhado | null>(null);
  const [mostrarPedidoBuilder, setMostrarPedidoBuilder] = useState(false);

  async function carregar() {
    if (!id) return;
    const [a, m] = await Promise.all([
      api.buscarAtendimento(id),
      api.listarMensagens(id),
    ]);
    setAtendimento(a);
    setMensagens(m);
    if (a.pedido_aberto) {
      api.buscarPedido(a.pedido_aberto.id).then(setPedido);
    } else {
      setPedido(null);
    }
  }

  useEffect(() => {
    carregar();

    if (!id) return;
    const channel = supabase
      .channel(`atendimento-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mensagens",
          filter: `atendimento_id=eq.${id}`,
        },
        () => carregar(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "atendimentos",
          filter: `id=eq.${id}`,
        },
        () => carregar(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pedidos",
          filter: `atendimento_id=eq.${id}`,
        },
        () => carregar(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!atendimento) {
    return (
      <div style={{ padding: 24, color: "var(--text-3)" }}>Carregando…</div>
    );
  }

  const meta = STATUS_META[atendimento.status];
  const podeAssumir =
    atendimento.status !== "resolvido" &&
    atendimento.status !== "humano_atendendo";
  // Espelha a checagem do backend (POST /atendimentos/:id/devolver-ia) —
  // já ativo com a IA ou já encerrado não tem pra onde devolver.
  const podeDevolverParaIa =
    atendimento.status !== "ia_atendendo" && atendimento.status !== "resolvido";
  const podeFinalizar = atendimento.status !== "resolvido";

  async function assumir() {
    if (!id) return;
    await api.assumirAtendimento(id);
    carregar();
  }

  async function devolverParaIa() {
    if (!id) return;
    await api.devolverParaIa(id);
    carregar();
  }

  async function finalizar() {
    if (!id) return;
    if (!window.confirm("Finalizar este atendimento? Essa ação não pode ser desfeita pela tela.")) return;
    try {
      await api.atualizarStatus(id, "resolvido");
      carregar();
    } catch (err) {
      const mensagem =
        err instanceof Error && err.message.includes("handoff_pendente_impede_finalizar")
          ? "Existe um handoff aberto/assumido para este atendimento — resolva-o antes de finalizar."
          : "Não foi possível finalizar o atendimento.";
      window.alert(mensagem);
    }
  }

  async function enviar() {
    if (!id || !rascunho.trim()) return;
    setEnviando(true);
    try {
      await api.enviarMensagem(id, rascunho.trim());
      setRascunho("");
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="root"
      style={
        {
          "--accent": meta.accentVar,
          "--accent-bg": meta.accentBgVar,
        } as React.CSSProperties
      }
    >
      <div className="head">
        <div className="head-left">
          <button className="back-btn" onClick={() => navigate("/")}>
            {IconBack}
          </button>
          <div className="cust-avatar">
            {iniciais(atendimento.cliente.nome)}
          </div>
          <div>
            <div className="head-name">
              {atendimento.cliente.nome ?? atendimento.cliente.telefone}
            </div>
            <div className="head-meta">
              <div className="status-pill">
                {meta.icon}
                {meta.label}
              </div>
              <span>·</span>
              <span>
                Responsável:{" "}
                <span style={{ color: "var(--text-2)" }}>
                  {atendimento.responsavel_usuario_id
                    ? "atribuído"
                    : "ninguém ainda"}
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="head-right">
          <button
            className="btn-ghost"
            onClick={devolverParaIa}
            disabled={!podeDevolverParaIa}
          >
            {IconArrowLeft}
            Devolver pra IA
          </button>
          <button
            className="btn-primary"
            onClick={assumir}
            disabled={!podeAssumir}
          >
            {IconArrowRight}
            Assumir atendimento
          </button>
          <button
            className="btn-ghost"
            onClick={finalizar}
            disabled={!podeFinalizar}
          >
            {IconCheck}
            Finalizar atendimento
          </button>
        </div>
      </div>

      <div className="body">
        <div className="convo">
          <div className="convo-scroll">
            {mensagens.map((m) => (
              <div key={m.id} className={`msg-row from-${m.remetente}`}>
                <div className="msg-tag">
                  {m.remetente === "ia" && STATUS_META.ia_atendendo.icon}
                  {m.remetente === "humano" &&
                    STATUS_META.humano_atendendo.icon}
                  {m.remetente === "cliente"
                    ? "Cliente"
                    : m.remetente === "ia"
                      ? "IA"
                      : "Você"}
                </div>
                {renderizarConteudoMensagem(m)}
                <div className="msg-time">
                  {new Date(m.criado_em).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
            {mensagens.length === 0 && (
              <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                Nenhuma mensagem ainda.
              </div>
            )}
          </div>

          <div className="composer">
            {!podeAssumir ? null : (
              <div className="composer-hint">
                {IconArrowRight}
                Assuma o atendimento para responder diretamente ao cliente
              </div>
            )}
            <div className="composer-box">
              <input
                placeholder="Escreva uma mensagem…"
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enviar()}
                disabled={podeAssumir}
              />
              <button
                className="send-btn"
                onClick={enviar}
                disabled={enviando || podeAssumir || !rascunho.trim()}
              >
                {IconSend}
              </button>
            </div>
          </div>
        </div>

        <div className="ctx">
          {atendimento.handoff_aberto && (
            <div className="ctx-section">
              <div className="ctx-label">Handoff pendente</div>
              <div className="handoff-card">
                <div className="handoff-head">
                  {STATUS_META.ia_solicitou_humano.icon}
                  Novo handoff
                </div>
                <div>
                  <div className="handoff-row-label">Motivo</div>
                  <div className="handoff-row-val">
                    {atendimento.handoff_aberto.motivo}
                  </div>
                </div>
                <div>
                  <div className="handoff-row-label">Resumo</div>
                  <div className="handoff-row-val">
                    {atendimento.handoff_aberto.resumo}
                  </div>
                </div>
                {atendimento.handoff_aberto.acao_sugerida && (
                  <div>
                    <div className="handoff-row-label">Ação sugerida</div>
                    <div className="handoff-row-val">
                      {atendimento.handoff_aberto.acao_sugerida}
                    </div>
                  </div>
                )}
                <div className="handoff-foot">
                  <span className="prio-badge">
                    Prioridade {atendimento.handoff_aberto.prioridade}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-2)",
                    }}
                  >
                    origem: {atendimento.handoff_aberto.origem}
                  </span>
                </div>
                <button
                  className="assumir-handoff-btn"
                  onClick={async () => {
                    await api.assumirHandoff(atendimento.handoff_aberto!.id);
                    carregar();
                  }}
                >
                  Assumir handoff
                </button>
              </div>
            </div>
          )}

          <div className="ctx-section">
            <div className="ctx-label">Pedido</div>
            {pedido ? (
              <div className="order-card">
                {pedido.itens.map((item) => {
                  const precoComOpcoes =
                    item.preco_unitario +
                    item.opcoes.reduce((acc, o) => acc + o.preco_adicional, 0);
                  return (
                    <div key={item.id} style={{ marginBottom: 4 }}>
                      <div className="order-item">
                        <span>
                          {item.quantidade}x {item.nome_produto}
                        </span>
                        <span className="mono">
                          {currency.format(precoComOpcoes * item.quantidade)}
                        </span>
                      </div>
                      {item.opcoes.length > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {item.opcoes.map((o) => o.nome_opcao).join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="order-total">
                  <span>Total</span>
                  <span className="mono">{currency.format(pedido.total)}</span>
                </div>
                {STATUS_PEDIDO_EDITAVEIS.includes(pedido.status) ? (
                  <select
                    value={pedido.status}
                    onChange={async (e) => {
                      try {
                        const atualizado = await api.atualizarStatusPedido(
                          pedido.id,
                          e.target.value as StatusPedido,
                        );
                        setPedido((p) =>
                          p ? { ...p, status: atualizado.status } : p,
                        );
                      } catch {
                        carregar();
                      }
                    }}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      background: "var(--bg-raised)",
                      border: "1px solid var(--border-soft)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      color: "var(--text-1)",
                      fontSize: 12,
                    }}
                  >
                    {TRANSICOES_PEDIDO[pedido.status].map((valor) => (
                      <option key={valor} value={valor}>
                        {STATUS_PEDIDO_LABEL[valor]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--text-3)",
                    }}
                  >
                    {STATUS_PEDIDO_LABEL[pedido.status]}
                  </div>
                )}
              </div>
            ) : (
              <button
                className="btn-ghost"
                style={{ width: "100%" }}
                onClick={() => setMostrarPedidoBuilder(true)}
              >
                + Novo pedido
              </button>
            )}
          </div>

          <div className="ctx-section">
            <div className="ctx-label">Cliente</div>
            <div className="cust-name">
              {atendimento.cliente.nome ?? "Sem nome"}
            </div>
            <div className="cust-phone">{atendimento.cliente.telefone}</div>
            <div className="kv-row">
              <span className="k">Cliente desde</span>
              <span className="v">
                {new Date(
                  atendimento.cliente.primeiro_contato_em,
                ).toLocaleDateString("pt-BR", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            {atendimento.cliente.tags.length > 0 && (
              <div className="tags-row">
                {atendimento.cliente.tags.map((tag) => (
                  <div className="tag-pill" key={tag}>
                    {tag.replaceAll("_", " ")}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ctx-section">
            <div className="ctx-label">Intenção detectada</div>
            <div className="intent-pill" style={{ display: "inline-block" }}>
              {atendimento.intencao ?? "Não identificada"}
            </div>
          </div>
        </div>
      </div>

      {mostrarPedidoBuilder && id && (
        <PedidoBuilder
          clienteId={atendimento.cliente.id}
          atendimentoId={id}
          onFechar={() => setMostrarPedidoBuilder(false)}
          onCriado={() => {
            setMostrarPedidoBuilder(false);
            carregar();
          }}
        />
      )}
    </div>
  );
}
