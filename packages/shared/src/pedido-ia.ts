// Order Context — estado estruturado do pedido em construção por
// atendimento, mantido pela IA em `ia_sessoes.estado_json.pedido` (ver
// apps/ai-orchestrator/src/agent/sessao.ts) e consultado também pela API
// (GET /atendimentos/:id/carrinho) pra exibir o carrinho na UI antes de
// virar um pedido de verdade. Vive em `packages/shared` (não só em
// ai-orchestrator) porque agora tem dois consumidores reais — mesma razão
// de `montarItensComSnapshot` estar em `packages/pedidos-core`: uma única
// fonte de verdade pro shape e pras regras, nunca duas implementações que
// podem divergir.
//
// Deliberadamente só dados + funções puras aqui — a mutação de verdade
// (tools de carrinho) mora em apps/ai-orchestrator/src/tools/carrinho.ts,
// que é quem decide QUANDO mutar; este arquivo só define O QUE é um estado
// válido e COMO calcular subtotal/pendências a partir dele.
import type { EnderecoEntrega, FormaPagamento, TipoEntrega } from "./pedidos.js";
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
 * carrinho — preço sempre travado do catálogo real no momento em que o
 * item foi adicionado/atualizado, nunca digitado livremente pela IA
 * (CLAUDE.md regra 1).
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

/** Acha a linha do carrinho que representa exatamente o mesmo item
 * (mesmo produto, mesmas opções, mesma observação) — usado por
 * `adicionar_ao_carrinho` pra mesclar em vez de duplicar quando o
 * cliente/LLM pede o mesmo item de novo (episódio real: uma mensagem
 * ambígua levou a IA a adicionar um item especulativamente e, na rodada
 * seguinte, adicionar de novo — sem essa checagem, o carrinho duplicava a
 * linha em vez de somar a quantidade). Comparação de opções é
 * order-independent (mesmo conjunto de `opcao_id`, não a mesma ordem). */
export function encontrarLinhaEquivalente(
  itens: ItemCarrinho[],
  produtoId: string,
  observacoes: string | null,
  opcaoIds: string[],
): ItemCarrinho | null {
  const opcoesOrdenadas = [...opcaoIds].sort();
  return (
    itens.find((item) => {
      if (item.produto_id !== produtoId) return false;
      if (item.observacoes !== observacoes) return false;
      const opcoesDoItem = item.opcoes.map((o) => o.opcao_id).sort();
      return (
        opcoesDoItem.length === opcoesOrdenadas.length &&
        opcoesDoItem.every((o, i) => o === opcoesOrdenadas[i])
      );
    }) ?? null
  );
}

/** Aplica uma nova lista de itens ao pedido depois de uma mutação de
 * carrinho (adicionar/remover/atualizar). Qualquer mutação invalida uma
 * confirmação anterior (CLAUDE.md regra 6: nunca herdar confirmação de um
 * carrinho que já mudou) e ajusta o status: carrinho esvaziado volta pra
 * "novo", primeiro item sai de "novo" pra "montando". */
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

/** OrderContext + campos derivados (subtotal, pendências) — o Order Context
 * inteiro, não só os itens, porque a tarefa 0063 deixou a UI editar
 * tipo_entrega/endereco/forma_pagamento também: sem esses campos aqui, a
 * tela não teria como saber o que já está selecionado. */
export interface ResumoPedidoIa extends OrderContext {
  subtotal: number;
  pendencias: InformacaoPendente[];
}

/** Resumo do Order Context — mesmo shape devolvido pelas tools de carrinho
 * pro Investigador (evidência real) e pela API pra UI (painel "Carrinho" no
 * atendimento, antes de existir um pedido de verdade, e editável pelo
 * humano — tarefa 0063). Um único formato, dois consumidores. */
export function resumoPedidoIa(pedido: OrderContext): ResumoPedidoIa {
  return {
    ...pedido,
    subtotal: calcularSubtotal(pedido.itens),
    pendencias: informacoesPendentes(pedido),
  };
}
