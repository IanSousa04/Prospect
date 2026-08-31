import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  AtendimentoComContexto,
  EnderecoEntrega,
  EstadoCheckout,
  FormaPagamento,
  InformacaoPendente,
  MensagemComMidia,
  MidiaFalhaMensagem,
  MidiaMensagem,
  PedidoDetalhado,
  Produto,
  ResumoPedidoIa,
  StatusPedido,
  TipoEntrega,
} from "@prospect/shared";
import { STATUS_PEDIDO_EDITAVEIS } from "@prospect/shared";
import { api } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import { STATUS_ATENDIMENTO_META } from "../components/statusMeta.js";
import PedidoBuilder from "../components/PedidoBuilder.js";
import "./Atendimento.css";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Espelha TRANSICOES de apps/api/src/routes/pedidos.ts — só pra filtrar o
// select e evitar que o usuário escolha uma transição que o servidor recusa.
const TRANSICOES_PEDIDO: Record<StatusPedido, StatusPedido[]> = {
  aberto: ["aberto", "em_preparacao", "cancelado"],
  em_preparacao: ["em_preparacao", "pronto", "cancelado"],
  pronto: ["pronto", "entregue", "cancelado"],
  entregue: ["entregue"],
  cancelado: ["cancelado"],
};

const STATUS_PEDIDO_LABEL: Record<StatusPedido, string> = {
  aberto: "Aberto",
  em_preparacao: "Em preparação",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

// Espelha InformacaoPendente de packages/shared/src/pedido-ia.ts — só pra
// exibir de forma legível o que falta no carrinho que a IA está montando.
const PENDENCIA_LABEL: Record<InformacaoPendente, string> = {
  produtos: "Adicionar produtos",
  tipo_entrega: "Definir tipo de entrega",
  endereco: "Informar endereço",
  forma_pagamento: "Definir forma de pagamento",
  confirmacao_final: "Confirmação final do pedido",
};

/** Etapa do checkout derivada do mesmo estado que a IA usa
 * (`derivarEstadoCheckout`, packages/shared) — tarefa 0081, CLAUDE.md
 * regra 8: o humano enxerga exatamente a etapa em que o workflow está,
 * nunca um cálculo paralelo da tela. */
const ESTADO_CHECKOUT_LABEL: Record<EstadoCheckout, string> = {
  sem_carrinho: "Sem carrinho",
  montando_carrinho: "Montando carrinho",
  dados_completos: "Dados completos — resumo ainda não apresentado",
  aguardando_confirmacao: "Aguardando confirmação do cliente",
  pedido_criado: "Pedido já criado nesta conversa",
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
const IconX = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6L6 18M6 6l12 12" />
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
const IconChevron = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
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

/** Seção colapsável do painel lateral (Handoff/Pedido/Carrinho/Cliente/
 * Intenção) — visual de referência: cabeçalho com chevron que gira,
 * conteúdo recolhe sem sumir da árvore (mantém estado do formulário/scroll
 * interno, se houver). Aberta por padrão; cada seção lembra seu próprio
 * estado via `aberta`/`onToggle` do componente pai. */
function Secao(props: {
  titulo: string;
  aberta: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="ctx-section">
      <button className="ctx-header" onClick={props.onToggle}>
        <span className="ctx-label">{props.titulo}</span>
        <span className={`ctx-chevron ${props.aberta ? "aberta" : ""}`}>{IconChevron}</span>
      </button>
      {props.aberta && <div className="ctx-body">{props.children}</div>}
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
  const [carrinhoIa, setCarrinhoIa] = useState<ResumoPedidoIa | null>(null);
  const [produtosCatalogo, setProdutosCatalogo] = useState<Produto[]>([]);
  const [produtoParaAdicionar, setProdutoParaAdicionar] = useState("");
  const [qtdParaAdicionar, setQtdParaAdicionar] = useState(1);
  const [enderecoForm, setEnderecoForm] = useState<EnderecoEntrega>({ rua: "", numero: "", bairro: "", cidade: "" });
  // Último endereço vindo do backend (IA ou humano, tanto faz a origem) —
  // usado só pra distinguir "o form ainda reflete a última sincronização"
  // de "o humano alterou algo depois dela" (ver `carregar()` abaixo).
  const ultimoEnderecoSincronizado = useRef<EnderecoEntrega | null>(null);
  const [mostrarPedidoBuilder, setMostrarPedidoBuilder] = useState(false);
  const [secoesAbertas, setSecoesAbertas] = useState<Record<string, boolean>>({
    handoff: true,
    carrinho: true,
    pedido: true,
    cliente: true,
    intencao: true,
  });
  const alternarSecao = (chave: string) =>
    setSecoesAbertas((s) => ({ ...s, [chave]: !s[chave] }));

  useEffect(() => {
    api.listarProdutos().then((lista) => setProdutosCatalogo(lista.filter((p) => p.status === "ativo")));
  }, []);

  async function carregar() {
    if (!id) return;
    const [a, m, c] = await Promise.all([
      api.buscarAtendimento(id),
      api.listarMensagens(id),
      api.buscarCarrinhoIa(id),
    ]);
    setAtendimento(a);
    setMensagens(m);
    setCarrinhoIa(c);
    // Só sobrescreve o form de endereço se ele ainda estiver exatamente
    // como a última sincronização deixou — nunca apaga uma edição humana em
    // andamento (ex.: realtime atualizando por causa de outra mudança da
    // IA), mas também nunca trava numa sincronização antiga só porque o
    // form já tinha ALGUM valor (bug real: uma vez preenchido pela IA, uma
    // correção posterior de endereço pelo cliente nunca aparecia na UI).
    setEnderecoForm((atual) => {
      const anterior = ultimoEnderecoSincronizado.current;
      const enderecoVazio = !(atual.rua || atual.numero || atual.bairro || atual.cidade);
      const igualAoUltimoSincronizado =
        anterior != null &&
        atual.rua === anterior.rua &&
        atual.numero === anterior.numero &&
        atual.bairro === anterior.bairro &&
        atual.cidade === anterior.cidade &&
        (atual.complemento ?? "") === (anterior.complemento ?? "") &&
        (atual.referencia ?? "") === (anterior.referencia ?? "");
      return enderecoVazio || igualAoUltimoSincronizado ? c.endereco ?? atual : atual;
    });
    ultimoEnderecoSincronizado.current = c.endereco ?? null;
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ia_sessoes",
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

  const meta = STATUS_ATENDIMENTO_META[atendimento.status];
  // Terminal (resolvido/cancelado): nada de assumir/devolver/finalizar/cancelar.
  const terminal = atendimento.status === "resolvido" || atendimento.status === "cancelado";
  const podeAssumir = !terminal && atendimento.status !== "humano_atendendo";
  // Espelha a checagem do backend (POST /atendimentos/:id/devolver-ia) —
  // já ativo com a IA ou já encerrado não tem pra onde devolver.
  const podeDevolverParaIa = !terminal && atendimento.status !== "ia_atendendo";
  const podeFinalizar = !terminal;
  // Cancelar a conversa só faz sentido sem pedido ativo — espelha a guarda do
  // backend (POST /atendimentos/:id/cancelar).
  const podeCancelar = !terminal && !atendimento.pedido_estagio;

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

  async function cancelar() {
    if (!id) return;
    if (!window.confirm("Cancelar este atendimento? Essa ação não pode ser desfeita pela tela.")) return;
    try {
      await api.cancelarAtendimento(id);
      carregar();
    } catch (err) {
      const mensagem =
        err instanceof Error && err.message.includes("pedido_ativo_impede_cancelar")
          ? "Este atendimento tem um pedido ativo — cancele o pedido primeiro."
          : "Não foi possível cancelar o atendimento.";
      window.alert(mensagem);
    }
  }

  // Edição do carrinho da IA pelo humano (tarefa 0063, CLAUDE.md regra 8) —
  // mesmo estado que a IA usa (ia_sessoes.estado_json.pedido), nunca um
  // pedido paralelo. Cada ação já volta o resumo atualizado da API, então
  // atualiza o estado local direto (sem esperar o próximo `carregar()`).
  async function adicionarItemCarrinho() {
    if (!id || !produtoParaAdicionar) return;
    try {
      const atualizado = await api.adicionarItemCarrinhoIa(id, {
        produto_id: produtoParaAdicionar,
        quantidade: qtdParaAdicionar,
      });
      setCarrinhoIa(atualizado);
      setProdutoParaAdicionar("");
      setQtdParaAdicionar(1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível adicionar o item.");
    }
  }

  async function alterarQuantidadeCarrinho(linhaId: string, novaQuantidade: number) {
    if (!id || novaQuantidade < 1) return;
    try {
      setCarrinhoIa(await api.atualizarItemCarrinhoIa(id, linhaId, { quantidade: novaQuantidade }));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível atualizar o item.");
    }
  }

  async function removerItemCarrinho(linhaId: string) {
    if (!id) return;
    try {
      setCarrinhoIa(await api.removerItemCarrinhoIa(id, linhaId));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível remover o item.");
    }
  }

  async function definirTipoEntregaCarrinho(tipo: TipoEntrega | "") {
    if (!id) return;
    try {
      setCarrinhoIa(
        await api.definirEntregaCarrinhoIa(id, {
          tipo_entrega: tipo || null,
          endereco: tipo === "entrega" ? carrinhoIa?.endereco ?? null : null,
        }),
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível definir o tipo de entrega.");
    }
  }

  async function salvarEnderecoCarrinho() {
    if (!id) return;
    try {
      setCarrinhoIa(await api.definirEntregaCarrinhoIa(id, { tipo_entrega: "entrega", endereco: enderecoForm }));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível salvar o endereço.");
    }
  }

  async function definirPagamentoCarrinho(forma: FormaPagamento | "") {
    if (!id) return;
    try {
      setCarrinhoIa(await api.definirPagamentoCarrinhoIa(id, forma || null));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível definir a forma de pagamento.");
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
            className="btn-success"
            onClick={finalizar}
            disabled={!podeFinalizar}
          >
            {IconCheck}
            Finalizar atendimento
          </button>
          <button
            className="btn-danger"
            onClick={cancelar}
            disabled={!podeCancelar}
            title={podeCancelar ? undefined : "Só é possível cancelar sem pedido ativo"}
          >
            {IconX}
            Cancelar atendimento
          </button>
        </div>
      </div>

      <div className="body">
        <div className="convo">
          <div className="convo-scroll">
            {mensagens.map((m) => (
              <div key={m.id} className={`msg-row from-${m.remetente}`}>
                <div className="msg-tag">
                  {m.remetente === "ia" && STATUS_ATENDIMENTO_META.ia_atendendo.icon}
                  {m.remetente === "humano" &&
                    STATUS_ATENDIMENTO_META.humano_atendendo.icon}
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
            <Secao
              titulo="Handoff pendente"
              aberta={secoesAbertas.handoff ?? true}
              onToggle={() => alternarSecao("handoff")}
            >
              <div className="handoff-card">
                <div className="handoff-head">
                  {STATUS_ATENDIMENTO_META.solicitou_humano.icon}
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
            </Secao>
          )}

          {/* Carrinho que a IA está montando (ia_sessoes.estado_json.pedido)
              — editável pelo humano (tarefa 0063, CLAUDE.md regra 8): mesmo
              estado que a IA usa, nunca um pedido paralelo. Some quando já
              existe um pedido real (`pedido` — POST /pedidos ou confirmação
              da IA, tarefa 0055), que passa a ser a fonte real no card
              "Pedido" abaixo. */}
          {!pedido && carrinhoIa && (
            <Secao
              titulo="Carrinho (IA)"
              aberta={secoesAbertas.carrinho ?? true}
              onToggle={() => alternarSecao("carrinho")}
            >
              <div className="order-card">
                {carrinhoIa.itens.map((item) => {
                  const precoComOpcoes =
                    item.preco_unitario +
                    item.opcoes.reduce((acc, o) => acc + o.preco_adicional, 0);
                  return (
                    <div key={item.linha_id} className="carrinho-item-row">
                      <div className="order-item">
                        <span>{item.nome_produto}</span>
                        <span className="mono">{currency.format(precoComOpcoes * item.quantidade)}</span>
                      </div>
                      {item.observacoes && (
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{item.observacoes}</div>
                      )}
                      {item.opcoes.length > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {item.opcoes.map((o) => o.nome_opcao).join(", ")}
                        </div>
                      )}
                      <div className="carrinho-item-controles">
                        <button className="qtd-btn" onClick={() => alterarQuantidadeCarrinho(item.linha_id, item.quantidade - 1)}>
                          −
                        </button>
                        <span className="qtd-valor">{item.quantidade}</span>
                        <button className="qtd-btn" onClick={() => alterarQuantidadeCarrinho(item.linha_id, item.quantidade + 1)}>
                          +
                        </button>
                        <button className="carrinho-remover-btn" onClick={() => removerItemCarrinho(item.linha_id)}>
                          Remover
                        </button>
                      </div>
                    </div>
                  );
                })}
                {carrinhoIa.itens.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>Nenhum item ainda.</div>
                )}

                <div className="carrinho-add-row">
                  <select value={produtoParaAdicionar} onChange={(e) => setProdutoParaAdicionar(e.target.value)}>
                    <option value="">Adicionar produto…</option>
                    {produtosCatalogo.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome} — {currency.format(p.preco_promocional ?? p.preco)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={qtdParaAdicionar}
                    onChange={(e) => setQtdParaAdicionar(Math.max(1, Number(e.target.value)))}
                  />
                  <button className="btn-ghost" onClick={adicionarItemCarrinho} disabled={!produtoParaAdicionar}>
                    Adicionar
                  </button>
                </div>

                {carrinhoIa.itens.length > 0 && (
                  <div className="order-total">
                    <span>Subtotal</span>
                    <span className="mono">{currency.format(carrinhoIa.subtotal)}</span>
                  </div>
                )}
              </div>

              <div className="carrinho-field">
                <label>Tipo de entrega</label>
                <select
                  value={carrinhoIa.tipo_entrega ?? ""}
                  onChange={(e) => definirTipoEntregaCarrinho(e.target.value as TipoEntrega | "")}
                >
                  <option value="">Não definido</option>
                  <option value="entrega">Entrega</option>
                  <option value="retirada">Retirada no local</option>
                </select>
              </div>

              {carrinhoIa.tipo_entrega === "entrega" && (
                <div className="carrinho-endereco">
                  <div className="carrinho-field-row">
                    <input
                      placeholder="Rua"
                      value={enderecoForm.rua}
                      onChange={(e) => setEnderecoForm((f) => ({ ...f, rua: e.target.value }))}
                    />
                    <input
                      placeholder="Número"
                      value={enderecoForm.numero}
                      onChange={(e) => setEnderecoForm((f) => ({ ...f, numero: e.target.value }))}
                    />
                  </div>
                  <div className="carrinho-field-row">
                    <input
                      placeholder="Bairro"
                      value={enderecoForm.bairro}
                      onChange={(e) => setEnderecoForm((f) => ({ ...f, bairro: e.target.value }))}
                    />
                    <input
                      placeholder="Cidade"
                      value={enderecoForm.cidade}
                      onChange={(e) => setEnderecoForm((f) => ({ ...f, cidade: e.target.value }))}
                    />
                  </div>
                  <button className="btn-ghost" style={{ width: "100%" }} onClick={salvarEnderecoCarrinho}>
                    Salvar endereço
                  </button>
                </div>
              )}

              <div className="carrinho-field">
                <label>Forma de pagamento</label>
                <select
                  value={carrinhoIa.forma_pagamento ?? ""}
                  onChange={(e) => definirPagamentoCarrinho(e.target.value as FormaPagamento | "")}
                >
                  <option value="">Não definido</option>
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao_credito">Cartão de crédito</option>
                  <option value="cartao_debito">Cartão de débito</option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              <div className="carrinho-pendencias">
                <div className="ctx-sublabel">Etapa do checkout</div>
                <div className="tag-pill">{ESTADO_CHECKOUT_LABEL[carrinhoIa.estado_checkout]}</div>
              </div>

              {carrinhoIa.ultimo_pedido_criado && (
                <div className="carrinho-pendencias">
                  <div className="ctx-sublabel">Pedido criado a partir deste carrinho</div>
                  <div className="tag-pill">
                    Criado às{" "}
                    {new Date(carrinhoIa.ultimo_pedido_criado.criado_em).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    — ver no card "Pedido"
                  </div>
                </div>
              )}

              {carrinhoIa.aguardando_confirmacao && (
                <div className="carrinho-pendencias">
                  <div className="ctx-sublabel">Resumo aguardando confirmação</div>
                  <div className="tag-pill tag-pill-pendencia">
                    Aguardando confirmação do cliente — expira às{" "}
                    {new Date(carrinhoIa.aguardando_confirmacao.expiraEm).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              )}

              {carrinhoIa.pendencias.length > 0 && (
                <div className="carrinho-pendencias">
                  <div className="ctx-sublabel">Falta pro pedido fechar</div>
                  <div className="tags-row">
                    {carrinhoIa.pendencias.map((p) => (
                      <div className="tag-pill tag-pill-pendencia" key={p}>
                        {PENDENCIA_LABEL[p]}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="carrinho-hint">
                Editável por você e pela IA no mesmo estado — vira pedido só quando confirmado. Editar
                qualquer coisa aqui invalida automaticamente uma confirmação pendente do cliente.
              </div>
            </Secao>
          )}

          <Secao
            titulo="Pedido"
            aberta={secoesAbertas.pedido ?? true}
            onToggle={() => alternarSecao("pedido")}
          >
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
          </Secao>

          <Secao
            titulo="Cliente"
            aberta={secoesAbertas.cliente ?? true}
            onToggle={() => alternarSecao("cliente")}
          >
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
          </Secao>

          <Secao
            titulo="Intenção detectada"
            aberta={secoesAbertas.intencao ?? true}
            onToggle={() => alternarSecao("intencao")}
          >
            <div className="intent-pill" style={{ display: "inline-block" }}>
              {atendimento.intencao ?? "Não identificada"}
            </div>
          </Secao>
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
