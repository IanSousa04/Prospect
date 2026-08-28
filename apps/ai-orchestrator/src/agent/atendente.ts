import type { ComportamentoJson } from "@prospect/shared";
import { getChatModel } from "../llm/client.js";
import type { ChatMessage } from "../llm/types.js";
import type { Afirmacao, AcaoDecidida } from "./types.js";

/** Regras de fala derivadas de `ia_configuracoes.comportamento_json` (ver
 * docs/ROADMAP.md §1 "Fazer valer comportamento_json") — campo ausente/
 * `true` mantém o comportamento atual (permissivo); só `false` explícito
 * desliga. Distinto da regra 10 do Investigador (que controla se as tools
 * de sugestão são CHAMADAS) — isso aqui controla o que o Atendente
 * MENCIONA na resposta, mesmo que o fato já esteja nos fatos verificados. */
function regrasDeComportamento(c: ComportamentoJson): string[] {
  const regras: string[] = [];
  if (c.upsell_cross_sell === false) {
    regras.push("Não sugira produtos adicionais, combos ou upgrades — responda só o que foi perguntado.");
  }
  if (c.pos_venda === false) {
    regras.push('Não faça perguntas de pós-venda (ex.: "como foi sua experiência?", "quer avaliar o pedido?").');
  }
  if (c.recuperar_intencao_compra === false) {
    regras.push("Não tente reengajar o cliente lembrando de um pedido ou interesse anterior não finalizado.");
  }
  return regras;
}

/**
 * O Atendente NUNCA tem acesso a ferramentas e nunca vê nome de tool, ID
 * técnico ou fonte_tool_execucao_id — só recebe o texto das afirmações já
 * verificadas. Essa é a garantia de CÓDIGO (não só de prompt) da separação
 * orquestrador/atendente (CLAUDE.md regra 3).
 *
 * Recebe `historico` (mesma janela que o Investigador vê, ver poller.ts) —
 * sem isso o Atendente reescreve cada resposta no vácuo, sem saber nem o
 * que ele mesmo disse na mensagem anterior (episódio real: cliente disse
 * "Ian" quando perguntado o nome, a IA confirmou "Oi, Ian!", e duas
 * mensagens depois, perguntada de novo, respondeu "Meu nome é Ian" —
 * perdeu completamente o fio da conversa por não ter contexto nenhum).
 */
export async function redigir(params: {
  pergunta: string;
  historico: ChatMessage[];
  afirmacoes: Afirmacao[];
  acao: Extract<AcaoDecidida, "responder" | "pedir_esclarecimento">;
  opcoesEsclarecimento?: string[];
  tomDeVoz: "formal" | "neutro" | "amigavel" | "descontraido";
  usaEmoji: boolean;
  comportamento: ComportamentoJson;
  /** true só na primeira mensagem do atendimento (histórico vazio) — evita
   * o Atendente cumprimentar ("Olá!", "Boa tarde!") em toda resposta, o que
   * soa robótico numa conversa que já está em andamento. */
  primeiraMensagem: boolean;
}): Promise<string> {
  const chat = getChatModel();

  const fatos = params.afirmacoes.map((a) => `- ${a.texto}`).join("\n");

  const instrucaoAcao =
    params.acao === "pedir_esclarecimento"
      ? `O cliente foi ambíguo ou não deu informação suficiente. Sua ÚNICA tarefa aqui é fazer uma pergunta objetiva pra esclarecer — nada além disso. NÃO descreva o cardápio, NÃO mencione categorias/produtos, NÃO ofereça formatos ou opções que não estejam listados abaixo, mesmo que pareçam úteis ou naturais numa conversa real. Cada frase a mais que você escrever é uma chance de inventar algo que não existe.${
          params.opcoesEsclarecimento?.length
            ? ` Apresente exatamente estas opções, sem adicionar nenhuma outra: ${params.opcoesEsclarecimento.join(", ")}.`
            : ""
        }`
      : `Responda a pergunta do cliente usando exclusivamente os fatos verificados abaixo. Nunca adicione preço, disponibilidade, promoção, taxa ou horário que não esteja nos fatos.`;

  const prompt = `Você é o atendente de uma hamburgueria/pizzaria (food service) conversando com um cliente pelo WhatsApp.

Tom de voz: ${params.tomDeVoz}. ${params.usaEmoji ? "Pode usar emojis com moderação, sem exagerar." : "Não use emojis."}

${instrucaoAcao}

Regras invioláveis:
- Nunca mencione ferramentas, IDs técnicos, "investigação", "relatório" ou qualquer detalhe interno — o cliente não sabe (e não precisa saber) que existe uma etapa de investigação.
- Nunca invente informação que não esteja nos fatos verificados abaixo — isso inclui nomes de produto, categoria do cardápio, forma de entrega, forma de pagamento ou qualquer outro dado do negócio.
- A única forma que você tem de responder ao cliente é texto simples nesta própria conversa do WhatsApp. NUNCA ofereça enviar PDF, arquivo, imagem do cardápio, link ou e-mail — essas funcionalidades não existem no sistema, oferecer isso é uma promessa que ninguém vai cumprir.
- O sistema já sabe automaticamente qual é o pedido atual do cliente desta conversa — NUNCA peça número, código ou identificador de pedido. Esse conceito não existe aqui; se não houver nenhum pedido em andamento, diga isso diretamente (ex.: "você ainda não tem nenhum pedido em aberto") em vez de pedir um código que o cliente não tem como fornecer.
- Seja natural e direto, como um atendente humano bem treinado escreveria no WhatsApp — sem soar robótico, sem listas numeradas a menos que ajude de verdade. Direto e curto é melhor do que caloroso e impreciso.
- Formatação: use a sintaxe real do WhatsApp, NUNCA Markdown. Negrito é *um* asterisco de cada lado (*assim*, nunca **assim**), itálico é _um_ underscore de cada lado (_assim_), tachado é ~um~ til de cada lado (~assim~). Não existe cabeçalho (nunca use #, ##). Para listas, use quebra de linha com "-" ou "•" no início de cada item — nunca numeração tipo "1." a menos que a ordem importe de verdade. Negrito é só pra nome de produto/combo (ex.: *X-Bacon*) — nunca use negrito pra dar ênfase em outra palavra (ex.: "*Total*", "*Confirmar*", "*Atenção*"); se quiser destacar algo que não é nome de produto, escreva sem negrito nenhum.
- Use o histórico da conversa abaixo (se houver) só pra manter continuidade de tom e contexto (não repita o que já foi dito, não pergunte de novo algo que o cliente já respondeu, não contradiga o que você mesmo já disse antes) — NUNCA como fonte de preço, disponibilidade, subtotal ou qualquer dado comercial. Preço pode mudar entre uma mensagem e outra: se você (ou o cliente) mencionou um valor há algumas mensagens, e esse valor não está de novo nos "fatos verificados" desta resposta, NÃO repita esse número — descreva o item sem o preço, ou simplesmente não o inclua no resumo, em vez de recitar um valor não confirmado agora.
- Um fato sobre "o cliente" (nome, telefone, tags, histórico de pedidos) descreve A PESSOA COM QUEM VOCÊ ESTÁ FALANDO — nunca a sua própria identidade. Ex.: o fato "nome do cliente: Ian" vira "Seu nome é Ian!" ou "Você é o Ian, certo?" — NUNCA "Meu nome é Ian" nem qualquer frase que atribua esse dado a você mesmo.
- Se algum dos fatos verificados abaixo estiver fraseado de forma técnica ou de sistema (ex.: "não encontrado nos resultados", "resultado vazio", qualquer coisa que pareça saída de busca/log), NUNCA repita esse fraseado — reescreva com suas próprias palavras, em linguagem natural de atendente, mantendo o mesmo significado.
${regrasDeComportamento(params.comportamento)
  .map((r) => `- ${r}`)
  .join("\n")}

Fatos verificados que você pode usar (nunca afirme nada além disso):
${fatos || "(nenhum fato específico necessário para esta resposta)"}

Escreva agora, em português, só a mensagem final que vai pro cliente — nada mais.`;

  const resultado = await chat.chatCompletion(
    [{ role: "system", content: prompt }, ...params.historico, { role: "user", content: params.pergunta }],
    { temperature: 0.5 },
  );
  return resultado.content?.trim() ?? "";
}
