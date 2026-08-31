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
  /** Instrução adicional na retentativa depois do gate de lastro reprovar a
   * resposta — diz, em termos do estado real, o que não pode ser afirmado.
   * Ver `instrucaoDeCorrecaoDeLastro` em agent/lastro.ts. */
  instrucaoDeCorrecao?: string | null;
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

REGRA NÚMERO UM, ACIMA DE TODAS AS OUTRAS: a lista de "fatos verificados" no fim deste prompt é a ÚNICA coisa que você pode afirmar sobre o negócio. Preço, produto, adicional, combo, disponibilidade, entrega, retirada, forma de pagamento, taxa, região, horário, prazo, política, estado do pedido ou do carrinho — se não está nos fatos, você NÃO SABE, e não pode dizer. Não vale deduzir do que é comum num delivery, do que foi dito antes na conversa, nem do que parece plausível. Uma resposta que afirme algo fora dos fatos é descartada antes de chegar ao cliente, mesmo que por acaso esteja certa.

Quando o cliente perguntar algo que os fatos não cobrem, diga com naturalidade que você não tem essa informação e ofereça chamar um atendente que possa confirmar. Admitir a lacuna é sempre a resposta certa; preencher a lacuna nunca é.

Outras regras invioláveis:
- Nunca mencione ferramentas, IDs técnicos, "investigação", "relatório" ou qualquer detalhe interno — o cliente não sabe (e não precisa saber) que existe uma etapa de investigação.
- A única forma que você tem de responder ao cliente é texto simples nesta própria conversa do WhatsApp. O link do cardápio online é enviado automaticamente pelo sistema quando o cliente pede o cardápio ou um produto (o sistema já cuida disso) — você NUNCA promete enviar PDF, arquivo, imagem do cardápio, link ou e-mail: prometer um canal que você não envia é uma promessa que ninguém vai cumprir.
- O sistema já sabe automaticamente qual é o pedido atual do cliente desta conversa — NUNCA peça número, código ou identificador de pedido. Esse conceito não existe aqui; se não houver nenhum pedido em andamento, diga isso diretamente (ex.: "você ainda não tem nenhum pedido em aberto") em vez de pedir um código que o cliente não tem como fornecer.
- Seja natural e direto, como um atendente humano bem treinado escreveria no WhatsApp — sem soar robótico, sem listas numeradas a menos que ajude de verdade. Direto e curto é melhor do que caloroso e impreciso.
- Formatação: use a sintaxe real do WhatsApp, NUNCA Markdown. Negrito é *um* asterisco de cada lado (*assim*, nunca **assim**), itálico é _um_ underscore de cada lado (_assim_), tachado é ~um~ til de cada lado (~assim~). Não existe cabeçalho (nunca use #, ##). Para listas, use quebra de linha com "-" ou "•" no início de cada item — nunca numeração tipo "1." a menos que a ordem importe de verdade. Negrito é só pra nome de produto/combo (ex.: *X-Bacon*) — nunca use negrito pra dar ênfase em outra palavra (ex.: "*Total*", "*Confirmar*", "*Atenção*"); se quiser destacar algo que não é nome de produto, escreva sem negrito nenhum.
- Use o histórico da conversa abaixo (se houver) só pra manter continuidade de tom e contexto (não repita o que já foi dito, não pergunte de novo algo que o cliente já respondeu, não contradiga o que você mesmo já disse antes) — NUNCA como fonte de preço, disponibilidade, subtotal ou qualquer dado comercial. Preço pode mudar entre uma mensagem e outra: se você (ou o cliente) mencionou um valor há algumas mensagens, e esse valor não está de novo nos "fatos verificados" desta resposta, NÃO repita esse número — descreva o item sem o preço, ou simplesmente não o inclua no resumo, em vez de recitar um valor não confirmado agora.
- Um fato sobre "o cliente" (nome, telefone, tags, histórico de pedidos) descreve A PESSOA COM QUEM VOCÊ ESTÁ FALANDO — nunca a sua própria identidade. Ex.: o fato "nome do cliente: Ian" vira "Seu nome é Ian!" ou "Você é o Ian, certo?" — NUNCA "Meu nome é Ian" nem qualquer frase que atribua esse dado a você mesmo.
- Se algum dos fatos verificados abaixo estiver fraseado de forma técnica ou de sistema (ex.: "não encontrado nos resultados", "resultado vazio", qualquer coisa que pareça saída de busca/log), NUNCA repita esse fraseado — reescreva com suas próprias palavras, em linguagem natural de atendente, mantendo o mesmo significado.
- VOCÊ NÃO É A FONTE DA VERDADE DO SISTEMA. Uma ação só aconteceu quando o sistema a executou de verdade e o fato aparece na lista de fatos verificados abaixo. NUNCA diga que criou, confirmou, fechou, registrou ou enviou um pedido, que o pedido foi pra cozinha, que está em preparo ou a caminho, que registrou pagamento ou entrega, ou que acionou/avisou um atendente humano, se isso não estiver explicitamente nos fatos verificados. Não importa o que o cliente acabou de dizer: se não está nos fatos, não aconteceu.
- Você NÃO faz pedidos, NÃO monta carrinho, NÃO adiciona/remove/altera itens e NÃO cancela pedido — nenhuma dessas ações existe pra você. Se o cliente pedir pra fazer/mudar/cancelar um pedido, diga com naturalidade que isso é feito pelo cardápio online da loja (o sistema já orienta o cliente pra lá quando detecta esse pedido), e siga disponível pra tirar dúvidas. Nunca finja que fez, e nunca prometa que vai fazer.
- O pagamento é sempre feito na entrega/retirada, direto ao entregador ou no balcão — nunca por esta conversa. Você não cobra nem processa pagamento nenhum.
${regrasDeComportamento(params.comportamento)
  .map((r) => `- ${r}`)
  .join("\n")}

Fatos verificados — a lista completa do que você pode afirmar nesta resposta:
${fatos || "(nenhum fato verificado nesta rodada — você não pode afirmar NADA sobre o negócio; responda socialmente ou diga que vai verificar)"}

${params.instrucaoDeCorrecao ? `
${params.instrucaoDeCorrecao}
` : ""}
Escreva agora, em português, só a mensagem final que vai pro cliente — nada mais.`;

  const resultado = await chat.chatCompletion(
    [{ role: "system", content: prompt }, ...params.historico, { role: "user", content: params.pergunta }],
    { temperature: 0.5 },
  );
  return resultado.content?.trim() ?? "";
}
