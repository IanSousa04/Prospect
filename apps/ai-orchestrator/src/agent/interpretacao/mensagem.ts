// Interpretador universal da mensagem do cliente (tarefa 0082) — a ÚNICA
// coisa que o LLM faz antes de o código assumir. Ele lê a mensagem e ROTULA
// o que ela contém: itens citados, dados de checkout, sinal de confirmação e
// os ASSUNTOS perguntados. Não decide nada, não escolhe ferramenta, não sabe
// o que vai acontecer depois.
//
// Generaliza `checkout/intencao.ts` (tarefa 0081), que só olhava a parte
// transacional e só rodava quando já existia carrinho. Foi essa condição que
// deixou toda a máquina de estados inerte numa conversa real: sem item no
// carrinho, o pipeline determinístico nunca ligava, e a decisão de chamar
// ferramenta voltava a ser do modelo. Agora roda em toda mensagem.
//
// `social` é derivado em CÓDIGO, nunca pedido ao modelo — é o que substitui
// o antigo `sem_investigacao`, que o LLM podia marcar sozinho e com isso
// desligar a pipeline inteira (episódio real: "Sim" respondendo a uma
// pergunta do sistema foi classificado como conversa social).
import type {
  EnderecoEntrega,
  EstadoCheckout,
  FormaPagamento,
  FluxoPedidoConfig,
  InformacaoPendente,
  TipoEntrega,
} from "@prospect/shared";
import { getChatModel } from "../../llm/client.js";
import type { ChatModel } from "../../llm/types.js";
import { confirmaResumoPendente, negaResumoPendente } from "../deteccao.js";

export type SinalConfirmacao = "confirma" | "nega" | "nenhuma";

/** Assuntos que o cliente pode perguntar. Cada um mapeia para ferramentas
 * fixas em `roteamento.ts` — o modelo rotula o assunto, o código escolhe a
 * ferramenta. `outro` é o catch-all honesto: cai em busca de conhecimento e,
 * se não achar nada, a IA admite que não tem a informação. */
export const ASSUNTOS_PERGUNTADOS = [
  "cardapio",
  "preco",
  "adicionais",
  "combos",
  "recomendacao",
  "horario",
  "taxa_entrega",
  "area_entrega",
  "opcoes_atendimento",
  "prazo_entrega",
  "politica",
  "status_pedido",
  "historico",
  "dados_do_cliente",
  "outro",
] as const;

export type AssuntoPerguntado = (typeof ASSUNTOS_PERGUNTADOS)[number];

const ASSUNTOS_VALIDOS = new Set<string>(ASSUNTOS_PERGUNTADOS);

export type AcaoSobreItem = "adicionar" | "remover" | "alterar_quantidade";

/** Item como o CLIENTE escreveu — nunca resolvido aqui. Quem transforma
 * "x bacon" num produto real é `itens.ts`, com busca no catálogo. */
export interface ItemMencionado {
  texto: string;
  quantidade: number;
  adicionais_texto: string[];
  observacao: string | null;
  acao: AcaoSobreItem;
}

/** Parte transacional — o que `decidirMutacoes` (checkout/transicoes.ts)
 * consome. Fica separada para o workflow de checkout não precisar conhecer
 * o resto da interpretação. */
export interface IntencaoTransacional {
  confirmacao: SinalConfirmacao;
  tipo_entrega: TipoEntrega | null;
  forma_pagamento: FormaPagamento | null;
  endereco: Partial<EnderecoEntrega> | null;
  quer_cancelar: boolean;
}

export interface IntencaoDaMensagem extends IntencaoTransacional {
  itens: ItemMencionado[];
  perguntas: AssuntoPerguntado[];
  /** Derivado em código: `true` só quando não há item, nem dado de checkout,
   * nem confirmação, nem pergunta. Só nesse caso a mensagem pode ser tratada
   * como conversa social e pular a investigação. */
  social: boolean;
}

const INTENCAO_BASE: Omit<IntencaoDaMensagem, "social"> = {
  confirmacao: "nenhuma",
  tipo_entrega: null,
  forma_pagamento: null,
  endereco: null,
  quer_cancelar: false,
  itens: [],
  perguntas: [],
};

/** `social` nunca é decidido pelo modelo — é consequência de tudo o mais
 * estar vazio. Um "Sim" isolado tem `confirmacao: "confirma"`, então nunca
 * cai aqui, mesmo que o modelo achasse que é só cortesia. */
export function ehSocial(intencao: Omit<IntencaoDaMensagem, "social">): boolean {
  return (
    intencao.confirmacao === "nenhuma" &&
    intencao.tipo_entrega === null &&
    intencao.forma_pagamento === null &&
    intencao.endereco === null &&
    intencao.quer_cancelar === false &&
    intencao.itens.length === 0 &&
    intencao.perguntas.length === 0
  );
}

function comSocial(intencao: Omit<IntencaoDaMensagem, "social">): IntencaoDaMensagem {
  return { ...intencao, social: ehSocial(intencao) };
}

export const INTENCAO_VAZIA: IntencaoDaMensagem = comSocial(INTENCAO_BASE);

const TIPOS_ENTREGA_VALIDOS = new Set<string>(["entrega", "retirada"]);
const FORMAS_PAGAMENTO_VALIDAS = new Set<string>(["dinheiro", "cartao_credito", "cartao_debito", "pix", "outro"]);
const ACOES_VALIDAS = new Set<string>(["adicionar", "remover", "alterar_quantidade"]);
const CAMPOS_ENDERECO = ["rua", "numero", "complemento", "bairro", "cidade", "referencia"] as const;

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0 ? valor.trim() : null;
}

function listaDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.map(textoOuNulo).filter((t): t is string => t !== null);
}

/**
 * Nunca confia no shape cru que o modelo devolveu: qualquer valor fora do
 * domínio conhecido vira null/vazio em vez de ser repassado adiante — um
 * enum inventado aqui viraria uma mutação inválida no estado real do pedido
 * ou uma ferramenta chamada à toa. Também filtra pelo que a empresa de fato
 * oferece (`FluxoPedidoConfig`).
 */
export function normalizarIntencao(bruto: unknown, config: FluxoPedidoConfig): IntencaoDaMensagem {
  if (!bruto || typeof bruto !== "object") return INTENCAO_VAZIA;
  const obj = bruto as Record<string, unknown>;

  const confirmacaoBruta = obj.confirmacao;
  const confirmacao: SinalConfirmacao =
    confirmacaoBruta === "confirma" || confirmacaoBruta === "nega" ? confirmacaoBruta : "nenhuma";

  const tipoBruto = textoOuNulo(obj.tipo_entrega);
  const tipo_entrega =
    tipoBruto &&
    TIPOS_ENTREGA_VALIDOS.has(tipoBruto) &&
    config.tipos_entrega_oferecidos.includes(tipoBruto as TipoEntrega)
      ? (tipoBruto as TipoEntrega)
      : null;

  const formaBruta = textoOuNulo(obj.forma_pagamento);
  const forma_pagamento =
    formaBruta &&
    FORMAS_PAGAMENTO_VALIDAS.has(formaBruta) &&
    config.formas_pagamento_aceitas.includes(formaBruta as FormaPagamento)
      ? (formaBruta as FormaPagamento)
      : null;

  let endereco: Partial<EnderecoEntrega> | null = null;
  if (obj.endereco && typeof obj.endereco === "object") {
    const enderecoBruto = obj.endereco as Record<string, unknown>;
    const parcial: Partial<EnderecoEntrega> = {};
    for (const campo of CAMPOS_ENDERECO) {
      const valor = textoOuNulo(enderecoBruto[campo]);
      if (valor) parcial[campo] = valor;
    }
    endereco = Object.keys(parcial).length > 0 ? parcial : null;
  }

  const itensBrutos = Array.isArray(obj.itens) ? obj.itens : [];
  const itens: ItemMencionado[] = itensBrutos
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => {
      const texto = textoOuNulo(i.texto);
      if (!texto) return null;
      const quantidadeBruta = Number(i.quantidade);
      const acaoBruta = textoOuNulo(i.acao);
      return {
        texto,
        // Quantidade sempre >= 1 e limitada: um "quantidade: 9999" vindo do
        // modelo nunca pode virar um pedido real absurdo.
        quantidade: Number.isFinite(quantidadeBruta) ? Math.min(Math.max(Math.trunc(quantidadeBruta), 1), 99) : 1,
        adicionais_texto: listaDeTextos(i.adicionais_texto),
        observacao: textoOuNulo(i.observacao),
        acao: acaoBruta && ACOES_VALIDAS.has(acaoBruta) ? (acaoBruta as AcaoSobreItem) : "adicionar",
      };
    })
    .filter((i): i is ItemMencionado => i !== null);

  const perguntas = [...new Set(listaDeTextos(obj.perguntas).filter((p) => ASSUNTOS_VALIDOS.has(p)))] as AssuntoPerguntado[];

  return comSocial({ confirmacao, tipo_entrega, forma_pagamento, endereco, quer_cancelar: obj.quer_cancelar === true, itens, perguntas });
}

const DESCRICAO_ESTADO: Record<EstadoCheckout, string> = {
  sem_carrinho: "o cliente ainda não escolheu nenhum item",
  montando_carrinho: "o carrinho já tem itens, mas ainda falta informação pra poder fechar",
  dados_completos: "o carrinho está completo, mas o resumo final ainda não foi apresentado",
  aguardando_confirmacao:
    "o RESUMO FINAL do pedido já foi apresentado e o sistema está esperando o cliente confirmar ou recusar",
  pedido_criado: "um pedido real já foi criado nesta conversa a partir do carrinho anterior",
};

function montarPrompt(params: {
  estado: EstadoCheckout;
  pendencias: InformacaoPendente[];
  ultimaPerguntaDoSistema: string | null;
  config: FluxoPedidoConfig;
}): string {
  const ultimaPergunta = params.ultimaPerguntaDoSistema ? JSON.stringify(params.ultimaPerguntaDoSistema) : "(nenhuma)";

  return `Você é um classificador de mensagens de um atendimento de food service por WhatsApp. Seu único trabalho é ROTULAR o que a mensagem do cliente contém. Você não decide nenhuma ação, não executa nada, não consulta nada e não conversa com o cliente.

Contexto do pedido em andamento (use pra desambiguar — a mesma frase significa coisas diferentes em etapas diferentes):
- Etapa atual: "${params.estado}" (${DESCRICAO_ESTADO[params.estado]}).
- O que ainda falta: ${params.pendencias.length > 0 ? params.pendencias.join(", ") : "nada"}.
- Última pergunta que o sistema fez ao cliente: ${ultimaPergunta}.

Responda APENAS com um objeto JSON neste formato exato:
{"itens":[{"texto":"...","quantidade":1,"adicionais_texto":[],"observacao":null,"acao":"adicionar|remover|alterar_quantidade"}],"confirmacao":"confirma|nega|nenhuma","tipo_entrega":"entrega|retirada|null","forma_pagamento":"dinheiro|cartao_credito|cartao_debito|pix|outro|null","endereco":null,"quer_cancelar":false,"perguntas":[]}

Regras:
1. "itens": tudo que o cliente pediu, tirou ou mudou de quantidade NESTA mensagem, escrito COMO ELE ESCREVEU ("x bacon", "uma pizza", "aquele hambúrguer com bacon"). Não corrija, não traduza e não invente nome de produto — outra etapa procura no cardápio real. Se ele não citou nenhum item, use lista vazia. Perguntar sobre um produto NÃO é pedir ("quanto custa a batata?" é pergunta, não item).
2. "perguntas": os assuntos sobre os quais o cliente quer informação. Valores possíveis: "cardapio" (o que tem, quais opções), "preco", "adicionais", "combos", "recomendacao", "horario" (que horas abre/fecha), "taxa_entrega" (quanto custa entregar), "area_entrega" (se entrega no bairro/endereço dele), "opcoes_atendimento" (se faz entrega ou só retirada, quais formas de pagamento aceita), "prazo_entrega" (quanto tempo demora), "politica" (troca, cancelamento, garantia), "status_pedido" (cadê meu pedido), "historico" (o que já pedi antes), "dados_do_cliente" (meu nome, meu endereço salvo), "outro" (qualquer outra dúvida sobre a loja ou os produtos, como ingredientes, alergênicos, opção vegana). Pode ter mais de um. Lista vazia se ele não perguntou nada.
3. "confirmacao": "confirma" quando a mensagem é um aceite do que o sistema acabou de perguntar ("sim", "tudo certo", "confirmado", "pode fechar", "isso mesmo", "perfeito"). "nega" quando é recusa ou pedido de espera ("não", "ainda não", "espera"). "nenhuma" quando não responde à pergunta do sistema. Um aceite continua sendo "confirma" mesmo trazendo outras informações junto.
4. Só preencha "tipo_entrega"/"forma_pagamento" quando o CLIENTE disse isso NESTA mensagem. Nunca deduza pelo que seria comum, nunca repita o que o sistema sugeriu se ele não respondeu. "cartão" sem especificar é "cartao_credito"; "débito" é "cartao_debito"; "espécie" é "dinheiro".
5. Se o cliente PERGUNTAR se a loja faz entrega ou quais formas de pagamento aceita, isso é a pergunta "opcoes_atendimento" — não preencha "tipo_entrega"/"forma_pagamento", que são só pra quando ele ESCOLHE.
6. "endereco" só quando a mensagem contém um endereço de verdade; use um objeto com os campos que aparecem no texto ("rua","numero","complemento","bairro","cidade","referencia"). Nunca invente rua, bairro ou cidade que o cliente não escreveu. Sem endereço, use null.
7. "quer_cancelar": true só quando o cliente quer desistir do pedido inteiro.
8. Uma saudação, agradecimento ou despedida pura não gera item, pergunta nem confirmação — devolva tudo vazio.
9. Nunca escreva nada além do JSON. Sem markdown, sem texto antes ou depois.`;
}

export interface ParamsInterpretacao {
  pergunta: string;
  estado: EstadoCheckout;
  pendencias: InformacaoPendente[];
  /** Última mensagem que o sistema enviou (última `assistant` do histórico)
   * — é o que dá sentido a uma resposta curta como "tudo certo". */
  ultimaPerguntaDoSistema: string | null;
  config: FluxoPedidoConfig;
  chat?: ChatModel;
}

/**
 * Atalho determinístico: quando a mensagem inteira é só um aceite (ou só uma
 * recusa), não há mais nada a extrair e nenhuma chamada de LLM é feita —
 * grátis, instantâneo e imune a variação do modelo.
 */
export function intencaoDeterministica(pergunta: string): IntencaoDaMensagem | null {
  if (confirmaResumoPendente(pergunta)) return comSocial({ ...INTENCAO_BASE, confirmacao: "confirma" });
  if (negaResumoPendente(pergunta)) return comSocial({ ...INTENCAO_BASE, confirmacao: "nega" });
  return null;
}

export async function interpretarMensagem(params: ParamsInterpretacao): Promise<IntencaoDaMensagem> {
  const atalho = intencaoDeterministica(params.pergunta);
  if (atalho) return atalho;

  const chat = params.chat ?? getChatModel();
  const resultado = await chat.chatCompletion(
    [
      { role: "system", content: montarPrompt(params) },
      { role: "user", content: params.pergunta },
    ],
    { jsonMode: true, temperature: 0 },
  );

  if (!resultado.content) return INTENCAO_VAZIA;
  try {
    return normalizarIntencao(JSON.parse(resultado.content), params.config);
  } catch {
    // Falha de parse nunca vira ação nem vira "social": sem interpretação
    // confiável, a mensagem segue para a investigação normal, que ainda tem
    // o gate de lastro na saída.
    return { ...INTENCAO_VAZIA, perguntas: ["outro"], social: false };
  }
}
