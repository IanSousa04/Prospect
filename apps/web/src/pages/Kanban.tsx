import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AtendimentoComContexto, EstagioOperacional, Mensagem } from "@prospect/shared";
import { api } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import { KANBAN_COLUNAS } from "../components/statusMeta.js";
import Topbar from "../components/Topbar.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { useToast } from "../components/Toast.js";
import ColunaKanban from "./kanban/ColunaKanban.js";
import KanbanCard from "./kanban/KanbanCard.js";
import ResumoOperacional from "./kanban/ResumoOperacional.js";
import { mensagemDeErro, type AcaoKanban } from "./kanban/acoes.js";
import "./Kanban.css";

// Quantas mensagens mais recentes aparecem no preview de hover do card.
const PREVIEW_QTD_MENSAGENS = 4;
// Espera antes de disparar a busca — evita disparar um fetch a cada card que
// o mouse só "passa por cima" rapidamente indo pra outro lugar.
const PREVIEW_DELAY_MS = 350;
// Uma ação real (entregar, por exemplo) toca `pedidos` e `atendimentos`: sem
// isso o realtime dispararia dois refetches completos do board seguidos.
const REFETCH_DEBOUNCE_MS = 300;

type EstadoPreview = { atendimentoId: string; rect: DOMRect } | null;
type AcaoPendente = { atendimento: AtendimentoComContexto; acao: AcaoKanban } | null;

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
  const mostrarToast = useToast();

  const [acaoPendente, setAcaoPendente] = useState<AcaoPendente>(null);
  const [executandoEm, setExecutandoEm] = useState<string | null>(null);

  // Preview de hover — mostrar as últimas mensagens sem precisar clicar pra
  // abrir o atendimento. Cache por atendimento pra não refazer a busca toda
  // vez que o mouse volta a passar pelo mesmo card.
  const [preview, setPreview] = useState<EstadoPreview>(null);
  const [cachePreview, setCachePreview] = useState<Record<string, Mensagem[]>>({});
  const showTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function aoEntrarNoCard(atendimentoId: string, e: React.MouseEvent<HTMLElement>) {
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
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const recarregar = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(carregar, REFETCH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("atendimentos-kanban")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos" }, recarregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, recarregar)
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const porColuna = useMemo(() => {
    const grupos = new Map<EstagioOperacional, AtendimentoComContexto[]>();
    for (const estagio of KANBAN_COLUNAS) grupos.set(estagio, []);
    // Ordenação de cada coluna: "Solicitou humano" sempre no topo (alerta pro
    // operador), depois pela última interação — mais recente primeiro, mesmo
    // comportamento da lista do WhatsApp.
    for (const a of atendimentos) {
      const itens = grupos.get(a.estagio_operacional);
      if (itens) itens.push(a);
    }
    for (const itens of grupos.values()) {
      itens.sort((x, y) => {
        const xUrgente = x.status === "solicitou_humano" ? 0 : 1;
        const yUrgente = y.status === "solicitou_humano" ? 0 : 1;
        if (xUrgente !== yUrgente) return xUrgente - yUrgente;
        return new Date(y.ultima_mensagem_em).getTime() - new Date(x.ultima_mensagem_em).getTime();
      });
    }
    return grupos;
  }, [atendimentos]);

  // Tick de 1s só quando existe cronômetro vivo na tela (espera ou
  // atendimento em curso); nas outras colunas o tempo é grosso (min/h) e não
  // justifica um re-render por segundo.
  const precisaTick = useMemo(
    () =>
      atendimentos.some(
        (a) => a.status === "solicitou_humano" || a.status === "humano_atendendo",
      ),
    [atendimentos],
  );
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!precisaTick) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [precisaTick]);

  async function confirmarAcao() {
    if (!acaoPendente) return;
    const { atendimento, acao } = acaoPendente;
    setExecutandoEm(atendimento.id);
    try {
      await acao.executar(atendimento);
      setAcaoPendente(null);
      mostrarToast(acao.toast);
      await carregar();
    } catch (e) {
      setAcaoPendente(null);
      mostrarToast(mensagemDeErro(e), "erro");
    } finally {
      setExecutandoEm(null);
    }
  }

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
        <ResumoOperacional porColuna={porColuna} />
      </div>

      <div className="board">
        {KANBAN_COLUNAS.map((estagio) => {
          const itens = porColuna.get(estagio) ?? [];
          return (
            <ColunaKanban estagio={estagio} total={itens.length} key={estagio}>
              {itens.map((a) => (
                <KanbanCard
                  key={a.id}
                  atendimento={a}
                  agora={agora}
                  emExecucao={executandoEm === a.id}
                  onAbrir={() => navigate(`/atendimentos/${a.id}`)}
                  onAcao={(acao) => setAcaoPendente({ atendimento: a, acao })}
                  onEntrarNoCard={(e) => aoEntrarNoCard(a.id, e)}
                  onSairDoCard={aoSairDoCard}
                />
              ))}
              {itens.length === 0 && <div className="empty-state">Nenhum atendimento</div>}
            </ColunaKanban>
          );
        })}
      </div>

      {acaoPendente && (
        <ConfirmDialog
          {...acaoPendente.acao.confirmacao}
          destrutivo={acaoPendente.acao.destrutivo}
          emExecucao={executandoEm === acaoPendente.atendimento.id}
          onConfirmar={confirmarAcao}
          onCancelar={() => setAcaoPendente(null)}
        />
      )}

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
