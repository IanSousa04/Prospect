// Pré-requisitos de criação de um pedido real a partir de um carrinho
// (tarefa 0081, item 9) — função PURA,
// separada da tool para que exatamente a mesma regra seja exercitada pelo
// gabarito determinístico, sem banco. Um teste que reimplementasse essas
// condições estaria testando a si mesmo; aqui ele testa a regra real que
// roda em produção.
//
// Mora em `packages/shared` desde a tarefa 0043: a página pública de pedido
// cria pedidos pelo mesmo carrinho, e o gate que autoriza a criação não pode
// ter uma segunda versão por canal (a idempotência e a prova de confirmação
// valem igual pra IA e pro cliente clicando num botão).
//
// A ordem das checagens é deliberada: idempotência primeiro (uma repetição
// nunca pode nem chegar perto de criar um segundo pedido), depois
// completude, depois a prova persistida de que o cliente autorizou.
import type { FluxoPedidoConfig } from "./ia-config.js";
import type {
  AguardandoConfirmacao,
  InformacaoPendente,
  OrderContext,
  UltimoPedidoCriado,
} from "./pedido-ia.js";
import {
  calcularHashConfirmacao,
  confirmacaoPendenteValida,
  informacoesPendentes,
  pedidoCriadoRecentemente,
} from "./pedido-ia.js";

export type MotivoRecusaCriacao =
  | "pedido_incompleto"
  | "confirmacao_nao_registrada"
  | "confirmacao_expirada_ou_invalida";

export type ResultadoValidacaoCriacao =
  | { situacao: "pode_criar" }
  | { situacao: "ja_criado"; pedido_id: string }
  | { situacao: "recusado"; motivo: MotivoRecusaCriacao; pendencias?: InformacaoPendente[] };

export function validarPreRequisitosDeCriacao(params: {
  pedido: OrderContext;
  confirmacao: AguardandoConfirmacao | null;
  ultimoPedidoCriado: UltimoPedidoCriado | null;
  config: FluxoPedidoConfig;
  agora?: Date;
}): ResultadoValidacaoCriacao {
  const { pedido, confirmacao, ultimoPedidoCriado, config } = params;
  const agora = params.agora ?? new Date();

  // Este mesmo carrinho já virou pedido há pouco — devolve o que existe, em
  // vez de criar um segundo (comida e dinheiro de verdade duplicados).
  if (pedidoCriadoRecentemente(ultimoPedidoCriado, agora) && ultimoPedidoCriado!.hash === calcularHashConfirmacao(pedido)) {
    return { situacao: "ja_criado", pedido_id: ultimoPedidoCriado!.pedido_id };
  }

  const pendencias = informacoesPendentes(pedido, config);
  if (pendencias.length !== 1 || pendencias[0] !== "confirmacao_final") {
    return { situacao: "recusado", motivo: "pedido_incompleto", pendencias };
  }

  // A confirmação do cliente precisa estar PERSISTIDA no estado do pedido —
  // gravada pelo workflow ao validar a intenção, nunca uma variável em
  // memória e nunca a opinião de um modelo.
  if (!pedido.carrinho_confirmado) {
    return { situacao: "recusado", motivo: "confirmacao_nao_registrada" };
  }

  // E o resumo que ele confirmou precisa ainda descrever o carrinho atual.
  if (!confirmacaoPendenteValida(pedido, confirmacao, agora)) {
    return { situacao: "recusado", motivo: "confirmacao_expirada_ou_invalida" };
  }

  return { situacao: "pode_criar" };
}
