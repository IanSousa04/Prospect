// Order Context — estado estruturado do pedido em construção por
// atendimento (ver docs ROADMAP tarefa 0053, subtarefa 1/3 de `criar_pedido`
// — tarefa 0017). Vive em `ia_sessoes.estado_json.pedido` (ver agent/sessao.ts).
//
// Deliberadamente só dados + funções puras aqui — nenhuma tool muta este
// estado ainda (isso é a tarefa 0054, carrinho, e 0055, confirmação/criação
// real do pedido). A IA não deve "lembrar" em que etapa do pedido está só
// pelo histórico de chat: o estado é sempre recalculado a partir deste
// objeto, nunca inferido de novo pelo LLM a cada turno.
import type { EnderecoEntrega, FormaPagamento, TipoEntrega } from "@prospect/shared";
import type { ItemMontado } from "@prospect/pedidos-core";

export type StatusPedidoIa =
  | "novo"
  | "montando"
  | "revisando"
  | "definindo_entrega"
  | "definindo_endereco"
  | "definindo_pagamento"
  | "confirmando"
  | "finalizado";

/** Item do carrinho — mesmo shape de `ItemMontado` (packages/pedidos-core),
 * a mesma fonte de verdade usada por `POST /pedidos` e pelas tools de
 * carrinho (tarefa 0054) — preço sempre travado do catálogo real no
 * momento em que o item foi adicionado/atualizado, nunca digitado
 * livremente pela IA (CLAUDE.md regra 1).
 *
 * `linha_id` é gerado ao adicionar (nunca pelo LLM) e existe só pra
 * remover/atualizar uma linha específica sem ambiguidade quando o mesmo
 * `produto_id` aparece mais de uma vez no carrinho com personalizações
 * diferentes (ex.: dois X-Bacon, um sem cebola). É um detalhe técnico
 * interno — nunca aparece na mensagem pro cliente (CLAUDE.md regra 3),
 * só como parâmetro das tools de carrinho. */
export interface ItemCarrinho extends ItemMontado {
  linha_id: string;
}

export interface OrderContext {
  status: StatusPedidoIa;
  itens: ItemCarrinho[];
  /** true só depois que o cliente confirmou explicitamente o carrinho
   * (resumo apresentado, "isso mesmo" / "pode confirmar") — nunca setado
   * automaticamente por ter itens. */
  carrinho_confirmado: boolean;
  tipo_entrega: TipoEntrega | null;
  endereco: EnderecoEntrega | null;
  forma_pagamento: FormaPagamento | null;
  /** true só depois da confirmação final explícita (CLAUDE.md regra 6) —
   * é o que a tarefa 0055 usa como gatilho pra criar o pedido de verdade. */
  confirmado: boolean;
}

export function pedidoVazio(): OrderContext {
  return {
    status: "novo",
    itens: [],
    carrinho_confirmado: false,
    tipo_entrega: null,
    endereco: null,
    forma_pagamento: null,
    confirmado: false,
  };
}

export function calcularSubtotal(itens: ItemCarrinho[]): number {
  const total = itens.reduce((acc, item) => {
    const precoOpcoes = item.opcoes.reduce((soma, o) => soma + o.preco_adicional, 0);
    return acc + (item.preco_unitario + precoOpcoes) * item.quantidade;
  }, 0);
  return Math.round(total * 100) / 100;
}

/** O que falta pro pedido poder ser criado, como CONJUNTO (não "próxima
 * pergunta fixa") — o cliente pode responder várias pendências de uma vez
 * ("quero 2 pizzas, no Pix, entrega na minha casa") e o orquestrador deve
 * extrair tudo isso num turno só, sem perguntar de novo o que já foi dito.
 * Ordem do array é só uma sugestão de prioridade pra quem for gerar a
 * pergunta (produtos > confirmar carrinho > entrega > endereço > pagamento
 * > confirmação final), nunca uma obrigação de perguntar um de cada vez. */
export type InformacaoPendente =
  | "produtos"
  | "confirmar_carrinho"
  | "tipo_entrega"
  | "endereco"
  | "forma_pagamento"
  | "confirmacao_final";

/** Aplica uma nova lista de itens ao pedido depois de uma mutação de
 * carrinho (adicionar/remover/atualizar — tarefa 0054). Qualquer mutação
 * invalida uma confirmação anterior (CLAUDE.md regra 6: nunca herdar
 * confirmação de um carrinho que já mudou) e ajusta o status: carrinho
 * esvaziado volta pra "novo", primeiro item sai de "novo" pra "montando". */
export function aplicarMutacaoCarrinho(pedido: OrderContext, novosItens: ItemCarrinho[]): OrderContext {
  return {
    ...pedido,
    itens: novosItens,
    carrinho_confirmado: false,
    status: novosItens.length === 0 ? "novo" : pedido.status === "novo" ? "montando" : pedido.status,
  };
}

export function informacoesPendentes(pedido: OrderContext): InformacaoPendente[] {
  // Sem nenhum item, nada mais importa ainda — não faz sentido perguntar
  // forma de pagamento de um carrinho vazio.
  if (pedido.itens.length === 0) return ["produtos"];

  const pendentes: InformacaoPendente[] = [];
  if (!pedido.carrinho_confirmado) pendentes.push("confirmar_carrinho");
  if (!pedido.tipo_entrega) pendentes.push("tipo_entrega");
  if (pedido.tipo_entrega === "entrega" && !pedido.endereco) pendentes.push("endereco");
  if (!pedido.forma_pagamento) pendentes.push("forma_pagamento");
  // Confirmação final só entra na lista quando não resta mais nenhuma outra
  // pendência — nunca em paralelo com informação de carrinho/entrega/
  // pagamento ainda faltando (CLAUDE.md regra 6: nunca finalizar por
  // engano com informação incompleta).
  if (pendentes.length === 0 && !pedido.confirmado) pendentes.push("confirmacao_final");

  return pendentes;
}
