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
  /** Registro persistido de que o WORKFLOW validou uma confirmação real do
   * cliente para ESTE carrinho (tarefa 0081) — gravado só por
   * `agent/checkout/transicoes.ts`, nunca pelo LLM e nunca automaticamente
   * por ter itens. Deixou de ser uma etapa própria de `informacoesPendentes`
   * (a etapa `confirmar_carrinho` existia mas nenhum código jamais a
   * concluía, travando todo o checkout): hoje o resumo final é a única
   * confirmação, e este campo é o que `criar_pedido` exige como prova de que
   * ela aconteceu. Qualquer mutação de carrinho o zera
   * (`aplicarMutacaoCarrinho`) — confirmação nunca é herdada por um carrinho
   * que mudou. */
  carrinho_confirmado: boolean;
  tipo_entrega: TipoEntrega | null;
  endereco: EnderecoEntrega | null;
  forma_pagamento: FormaPagamento | null;
  /** true depois que o pedido real foi criado a partir deste carrinho
   * (CLAUDE.md regra 6). Na prática o carrinho é resetado logo em seguida,
   * então a evidência que sobrevive ao turno é `UltimoPedidoCriado` — este
   * campo existe pro caso de um carrinho ser inspecionado entre a criação e
   * o reset. */
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
 * pergunta (produtos > entrega > endereço > pagamento > confirmação final), nunca uma obrigação de perguntar um de cada vez. */
export type InformacaoPendente =
  | "produtos"
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

/** Ponteiro para o pedido REAL criado a partir deste carrinho (tarefa
 * 0081), guardado em `ia_sessoes.estado_json.ultimo_pedido_criado`. Existe
 * por dois motivos, ambos determinísticos:
 *
 * 1. **Evidência que sobrevive ao reset.** `criar_pedido` zera o Order
 *    Context logo depois de criar, então sem isto o estado do checkout
 *    voltaria instantaneamente pra "sem carrinho" e o turno seguinte não
 *    teria como saber que um pedido acabou de nascer nesta conversa.
 * 2. **Chave de idempotência.** Uma segunda confirmação do MESMO carrinho
 *    (cliente manda "tudo certo" três vezes na mesma rajada, ou o poller
 *    reprocessa) nunca pode virar um segundo pedido real — `hash` é o
 *    `calcularHashConfirmacao` do carrinho no momento da criação.
 *
 * Não é estado editável por humano: é o registro de um fato já acontecido.
 * O pedido em si continua sendo gerenciado no painel "Pedido" do
 * atendimento (CLAUDE.md regra 8). */
export interface UltimoPedidoCriado {
  pedido_id: string;
  hash: string;
  /** ISO timestamp da criação real. */
  criado_em: string;
}

/** Janela em que uma nova confirmação ainda é tratada como repetição da
 * anterior (idempotência) em vez de um pedido novo. Generosa de propósito:
 * o custo de recusar uma duplicata é uma mensagem a mais; o custo de criar
 * dois pedidos reais é dinheiro e comida de verdade (CLAUDE.md regra 6). */
export const MINUTOS_JANELA_PEDIDO_CRIADO = 30;

export function pedidoCriadoRecentemente(
  ultimo: UltimoPedidoCriado | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!ultimo) return false;
  return agora.getTime() - new Date(ultimo.criado_em).getTime() < MINUTOS_JANELA_PEDIDO_CRIADO * 60_000;
}

/** Uma confirmação pendente só vale se o resumo mostrado ainda descreve o
 * carrinho ATUAL (hash recalculado agora, nunca o hash salvo sozinho) e não
 * expirou. Fonte única desta regra — antes da tarefa 0081 existia duplicada
 * no gate de exposição do investigador e dentro de `criar_pedido`
 * (tools/pedido.ts), com risco real de as duas divergirem. */
export function confirmacaoPendenteValida(
  pedido: OrderContext,
  aguardando: AguardandoConfirmacao | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!aguardando) return false;
  if (aguardando.hash !== calcularHashConfirmacao(pedido)) return false;
  return new Date(aguardando.expiraEm).getTime() > agora.getTime();
}

/** Etapa do checkout, DERIVADA do estado persistido — nunca um campo
 * gravado à parte (tarefa 0081). Derivar em vez de armazenar é o que
 * garante que a IA, a API e a UI enxerguem sempre a mesma etapa, sem
 * chance de um estado paralelo desincronizar (CLAUDE.md regra 8), e que
 * uma edição humana do carrinho recalcule a etapa sozinha.
 *
 * `confirmacao_recebida` e `handoff_realizado` da especificação NÃO estão
 * aqui de propósito: são resultados de transição dentro de um único turno
 * (ver `ResultadoTransicao` em agent/checkout/transicoes.ts), não estados
 * que sobrevivem entre mensagens. */
export type EstadoCheckout =
  | "sem_carrinho"
  | "montando_carrinho"
  | "dados_completos"
  | "aguardando_confirmacao"
  | "pedido_criado";

/** Estados em que a mensagem do cliente pode alterar o pedido — qualquer um
 * deles obriga a mensagem a passar pelo workflow transacional determinístico
 * ANTES de poder ser tratada como conversa social (tarefa 0081, item 5 da
 * especificação: `sem_investigacao` não pode mais burlar o checkout). */
const ESTADOS_TRANSACIONAIS: ReadonlySet<EstadoCheckout> = new Set<EstadoCheckout>([
  "montando_carrinho",
  "dados_completos",
  "aguardando_confirmacao",
  "pedido_criado",
]);

export function checkoutEhTransacional(estado: EstadoCheckout): boolean {
  return ESTADOS_TRANSACIONAIS.has(estado);
}

export function derivarEstadoCheckout(
  pedido: OrderContext,
  aguardandoConfirmacao: AguardandoConfirmacao | null | undefined,
  ultimoPedidoCriado: UltimoPedidoCriado | null | undefined,
  config: FluxoPedidoConfig = FLUXO_PEDIDO_CONFIG_PADRAO,
  agora: Date = new Date(),
): EstadoCheckout {
  // Carrinho vazio logo depois de uma criação real desta conversa continua
  // sendo "pedido criado" — é o que impede uma segunda confirmação de ser
  // interpretada como um pedido novo (e o que dá ao Atendente o fato certo
  // pra responder "seu pedido já está confirmado" com evidência).
  if (pedido.itens.length === 0) {
    return pedidoCriadoRecentemente(ultimoPedidoCriado, agora) ? "pedido_criado" : "sem_carrinho";
  }

  const pendencias = informacoesPendentes(pedido, config);
  if (pendencias.some((p) => p !== "confirmacao_final")) return "montando_carrinho";
  if (confirmacaoPendenteValida(pedido, aguardandoConfirmacao, agora)) return "aguardando_confirmacao";
  return "dados_completos";
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
  /** Etapa derivada do checkout (tarefa 0081) — a mesma que o workflow da
   * IA usa pra decidir o que pode acontecer, exposta aqui pra UI humana
   * enxergar exatamente o mesmo estado (CLAUDE.md regra 8). */
  estado_checkout: EstadoCheckout;
  /** Ponteiro pro pedido real já criado a partir deste carrinho, quando
   * houver — evidência, não estado editável. */
  ultimo_pedido_criado: UltimoPedidoCriado | null;
}

/** Resumo do Order Context — mesmo shape devolvido pela página pública
 * (POST/GET /publico/*) e pelo painel humano (GET /atendimentos/:id/carrinho)
 * pra exibir o carrinho antes de virar um pedido de verdade, e editável pelo
 * humano (tarefa 0063). Um único formato, dois consumidores.
 * `aguardandoConfirmacao` é opcional porque a maioria dos chamadores (toda
 * mutação de carrinho) não tem uma confirmação pendente fresca pra
 * reportar — só o GET da API carrega o valor real da sessão e passa
 * explicitamente. */
export function resumoPedidoIa(
  pedido: OrderContext,
  aguardandoConfirmacao: AguardandoConfirmacao | null = null,
  config: FluxoPedidoConfig = FLUXO_PEDIDO_CONFIG_PADRAO,
  ultimoPedidoCriado: UltimoPedidoCriado | null = null,
): ResumoPedidoIa {
  return {
    ...pedido,
    subtotal: calcularSubtotal(pedido.itens),
    pendencias: informacoesPendentes(pedido, config),
    aguardando_confirmacao: aguardandoConfirmacao,
    estado_checkout: derivarEstadoCheckout(pedido, aguardandoConfirmacao, ultimoPedidoCriado, config),
    ultimo_pedido_criado: ultimoPedidoCriado ?? null,
  };
}
