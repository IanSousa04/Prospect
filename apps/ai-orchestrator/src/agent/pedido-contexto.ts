// Order Context — reexporta de `@prospect/shared` (ver packages/shared/src/pedido-ia.ts).
// Movido pra lá na tarefa 0054 (correção pós-entrega) porque ganhou um
// segundo consumidor real: `apps/api` passou a expor o carrinho em
// construção pra UI (GET /atendimentos/:id/carrinho), então o shape e as
// regras precisam ser uma fonte única, não reimplementadas duas vezes.
// Este arquivo existe só pra não quebrar os imports já espalhados em
// agent/sessao.ts, tools/carrinho.ts e eval/deterministicos.ts.
export type {
  StatusPedidoIa,
  ItemCarrinho,
  OrderContext,
  InformacaoPendente,
  ResumoPedidoIa,
  AguardandoConfirmacao,
} from "@prospect/shared";
export {
  pedidoVazio,
  calcularSubtotal,
  encontrarLinhaEquivalente,
  aplicarMutacaoCarrinho,
  informacoesPendentes,
  resumoPedidoIa,
  calcularHashConfirmacao,
  construirResumoTexto,
} from "@prospect/shared";
