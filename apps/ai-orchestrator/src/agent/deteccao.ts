// Detecção de "cliente pediu atendimento humano" — DETERMINÍSTICA, fora do
// LLM, de propósito. Não é delegada ao Investigador/relatório estruturado
// porque essa é uma regra crítica (CLAUDE.md regra 4: handoff sempre que o
// cliente solicitar) que não pode depender da confiabilidade do modelo em
// cada turno — um caso real de produção mostrou a IA respondendo "sou
// humana" quando perguntada, em vez de escalar. Um regex simples nunca
// "esquece" a regra; um LLM pode.

const PADROES_PEDIDO_HUMANO: RegExp[] = [
  /\batendente\b/i,
  /\b(pessoa|humano)\s+(de\s+verdade|real)\b/i,
  /falar\s+com\s+(um|uma)?\s*(pessoa|humano|atendente|algu[ée]m)/i,
  /quero\s+(um\s+)?(humano|atendente)/i,
  /(n[ãa]o)\s+quero\s+(falar\s+com\s+)?(rob[oô]|bot|m[áa]quina|\bia\b|intelig[êe]ncia\s+artificial)/i,
  /transferir?\s+(para|pra)\s+(um\s+)?(atendente|humano)/i,
];

export function clientePediuHumano(texto: string): boolean {
  return PADROES_PEDIDO_HUMANO.some((regex) => regex.test(texto));
}

/**
 * Mensagem de confirmação da transferência — texto FIXO, nunca gerado pelo
 * LLM. É justamente o LLM tentando "improvisar" essa resposta que causou o
 * bug original (afirmar ser humano). Nenhuma etapa de redação entra aqui.
 */
export function mensagemDeTransferencia(usaEmoji: boolean): string {
  const base =
    "Claro! Vou te transferir para um atendente humano agora — já aviso a equipe e alguém te retorna por aqui.";
  return usaEmoji ? `${base} 🙋` : base;
}

/**
 * Detecção de pedido de hora/data atual ("que horas são?", "que dia é hoje?")
 * — DETERMINÍSTICA, fora do LLM, mesmo motivo de `clientePediuHumano`: um LLM
 * "inventa" um horário plausível com facilidade (episódio análogo ao da IA
 * afirmando ser humana). Espelha a regra zero-B do Eddy (SEM_TEMPO_REAL).
 *
 * Deliberadamente NÃO casa "horário de funcionamento", "que horas abre/fecha",
 * "que dia vocês funcionam" — isso é dado de negócio da empresa, respondido
 * pela tool `consultar_horario`, não hora do relógio.
 *
 * Ancorado no texto inteiro (cauda só não-alfanumérica): "que horas são? 🙃"
 * casa, mas "que horas são? quero um x-bacon" NÃO casa — não podemos engolir
 * um pedido real que veio junto na mesma mensagem/rajada.
 */
const PADROES_TEMPO_REAL: RegExp[] = [
  /^\s*que\s+hora(s)?\s*(são|sao|é|e)?\s*(agora|neste\s+momento)?\s*[^A-Za-zÀ-ú0-9]*$/i,
  /^\s*qual\s+(é|e)?\s*(a|o)?\s*hora(s)?\s*(atual)?\s*[^A-Za-zÀ-ú0-9]*$/i,
  /^\s*que\s+dia\s+(é|e|da\s+semana\s+é|estamos)\s*(hoje)?\s*[^A-Za-zÀ-ú0-9]*$/i,
  /^\s*qual\s+(é|e)?\s*(a|o)?\s*(data|data\s+de\s+hoje|dia\s+de\s+hoje)\s*[^A-Za-zÀ-ú0-9]*$/i,
  /^\s*(em\s+que\s+ano\s+(estamos|a\s+gente\s+est[aá])|que\s+ano\s+(é|e)\s+hoje)\s*[^A-Za-zÀ-ú0-9]*$/i,
  /^\s*(hora|data)\s+(atual|de\s+hoje|de\s+agora)\s*[^A-Za-zÀ-ú0-9]*$/i,
];

export function pedeTempoReal(texto: string): boolean {
  return PADROES_TEMPO_REAL.some((regex) => regex.test(texto));
}

/**
 * Resposta FIXA pra pedido de hora/data — texto montado em código, nunca pelo
 * LLM (regra zero-B do Eddy: sem inventar valor, sem placeholder). Mesmo
 * padrão de `mensagemDeTransferencia`.
 */
export function mensagemSemTempoReal(usaEmoji: boolean): string {
  const base =
    "Não consigo consultar a hora ou a data atual em tempo real. Mas posso ajudar com o cardápio e pedidos — no que posso te ajudar?";
  return usaEmoji ? `${base} 🙂` : base;
}

/**
 * Detecção de pergunta sobre a identidade da própria IA ("quem é você?",
 * "qual seu nome?", "você é um robô?", "você é de verdade?") —
 * DETERMINÍSTICA, mesmo motivo das anteriores: episódio real de produção
 * mostrou a IA afirmando ser humana quando perguntada, em vez de admitir
 * que é uma IA (CLAUDE.md regra 3). Nunca deixa essa resposta na mão livre
 * do LLM — nem pra confirmar, nem pra negar.
 *
 * Distinta de `clientePediuHumano`: perguntar "você é um robô?" é uma
 * pergunta sobre identidade (quer uma resposta honesta), não
 * necessariamente um pedido de transferência — por isso não força handoff,
 * só responde a verdade e deixa a porta aberta pra pedir humano se quiser.
 */
const PADROES_IDENTIDADE: RegExp[] = [
  /quem\s+(é|e)\s+voc[êe]\b/i,
  /qual\s+(é|e)?\s*(o\s+)?(seu|teu)\s+nome\b/i,
  /\bvoc[êe]s?\s+(é|e)\s+(um[a]?\s+)?(rob[oô]|bot|ia\b|intelig[êe]ncia\s+artificial)/i,
  /\bvoc[êe]\s+(é|e)\s+(um[a]?\s+)?(pessoa|humano)\b/i,
  /\bvoc[êe]\s+(é|e)\s+(de\s+verdade|real)\b/i,
  /o\s+que\s+voc[êe]\s+(é|e)\b/i,
  /\bquem\s+(te\s+)?criou\b/i,
  /\bvoc[êe]\s+(tem\s+)?nome\b/i,
];

export function pedeIdentidade(texto: string): boolean {
  return PADROES_IDENTIDADE.some((regex) => regex.test(texto));
}

/**
 * Resposta FIXA sobre a identidade da IA — texto montado em código, nunca
 * pelo LLM. `nomeAssistente` vem de `ia_configuracoes.nome_assistente`
 * (dado real configurado pela empresa); quando não configurado, usa um
 * texto genérico honesto em vez de inventar um nome (CLAUDE.md regra 1
 * vale pra identidade tanto quanto pra dado comercial).
 */
export function mensagemDeIdentidade(
  nomeAssistente: string | null,
  usaEmoji: boolean,
): string {
  const base = nomeAssistente
    ? `Sou o(a) ${nomeAssistente}, um assistente virtual (inteligência artificial) que atende por aqui.`
    : "Sou um assistente virtual (inteligência artificial) que atende por aqui.";
  const complemento =
    " Se preferir, posso te transferir pra um atendente humano — é só pedir.";
  return usaEmoji ? `${base}${complemento} 🤖` : `${base}${complemento}`;
}

/**
 * Resposta FIXA pro cliente que quer montar/criar/alterar/cancelar um pedido
 * — texto montado em código, nunca pelo LLM. A IA não tem (e não deve ter)
 * nenhuma ação de pedido: o pedido é feito e gerenciado pelo link público
 * (arquitetura atual). `linkPublico` é a URL da loja; quando não disponível,
 * orienta genericamente sem prometer um link que não existe.
 */
export function mensagemPedidoPeloLink(
  linkPublico: string | null,
  usaEmoji: boolean,
): string {
  const base = linkPublico
    ? `Os pedidos agora são feitos pelo nosso cardápio online — é por lá que você monta, altera e acompanha seu pedido: ${linkPublico}`
    : "Os pedidos agora são feitos pelo nosso cardápio online — é por lá que você monta, altera e acompanha seu pedido. Peça o link pra equipe se ainda não tiver recebido.";
  const complemento =
    " Eu sigo aqui pra tirar dúvidas sobre o cardápio, preços e prazos.";
  return usaEmoji ? `${base}.${complemento} 🙌` : `${base}.${complemento}`;
}

/**
 * Resposta FIXA pro cliente que pede o cardápio — texto montado em código,
 * nunca pelo LLM. A IA não lista os itens: direciona o cliente ao cardápio
 * online (link público), onde ele mesmo vê tudo e monta o pedido. `linkPublico`
 * é a URL da loja; quando não disponível, orienta genericamente.
 */
export function mensagemCardapioPeloLink(
  linkPublico: string | null,
  usaEmoji: boolean,
): string {
  const base = linkPublico
    ? `O pedido é feito pelo nosso cardápio online — é por lá que você vê tudo o que temos e monta seu pedido: ${linkPublico}`
    : "O pedido é feito pelo nosso cardápio online — é por lá que você vê tudo o que temos e monta seu pedido. Peça o link pra equipe se ainda não tiver recebido.";
  const complemento = " Fico por aqui pra tirar qualquer dúvida.";
  return usaEmoji ? `${base}.${complemento} 😊` : `${base}.${complemento}`;
}

/**
 * Rodapé fixo que orienta o cliente a fazer o pedido pelo cardápio online —
 * anexado (em código, nunca pelo LLM) à primeira mensagem da conversa e a
 * respostas sobre produtos/catálogo. `linkPublico` é a URL da loja; quando
 * não disponível, orienta genericamente sem prometer uma URL que não existe.
 */
export function trechoLinkPublico(linkPublico: string | null): string {
  return linkPublico
    ? ` O pedido é feito pelo nosso cardápio online, por aqui:\n ${linkPublico}`
    : " O pedido é feito pelo nosso cardápio online — peça o link pra equipe se ainda não tiver recebido.";
}
