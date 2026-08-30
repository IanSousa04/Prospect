import type { FormaPagamento, StatusPedido, TipoEntrega } from "@prospect/shared";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function moeda(valor: number): string {
  return BRL.format(valor);
}

export const ROTULO_ENTREGA: Record<TipoEntrega, string> = {
  entrega: "Entrega",
  retirada: "Retirar na loja",
};

export const ROTULO_PAGAMENTO: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  pix: "Pix",
  outro: "Outro",
};

/** Status do pedido em linguagem de CLIENTE, não de operação. O painel fala
 * "em preparação" porque é o vocabulário da cozinha; quem está esperando a
 * comida quer saber se a loja já aceitou e se já está sendo feito. */
export const ROTULO_STATUS_PEDIDO: Record<StatusPedido, string> = {
  aberto: "Aguardando a loja confirmar",
  em_preparacao: "Sendo preparado",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};
