// Interpretador da mensagem do cliente — a ÚNICA coisa que o LLM faz antes de
// o código assumir. Ele lê a mensagem e ROTULA duas coisas: (1) se o cliente
// quer montar/criar/alterar/cancelar um pedido e (2) quais ASSUNTOS está
// perguntando. Não decide nada, não escolhe ferramenta, não sabe o que vai
// acontecer depois.
//
// Na arquitetura atual a IA é só assistente: pedido é criado e gerenciado no
// link público. Quando `quer_pedido` é true, o orquestrador responde com um
// redirecionamento determinístico pro link — a IA nunca monta carrinho nem
// cria pedido.
import { getChatModel } from "../../llm/client.js";
import type { ChatModel } from "../../llm/types.js";

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

export interface IntencaoDaMensagem {
  /** true quando o cliente quer montar, criar, adicionar/remover item,
   * alterar ou cancelar um pedido — nesse caso a IA redireciona pro link
   * público em vez de tentar agir. */
  quer_pedido: boolean;
  perguntas: AssuntoPerguntado[];
  /** Derivado em código: `true` só quando não há intenção de pedido nem
   * pergunta — só aí a mensagem é tratada como conversa social. */
  social: boolean;
}

export const INTENCAO_VAZIA: IntencaoDaMensagem = {
  quer_pedido: false,
  perguntas: [],
  social: true,
};

function comSocial(intencao: Omit<IntencaoDaMensagem, "social">): IntencaoDaMensagem {
  return { ...intencao, social: !intencao.quer_pedido && intencao.perguntas.length === 0 };
}

function listaDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((v) => (typeof v === "string" ? v.trim() : null))
    .filter((t): t is string => t !== null && t.length > 0);
}

/** Nunca confia no shape cru que o modelo devolveu: qualquer valor fora do
 * domínio conhecido vira false/vazio em vez de ser repassado adiante. */
function normalizarIntencao(bruto: unknown): IntencaoDaMensagem {
  if (!bruto || typeof bruto !== "object") return INTENCAO_VAZIA;
  const obj = bruto as Record<string, unknown>;

  const querPedido = obj.quer_pedido === true;
  const perguntas = [...new Set(listaDeTextos(obj.perguntas).filter((p) => ASSUNTOS_VALIDOS.has(p)))] as AssuntoPerguntado[];

  return comSocial({ quer_pedido: querPedido, perguntas });
}

function montarPrompt(ultimaPerguntaDoSistema: string | null): string {
  const ultimaPergunta = ultimaPerguntaDoSistema ? JSON.stringify(ultimaPerguntaDoSistema) : "(nenhuma)";

  return `Você é um classificador de mensagens de um atendimento de food service por WhatsApp. Seu único trabalho é ROTULAR o que a mensagem do cliente contém. Você não decide ação nenhuma, não executa nada, não consulta nada e não conversa com o cliente.

Última pergunta que o sistema fez ao cliente: ${ultimaPergunta}.

Responda APENAS com um objeto JSON neste formato exato:
{"quer_pedido":true|false,"perguntas":[]}

Regras:
1. "quer_pedido": true quando o cliente quer MONTAR OU MUDAR UM PEDIDO — pedir/adicionar item ("quero um X-Bacon"), remover ("tira a batata"), alterar quantidade ("muda pra 2"), cancelar ("quero cancelar meu pedido"), ou confirmar/fechar um pedido. Perguntar informação NÃO é pedir ("quanto custa o X-Bacon?" é pergunta, quer_pedido false).
2. "perguntas": os assuntos sobre os quais o cliente quer informação. Valores possíveis: "cardapio" (o que tem, quais opções, cardápio por categoria), "preco", "adicionais", "combos", "recomendacao", "horario" (que horas abre/fecha), "taxa_entrega" (quanto custa entregar), "area_entrega" (se entrega no bairro dele), "opcoes_atendimento" (se faz entrega/retirada, formas de pagamento), "prazo_entrega" (quanto tempo demora), "politica" (troca, cancelamento, garantia), "status_pedido" (cadê meu pedido), "historico" (o que já pedi antes), "dados_do_cliente" (meu nome, endereço salvo), "outro" (qualquer outra dúvida sobre a loja/produtos, como ingredientes, alergênicos, opção vegana). Pode ter mais de um. Lista vazia se não perguntou nada.
3. Uma saudação, agradecimento ou despedida pura devolve {"quer_pedido":false,"perguntas":[]}.
4. Nunca escreva nada além do JSON. Sem markdown, sem texto antes ou depois.`;
}

export interface ParamsInterpretacao {
  pergunta: string;
  /** Última mensagem que o sistema enviou — dá sentido a respostas curtas. */
  ultimaPerguntaDoSistema: string | null;
  chat?: ChatModel;
}

export async function interpretarMensagem(params: ParamsInterpretacao): Promise<IntencaoDaMensagem> {
  const chat = params.chat ?? getChatModel();
  const resultado = await chat.chatCompletion(
    [
      { role: "system", content: montarPrompt(params.ultimaPerguntaDoSistema) },
      { role: "user", content: params.pergunta },
    ],
    { jsonMode: true, temperature: 0 },
  );

  if (!resultado.content) return INTENCAO_VAZIA;
  try {
    return normalizarIntencao(JSON.parse(resultado.content));
  } catch {
    // Falha de parse nunca vira ação: sem interpretação confiável, trata como
    // pergunta genérica (o gate de lastro continua protegendo a saída).
    return comSocial({ quer_pedido: false, perguntas: ["outro"] });
  }
}
