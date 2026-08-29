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
import { FLUXO_PEDIDO_CONFIG_PADRAO, type FluxoPedidoConfig } from "./ia-config.js";

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
 * "novo", primeiro item sai de "novo" pra "montando". Quando a empresa só
 * oferece um tipo de entrega (config), o primeiro item já atribui esse tipo
 * automaticamente — nunca pergunta algo que só tem uma resposta possível. */
export function aplicarMutacaoCarrinho(
  pedido: OrderContext,
  novosItens: ItemCarrinho[],
  config: FluxoPedidoConfig = FLUXO_PEDIDO_CONFIG_PADRAO,
): OrderContext {
  const tipoAuto = tipoEntregaAutoAtribuido(config);
  return {
    ...pedido,
    itens: novosItens,
    carrinho_confirmado: false,
    tipo_entrega: pedido.tipo_entrega ?? (novosItens.length > 0 ? tipoAuto : null),
    status: novosItens.length === 0 ? "novo" : pedido.status === "novo" ? "montando" : pedido.status,
  };
}

/** Etapa de tipo de entrega: some da lista de pendências quando a empresa
 * só oferece uma opção (config, tasks/0056/0077) — nesse caso o pedido já
 * deveria ter nascido com esse tipo pré-atribuído (ver
 * `tipoEntregaAutoAtribuido`), então chegar aqui sem `tipo_entrega` definido
 * só acontece num pedido antigo/editado manualmente; mesmo assim não faz
 * sentido perguntar algo que só tem uma resposta possível. */
function tipoEntregaPendente(pedido: OrderContext, config: FluxoPedidoConfig): boolean {
  if (config.tipos_entrega_oferecidos.length === 1) return false;
  return !pedido.tipo_entrega;
}

export function informacoesPendentes(
  pedido: OrderContext,
  config: FluxoPedidoConfig = FLUXO_PEDIDO_CONFIG_PADRAO,
): InformacaoPendente[] {
  // Sem nenhum item, nada mais importa ainda — não faz sentido perguntar
  // forma de pagamento de um carrinho vazio.
  if (pedido.itens.length === 0) return ["produtos"];

  const pendentes: InformacaoPendente[] = [];
  if (!pedido.carrinho_confirmado) pendentes.push("confirmar_carrinho");
  if (tipoEntregaPendente(pedido, config)) pendentes.push("tipo_entrega");
  if (pedido.tipo_entrega === "entrega" && !pedido.endereco) pendentes.push("endereco");
  if (config.perguntar_forma_pagamento && !pedido.forma_pagamento) pendentes.push("forma_pagamento");
  // Confirmação final só entra na lista quando não resta mais nenhuma outra
  // pendência — nunca em paralelo com informação de carrinho/entrega/
  // pagamento ainda faltando (CLAUDE.md regra 6: nunca finalizar por
  // engano com informação incompleta).
  if (pendentes.length === 0 && !pedido.confirmado) pendentes.push("confirmacao_final");

  return pendentes;
}

/** Quando a empresa só oferece um tipo de entrega (config), o carrinho já
 * nasce com esse tipo atribuído — a IA nunca chega a perguntar algo que só
 * tem uma resposta possível (mesmo espírito de `tipoEntregaPendente`
 * acima). Chamado por `aplicarMutacaoCarrinho` (tools/carrinho.ts) sempre
 * que o carrinho ganha o primeiro item. */
export function tipoEntregaAutoAtribuido(config: FluxoPedidoConfig): TipoEntrega | null {
  return config.tipos_entrega_oferecidos.length === 1 ? config.tipos_entrega_oferecidos[0]! : null;
}

/** Registro determinístico de que o resumo final do pedido foi mostrado ao
 * cliente e está aguardando confirmação (tarefa 0022) — substitui o campo
 * `OrderContext.confirmado`, que nunca era setado por código nenhum (o
 * único gate real era o julgamento do LLM sobre a regra 11 do prompt do
 * Investigador). Guardado em `ia_sessoes.estado_json.aguardando_confirmacao`
 * (ver apps/ai-orchestrator/src/agent/sessao.ts), irmão de `pedido`, nunca
 * dentro dele — é estado da CONVERSA (o que já foi mostrado), não do
 * carrinho em si. */
export interface AguardandoConfirmacao {
  /** Fingerprint de `calcularHashConfirmacao(pedido)` no momento em que o
   * resumo foi apresentado — se o carrinho mudar depois, o hash recalculado
   * não bate mais e a confirmação anterior é invalidada automaticamente. */
  hash: string;
  /** ISO timestamp — confirmação mais antiga que isso nunca é aceita,
   * mesmo com hash batendo (evita reaproveitar um "sim" de muito tempo
   * atrás na conversa). */
  expiraEm: string;
  /** Texto do resumo mostrado — só informativo, pra exibição no painel
   * humano (CLAUDE.md regra 8); nunca usado pra decisão de código. */
  resumoTexto: string;
}

/** Hash determinístico (NÃO criptográfico — só detecção de mudança, não
 * segurança) do que importa pra decidir se uma confirmação anterior ainda
 * vale: itens, tipo de entrega, endereço, forma de pagamento. Roda tanto no
 * ai-orchestrator quanto potencialmente em outros consumidores de
 * `packages/shared` — implementação leve de propósito, sem depender de
 * `crypto` do Node. */
export function calcularHashConfirmacao(pedido: OrderContext): string {
  const chave = JSON.stringify({
    itens: [...pedido.itens]
      .sort((a, b) => a.linha_id.localeCompare(b.linha_id))
      .map((i) => ({
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        observacoes: i.observacoes,
        opcoes: [...i.opcoes.map((o) => o.opcao_id)].sort(),
      })),
    tipo_entrega: pedido.tipo_entrega,
    endereco: pedido.endereco,
    forma_pagamento: pedido.forma_pagamento,
  });
  let hash = 0;
  for (let i = 0; i < chave.length; i++) {
    hash = (Math.imul(hash, 31) + chave.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Texto legível do resumo do carrinho — usado tanto como `resumoTexto` de
 * `AguardandoConfirmacao` (exibição humana) quanto reaproveitável por
 * qualquer síntese determinística que precise descrever o carrinho sem
 * inventar nada (sempre derivado só do próprio `OrderContext`). */
export function construirResumoTexto(pedido: OrderContext): string {
  if (pedido.itens.length === 0) return "Carrinho vazio.";
  const linhas = pedido.itens.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(", ");
  return `${linhas}. Subtotal: R$ ${calcularSubtotal(pedido.itens).toFixed(2).replace(".", ",")}.`;
}

/** OrderContext + campos derivados (subtotal, pendências, confirmação
 * pendente) — o Order Context inteiro, não só os itens, porque a tarefa
 * 0063 deixou a UI editar tipo_entrega/endereco/forma_pagamento também: sem
 * esses campos aqui, a tela não teria como saber o que já está
 * selecionado. */
export interface ResumoPedidoIa extends OrderContext {
  subtotal: number;
  pendencias: InformacaoPendente[];
  /** null quando não há resumo pendente de confirmação agora — ver
   * `AguardandoConfirmacao` (tarefa 0022). */
  aguardando_confirmacao: AguardandoConfirmacao | null;
}

/** Resumo do Order Context — mesmo shape devolvido pelas tools de carrinho
 * pro Investigador (evidência real) e pela API pra UI (painel "Carrinho" no
 * atendimento, antes de existir um pedido de verdade, e editável pelo
 * humano — tarefa 0063). Um único formato, dois consumidores.
 * `aguardandoConfirmacao` é opcional porque a maioria dos chamadores (toda
 * mutação de carrinho) não tem uma confirmação pendente fresca pra
 * reportar — só `consultar_carrinho` (ai-orchestrator) e o GET da API
 * carregam o valor real da sessão e passam explicitamente. */
export function resumoPedidoIa(
  pedido: OrderContext,
  aguardandoConfirmacao: AguardandoConfirmacao | null = null,
  config: FluxoPedidoConfig = FLUXO_PEDIDO_CONFIG_PADRAO,
): ResumoPedidoIa {
  return {
    ...pedido,
    subtotal: calcularSubtotal(pedido.itens),
    pendencias: informacoesPendentes(pedido, config),
    aguardando_confirmacao: aguardandoConfirmacao,
  };
}
