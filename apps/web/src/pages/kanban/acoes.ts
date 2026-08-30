import type { AtendimentoComContexto } from "@prospect/shared";
import { api } from "../../lib/api.js";

export type ChaveAcao = "atender" | "confirmar" | "pronto" | "entregar" | "cancelar";

export interface AcaoKanban {
  chave: ChaveAcao;
  /** Texto curto do botão no card — a ação é secundária, o pedido é o
   * conteúdo principal. */
  label: string;
  destrutivo?: boolean;
  confirmacao: {
    titulo: string;
    descricao: string;
    labelConfirmar: string;
    labelCancelar: string;
  };
  toast: string;
  executar: (a: AtendimentoComContexto) => Promise<unknown>;
}

const ATENDER: AcaoKanban = {
  chave: "atender",
  label: "Atender",
  confirmacao: {
    titulo: "Atender este atendimento?",
    descricao: "Você assumirá este atendimento como responsável.",
    labelConfirmar: "Confirmar atendimento",
    labelCancelar: "Cancelar",
  },
  toast: "Atendimento assumido",
  // Com handoff aberto, assumir pelo handoff é obrigatório: assumir só o
  // atendimento deixaria o handoff pendente, e depois o atendimento não
  // poderia mais ser encerrado (`handoff_pendente_impede_finalizar`).
  executar: (a) =>
    a.handoff_aberto ? api.assumirHandoff(a.handoff_aberto.id) : api.assumirAtendimento(a.id),
};

const CONFIRMAR: AcaoKanban = {
  chave: "confirmar",
  label: "Confirmar",
  confirmacao: {
    titulo: "Enviar pedido para a cozinha?",
    descricao: 'O pedido será confirmado e movido para "Na cozinha".',
    labelConfirmar: "Enviar para cozinha",
    labelCancelar: "Voltar",
  },
  toast: "Pedido enviado para a cozinha",
  executar: (a) => api.atualizarStatusPedido(a.pedido_estagio!.id, "em_preparacao"),
};

const PRONTO: AcaoKanban = {
  chave: "pronto",
  label: "Pronto",
  confirmacao: {
    titulo: "Marcar pedido como pronto?",
    descricao: 'O pedido será movido para "Pronto" e ficará disponível para entrega.',
    labelConfirmar: "Confirmar",
    labelCancelar: "Voltar",
  },
  toast: "Pedido marcado como pronto",
  executar: (a) => api.atualizarStatusPedido(a.pedido_estagio!.id, "pronto"),
};

const ENTREGAR: AcaoKanban = {
  chave: "entregar",
  label: "Entregar",
  confirmacao: {
    titulo: "Finalizar entrega?",
    descricao:
      "O pedido será marcado como entregue e o atendimento será encerrado, saindo do Kanban. Se o cliente escrever de novo, uma nova conversa começa com a IA.",
    labelConfirmar: "Confirmar entrega",
    labelCancelar: "Voltar",
  },
  toast: "Entrega finalizada",
  executar: (a) => api.entregarPedido(a.pedido_estagio!.id),
};

const CANCELAR: AcaoKanban = {
  chave: "cancelar",
  label: "Cancelar pedido",
  destrutivo: true,
  confirmacao: {
    titulo: "Cancelar pedido?",
    descricao:
      "O pedido será marcado como cancelado e sairá do Kanban de pedidos. A conversa com o cliente continua aberta.",
    labelConfirmar: "Cancelar pedido",
    labelCancelar: "Voltar",
  },
  toast: "Pedido cancelado",
  executar: (a) => api.atualizarStatusPedido(a.pedido_estagio!.id, "cancelado"),
};

/** Ações disponíveis num card, na ordem em que aparecem. Repare que
 * "Confirmar" não depende da coluna e sim do PEDIDO estar montado e não
 * confirmado: um pedido que a IA fechou sozinha precisa poder ir pra cozinha
 * sem obrigar alguém a assumir a conversa antes. */
export function acoesDoCard(a: AtendimentoComContexto): AcaoKanban[] {
  const acoes: AcaoKanban[] = [];
  const pedido = a.pedido_estagio;

  if (a.status === "solicitou_humano") acoes.push(ATENDER);
  if (pedido?.status === "aberto") acoes.push(CONFIRMAR);
  if (pedido?.status === "em_preparacao") acoes.push(PRONTO);
  if (pedido?.status === "pronto") acoes.push(ENTREGAR);
  if (pedido) acoes.push(CANCELAR);

  return acoes;
}

/** Os erros da API chegam como código (`authedFetch` repassa `body.error`).
 * O painel é uma tela de operação, não de debug: quem lê é o atendente no
 * meio do turno, então o código vira frase. O que não estiver mapeado cai num
 * texto genérico em vez de vazar identificador técnico. */
const ERROS_LEGIVEIS: Record<string, string> = {
  transicao_de_status_nao_permitida: "Esse pedido já mudou de etapa. Atualize o quadro e tente de novo.",
  pedido_nao_encontrado: "Pedido não encontrado — ele pode ter sido cancelado.",
  atendimento_nao_encontrado: "Atendimento não encontrado — ele pode já ter sido encerrado.",
  handoff_nao_encontrado_ou_ja_assumido: "Outra pessoa já assumiu este atendimento.",
  handoff_pendente_impede_finalizar: "Existe um pedido de ajuda pendente neste atendimento.",
};

export function mensagemDeErro(e: unknown): string {
  const bruto = e instanceof Error ? e.message : "";
  return ERROS_LEGIVEIS[bruto] ?? "Não foi possível concluir a ação. Tente novamente.";
}
