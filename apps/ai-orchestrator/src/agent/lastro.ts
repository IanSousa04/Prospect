// Gate de lastro (tarefa 0082) — a última camada antes de a mensagem sair.
//
// Inverte o default do Atendente. Até aqui ele podia escrever tudo que não
// estivesse explicitamente proibido, e a defesa era uma lista de proibições
// que crescia a cada bug (valor em R$, produto em negrito, promessa de PDF,
// código de pedido, afirmação transacional). Uma conversa real mostrou o
// limite disso: a IA afirmou "no momento a gente não tá fazendo entregas" —
// uma regra de negócio inventada, sobre a qual nenhuma proibição existia — e
// afirmou "a gente tem várias opções no cardápio" logo depois de receber o
// fato de que a busca não tinha achado nada.
//
// Agora a regra é a inversa: toda afirmação SOBRE O NEGÓCIO precisa estar
// ancorada num fato verificado desta rodada. Cortesia, tom, perguntas e
// repetição do que o próprio cliente disse passam livres — o gate não é um
// juiz de estilo.
//
// Bloquear aqui nunca vira silêncio: o chamador regenera citando as frases
// exatas e, no limite, usa a mensagem determinística montada dos fatos.
import { getChatModel } from "../llm/client.js";
import type { ChatModel } from "../llm/types.js";
import { frasesAfirmativas } from "./verificacao.js";

/** Fato como o gate enxerga. `negaExistenciaDe` só é preenchido pelos fatos
 * negativos que o próprio código gera ("a busca não encontrou pizza"), e é o
 * que permite detectar contradição sem gastar uma chamada de LLM. */
export interface FatoParaLastro {
  texto: string;
  negaExistenciaDe?: string;
}

export type MotivoSemLastro = "sem_evidencia" | "contradiz_evidencia";

export interface AfirmacaoSemLastro {
  frase: string;
  motivo: MotivoSemLastro;
}

export interface VeredictoLastro {
  aprovado: boolean;
  semLastro: AfirmacaoSemLastro[];
}

const APROVADO: VeredictoLastro = { aprovado: true, semLastro: [] };

const REGEX_NEGACAO = /\b(n[ãa]o|nenhum|nenhuma|sem)\b/i;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Camada 1, determinística e grátis: se um fato diz que X não existe e o
 * texto fala de X numa frase afirmativa, isso é contradição direta — não
 * precisa de LLM pra saber. Cobre exatamente o caso da pizza.
 */
export function detectarContradicao(texto: string, fatos: FatoParaLastro[]): AfirmacaoSemLastro[] {
  const negados = fatos
    .map((f) => f.negaExistenciaDe)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map(normalizar);
  if (negados.length === 0) return [];

  const contradicoes: AfirmacaoSemLastro[] = [];
  for (const frase of frasesAfirmativas(texto)) {
    const fraseNormalizada = normalizar(frase);
    // Uma frase que já nega ("não temos pizza") está correta — é justamente
    // o que queremos que a IA diga.
    if (REGEX_NEGACAO.test(frase)) continue;
    if (negados.some((termo) => fraseNormalizada.includes(termo))) {
      contradicoes.push({ frase: frase.trim(), motivo: "contradiz_evidencia" });
    }
  }
  return contradicoes;
}

const PROMPT_LASTRO = `Você audita uma mensagem que um atendente de delivery está prestes a enviar a um cliente por WhatsApp. Sua única tarefa é apontar as afirmações SOBRE O NEGÓCIO que não estão sustentadas pela lista de fatos verificados.

Responda APENAS com JSON: {"afirmacoes_sem_lastro":["frase exata copiada da mensagem", "..."]}. Lista vazia quando estiver tudo sustentado.

CONSIDERE afirmação sobre o negócio (precisa de fato que sustente):
- existência, disponibilidade, nome, descrição ou preço de produto, adicional ou combo;
- se a loja faz entrega ou retirada, quais formas de pagamento aceita, taxa, raio ou região de entrega;
- horário de funcionamento, prazo de preparo ou entrega, política de troca/cancelamento;
- estado do pedido ou do carrinho do cliente, e o histórico de pedidos dele.

NÃO considere (deixe passar sempre):
- cumprimento, agradecimento, emoji, elogio, entusiasmo, empatia;
- qualquer pergunta feita ao cliente;
- repetição do que o próprio cliente acabou de dizer;
- dizer que NÃO tem uma informação, que não encontrou algo ou que vai verificar;
- oferecer transferir para um atendente humano.

Regras:
1. Copie a frase EXATAMENTE como aparece na mensagem, sem reescrever.
2. Uma afirmação está sustentada quando algum fato diz a mesma coisa. Não precisa ser palavra por palavra, mas o fato precisa cobrir o conteúdo — um preço diferente do fato, ou um produto que não aparece em fato nenhum, não está sustentado.
3. Se a mensagem afirma que algo existe e um fato diz que não existe, aponte a frase.
4. Na dúvida sobre uma afirmação de negócio, aponte a frase.`;

function montarEntrada(texto: string, fatos: FatoParaLastro[]): string {
  const lista = fatos.length > 0 ? fatos.map((f) => `- ${f.texto}`).join("\n") : "(nenhum fato verificado nesta rodada)";
  return `Fatos verificados:\n${lista}\n\nMensagem a auditar:\n"""\n${texto}\n"""`;
}

/**
 * Camada 2: uma única chamada de LLM para a mensagem inteira (não uma por
 * frase). Recebe o texto e os fatos e devolve as frases sem lastro.
 */
async function auditarComModelo(texto: string, fatos: FatoParaLastro[], chat: ChatModel): Promise<string[]> {
  try {
    const resultado = await chat.chatCompletion(
      [
        { role: "system", content: PROMPT_LASTRO },
        { role: "user", content: montarEntrada(texto, fatos) },
      ],
      { jsonMode: true, temperature: 0 },
    );
    if (!resultado.content) return [];
    const bruto = JSON.parse(resultado.content) as Record<string, unknown>;
    const lista = bruto.afirmacoes_sem_lastro;
    if (!Array.isArray(lista)) return [];
    return lista.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim());
  } catch {
    // Auditor indisponível não pode travar a conversa: a camada
    // determinística de contradição já rodou, e as verificações
    // específicas (valor, produto, promessa) continuam valendo em
    // `verificacao.ts`.
    return [];
  }
}

export async function verificarLastro(params: {
  texto: string;
  fatos: FatoParaLastro[];
  chat?: ChatModel;
}): Promise<VeredictoLastro> {
  const { texto, fatos } = params;

  const contradicoes = detectarContradicao(texto, fatos);
  if (contradicoes.length > 0) return { aprovado: false, semLastro: contradicoes };

  const chat = params.chat ?? getChatModel();
  const frases = await auditarComModelo(texto, fatos, chat);
  if (frases.length === 0) return APROVADO;

  return { aprovado: false, semLastro: frases.map((frase) => ({ frase, motivo: "sem_evidencia" as const })) };
}

/**
 * Instrução da única retentativa de redação: cita as frases exatas que não
 * podem ser afirmadas. Dizer QUAL frase caiu funciona muito melhor do que
 * repetir a regra genérica — o modelo reescreve aquele trecho em vez de
 * reformular a mensagem inteira e reintroduzir o mesmo problema.
 */
export function instrucaoDeCorrecaoDeLastro(veredicto: VeredictoLastro): string {
  const contradiz = veredicto.semLastro.filter((a) => a.motivo === "contradiz_evidencia");
  const semFato = veredicto.semLastro.filter((a) => a.motivo === "sem_evidencia");

  const partes: string[] = [
    "ATENÇÃO: sua resposta anterior foi descartada porque afirmava coisas sobre o negócio que os fatos verificados não sustentam.",
  ];
  if (contradiz.length > 0) {
    partes.push(
      `Estas frases contradizem diretamente um fato verificado — o correto é dizer que NÃO temos: ${contradiz
        .map((a) => `"${a.frase}"`)
        .join("; ")}.`,
    );
  }
  if (semFato.length > 0) {
    partes.push(
      `Estas frases não têm nenhum fato que as sustente: ${semFato.map((a) => `"${a.frase}"`).join("; ")}.`,
    );
  }
  partes.push(
    "Reescreva a mensagem sem nenhuma delas. Se o cliente perguntou algo que os fatos não cobrem, diga com naturalidade que você não tem essa informação e ofereça chamar um atendente — nunca preencha a lacuna com o que seria plausível.",
  );
  return partes.join(" ");
}
