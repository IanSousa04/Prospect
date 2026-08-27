import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AtendimentoComContexto, Mensagem } from "@prospect/shared";
import { api } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import { KANBAN_COLUNAS, STATUS_META, tempoDecorrido } from "../components/statusMeta.js";
import Topbar from "../components/Topbar.js";
import "./Kanban.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Quantas mensagens mais recentes aparecem no preview de hover do card.
const PREVIEW_QTD_MENSAGENS = 4;
// Espera antes de disparar a busca — evita disparar um fetch a cada card que
// o mouse só "passa por cima" rapidamente indo pra outro lugar.
const PREVIEW_DELAY_MS = 350;

type EstadoPreview = { atendimentoId: string; rect: DOMRect } | null;

/** Remetente → label/ícone curtos, mesmo mapeamento visual da tela de
 * Atendimento (msg-tag), só compacto pro popover. */
function rotuloRemetente(remetente: Mensagem["remetente"]): string {
  if (remetente === "cliente") return "Cliente";
  if (remetente === "ia") return "IA";
  return "Humano";
}

export default function Kanban() {
  const [atendimentos, setAtendimentos] = useState<AtendimentoComContexto[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const navigate = useNavigate();

  // Preview de hover — ver docs do pedido: mostrar as últimas mensagens
  // sem precisar clicar pra abrir o atendimento. Cache por atendimento pra
  // não refazer a busca toda vez que o mouse volta a passar pelo mesmo card.
  const [preview, setPreview] = useState<EstadoPreview>(null);
  const [cachePreview, setCachePreview] = useState<Record<string, Mensagem[]>>({});
  const showTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function aoEntrarNoCard(atendimentoId: string, e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (showTimeout.current) clearTimeout(showTimeout.current);
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    showTimeout.current = setTimeout(() => {
      setPreview({ atendimentoId, rect });
      if (!cachePreview[atendimentoId]) {
        api.listarMensagens(atendimentoId).then((msgs) => {
          setCachePreview((prev) => ({ ...prev, [atendimentoId]: msgs.slice(-PREVIEW_QTD_MENSAGENS) }));
        });
      }
    }, PREVIEW_DELAY_MS);
  }

  // Pequena tolerância antes de esconder — dá tempo do mouse atravessar o
  // espaço entre o card e o popover sem ele "piscar" e sumir no meio do caminho.
  function aoSairDoCard() {
    if (showTimeout.current) clearTimeout(showTimeout.current);
    hideTimeout.current = setTimeout(() => setPreview(null), 150);
  }

  function aoEntrarNoPopover() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
  }

  async function carregar() {
    try {
      const dados = await api.listarAtendimentos();
      setAtendimentos(dados);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar atendimentos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();

    // Realtime: qualquer mudança em atendimentos desta empresa recarrega o
    // Kanban — RLS garante que só chega evento da empresa do usuário logado.
    const channel = supabase
      .channel("atendimentos-kanban")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos" }, () => {
        carregar();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => {
        carregar();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const porColuna = useMemo(() => {
    const grupos = new Map<string, AtendimentoComContexto[]>();
    for (const status of KANBAN_COLUNAS) grupos.set(status, []);
    for (const a of atendimentos) grupos.get(a.status)?.push(a);
    return grupos;
  }, [atendimentos]);

  if (loading) {
    return <div className="empty-state">Carregando atendimentos…</div>;
  }

  if (erro) {
    return <div className="empty-state">{erro}</div>;
  }

  return (
    <div className="board-page">
      <Topbar />

      <div className="page-header">
        <div>
          <p className="page-title">Atendimentos</p>
          <p className="page-sub">{atendimentos.length} conversas ativas</p>
        </div>
        <div className="filters">
          <div className="chip active">
            Todos <span className="chip-count">{atendimentos.length}</span>
          </div>
          {KANBAN_COLUNAS.map((status) => (
            <div className="chip" key={status}>
              {STATUS_META[status].label}{" "}
              <span className="chip-count">{porColuna.get(status)?.length ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="board">
        {KANBAN_COLUNAS.map((status) => {
          const meta = STATUS_META[status];
          const itens = porColuna.get(status) ?? [];
          return (
            <div className="col" key={status}>
              <div className="col-head">
                <div className="col-dot" style={{ background: meta.accentVar }} />
                <div className="col-title">{meta.label}</div>
                <div className="col-count">{itens.length}</div>
              </div>
              <div className="col-body">
                {itens.map((a) => (
                  <button
                    key={a.id}
                    className="card"
                    style={
                      {
                        "--accent": meta.accentVar,
                        "--accent-bg": meta.accentBgVar,
                      } as React.CSSProperties
                    }
                    onClick={() => navigate(`/atendimentos/${a.id}`)}
                    onMouseEnter={(e) => aoEntrarNoCard(a.id, e)}
                    onMouseLeave={aoSairDoCard}
                  >
                    <div className="card-top">
                      <div className="card-owner">
                        <div className="owner-icon">{meta.icon}</div>
                        <div className="card-name">{a.cliente?.nome ?? a.cliente?.telefone}</div>
                      </div>
                    </div>
                    {a.intencao && <div className="intent-pill">{a.intencao}</div>}
                    {a.handoff_aberto && (
                      <div className="handoff-note">
                        {meta.icon}
                        <span>{a.handoff_aberto.motivo}</span>
                      </div>
                    )}
                    <div className="card-bottom">
                      <div className="card-value">
                        {a.pedido_aberto ? currency.format(a.pedido_aberto.total) : "—"}
                      </div>
                      <div className="card-meta">{tempoDecorrido(a.ultima_mensagem_em)}</div>
                    </div>
                  </button>
                ))}
                {itens.length === 0 && <div className="empty-state">Nenhum atendimento</div>}
              </div>
            </div>
          );
        })}
      </div>

      {preview && (() => {
        const POPOVER_W = 300;
        const cabeNaDireita = preview.rect.right + 10 + POPOVER_W <= window.innerWidth;
        const left = cabeNaDireita ? preview.rect.right + 10 : Math.max(10, preview.rect.left - POPOVER_W - 10);
        const top = Math.min(preview.rect.top, window.innerHeight - 260);
        const atendimento = atendimentos.find((a) => a.id === preview.atendimentoId);
        const msgs = cachePreview[preview.atendimentoId];

        return (
          <div
            className="hover-preview"
            style={{ top: Math.max(10, top), left, width: POPOVER_W }}
            onMouseEnter={aoEntrarNoPopover}
            onMouseLeave={aoSairDoCard}
          >
            <div className="hover-preview-head">
              {atendimento?.cliente?.nome ?? atendimento?.cliente?.telefone ?? "Cliente"}
            </div>
            {!msgs && <div className="hover-preview-loading">Carregando…</div>}
            {msgs && msgs.length === 0 && <div className="hover-preview-loading">Nenhuma mensagem ainda.</div>}
            {msgs?.map((m) => (
              <div key={m.id} className={`hover-preview-msg from-${m.remetente}`}>
                <span className="hover-preview-tag">{rotuloRemetente(m.remetente)}</span>
                <span className="hover-preview-txt">{m.conteudo}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
