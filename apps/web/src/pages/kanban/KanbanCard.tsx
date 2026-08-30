import type { AtendimentoComContexto } from "@prospect/shared";
import { STATUS_META, duracaoAtendimento, tempoDecorrido, tempoEspera } from "../../components/statusMeta.js";
import { acoesDoCard, type AcaoKanban } from "./acoes.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const ITENS_VISIVEIS = 3;

/** Quem está conduzindo o atendimento — propriedade do atendimento, não da
 * coluna. É o ponto da reestruturação: a coluna diz a ETAPA, o card diz o
 * RESPONSÁVEL, e as duas informações nunca mais se confundem. */
function Responsavel({ a }: { a: AtendimentoComContexto }) {
  const ia = a.status === "ia_atendendo";
  return (
    <span className={`card-responsavel${ia ? " card-responsavel-ia" : ""}`}>
      <span aria-hidden="true">{ia ? "🤖" : "👤"}</span>
      {ia ? "IA" : (a.responsavel?.nome ?? "Humano")}
    </span>
  );
}

/** Tempo mostrado no card, que muda de significado conforme a etapa: na
 * coluna de espera é há quanto tempo o cliente aguarda (com nível de
 * atenção), em atendimento é a duração do atendimento, e no resto é só o
 * tempo desde a última movimentação. */
function tempoDoCard(a: AtendimentoComContexto): { rotulo: string; texto: string; nivel: string } {
  if (a.estagio_operacional === "aguardando_humano") {
    const { texto, nivel } = tempoEspera(a.handoff_aberto?.criado_em ?? a.ultima_mensagem_em);
    return { rotulo: "aguardando há", texto, nivel };
  }
  if (a.estagio_operacional === "em_atendimento" && a.assumido_em) {
    return { rotulo: "em atendimento há", texto: duracaoAtendimento(a.assumido_em), nivel: "normal" };
  }
  if (a.pedido_estagio && (a.estagio_operacional === "na_cozinha" || a.estagio_operacional === "pronto")) {
    const prefixo = a.estagio_operacional === "na_cozinha" ? "preparando há" : "pronto há";
    return { rotulo: prefixo, texto: tempoDecorrido(a.pedido_estagio.atualizado_em), nivel: "normal" };
  }
  return { rotulo: "última mensagem", texto: tempoDecorrido(a.ultima_mensagem_em), nivel: "normal" };
}

interface Props {
  atendimento: AtendimentoComContexto;
  /** Muda a cada tick de 1s só pra forçar o recálculo dos cronômetros. */
  agora: number;
  emExecucao: boolean;
  onAbrir: () => void;
  onAcao: (acao: AcaoKanban) => void;
  onEntrarNoCard: (e: React.MouseEvent<HTMLElement>) => void;
  onSairDoCard: () => void;
}

export default function KanbanCard({
  atendimento: a,
  emExecucao,
  onAbrir,
  onAcao,
  onEntrarNoCard,
  onSairDoCard,
}: Props) {
  const meta = STATUS_META[a.estagio_operacional];
  const pedido = a.pedido_estagio;
  const acoes = acoesDoCard(a);
  const tempo = tempoDoCard(a);
  const itens = pedido?.itens ?? [];
  const restantes = itens.length - ITENS_VISIVEIS;

  return (
    <article
      className={`card card-espera-${tempo.nivel}`}
      style={{ "--accent": meta.accentVar, "--accent-bg": meta.accentBgVar } as React.CSSProperties}
      onMouseEnter={onEntrarNoCard}
      onMouseLeave={onSairDoCard}
    >
      {/* O card inteiro é clicável pra abrir a conversa, mas os botões de ação
          ficam FORA desse botão — antes havia um <button> dentro de outro. */}
      <button className="card-abrir" onClick={onAbrir}>
        <div className="card-top">
          <span className="card-name">{a.cliente?.nome ?? a.cliente?.telefone}</span>
          {pedido?.numero != null && <span className="card-numero mono">#{pedido.numero}</span>}
        </div>

        {a.handoff_aberto && a.estagio_operacional === "aguardando_humano" && (
          <div className="handoff-note">
            {meta.icon}
            <span>
              {a.handoff_aberto.origem === "cliente_solicitou" ? "Cliente pediu" : "IA solicitou"} —{" "}
              {a.handoff_aberto.motivo}
            </span>
          </div>
        )}

        {pedido?.status === "aberto" && <div className="card-aviso">Pedido montado, aguardando confirmação</div>}

        {itens.length > 0 && (
          <ul className="card-itens">
            {itens.slice(0, ITENS_VISIVEIS).map((item, i) => (
              <li key={`${item.nome_produto}-${i}`}>
                <span className="card-item-qtd mono">{item.quantidade}x</span> {item.nome_produto}
              </li>
            ))}
            {restantes > 0 && <li className="card-itens-mais">+{restantes} item(ns)</li>}
          </ul>
        )}

        {!pedido && a.intencao && <div className="intent-pill">{a.intencao}</div>}

        <div className="card-bottom">
          <Responsavel a={a} />
          <span className="card-tempo" title={tempo.rotulo}>
            <span aria-hidden="true">⏱</span>
            <span className="mono">{tempo.texto}</span>
          </span>
        </div>

        {pedido && <div className="card-total mono">{currency.format(pedido.total)}</div>}
      </button>

      {acoes.length > 0 && (
        <div className="card-acoes">
          {acoes.map((acao) => (
            <button
              key={acao.chave}
              className={`btn-acao${acao.destrutivo ? " btn-acao-destrutivo" : ""}`}
              disabled={emExecucao}
              onClick={() => onAcao(acao)}
            >
              {acao.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
