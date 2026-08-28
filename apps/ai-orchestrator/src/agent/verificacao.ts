import type { EvidenciaColetada } from "./investigador.js";

const REGEX_VALOR_MONETARIO = /R\$\s?\d+(?:[.,]\d{2})?/g;

function normalizarValor(valor: string): string {
  return valor.replace(/[^\d]/g, "");
}

/**
 * Varre recursivamente a evidência bruta (JSON real da ferramenta) e
 * coleta todo valor numérico como um possível preço real — os campos
 * monetários têm nomes diferentes por tool (`preco`, `preco_promocional`,
 * `taxa_entrega`, `total`...), então em vez de manter uma lista de nomes de
 * campo (frágil a ferramenta nova), trata qualquer número na árvore como
 * candidato. Retorna os números BRUTOS (não normalizados ainda) porque
 * `contemValorNaoVerificado` também precisa somá-los entre si (ver
 * `valoresConhecidosComSomas`) — só amplia o conjunto "conhecido" (nunca
 * restringe), então o pior caso é ser permissivo demais com um número que
 * por acaso bate — nunca bloqueia uma resposta legítima.
 */
function extrairValoresNumericosBrutos(valor: unknown, acumulador: number[] = []): number[] {
  if (typeof valor === "number") {
    acumulador.push(Math.round(valor * 100) / 100);
  } else if (Array.isArray(valor)) {
    for (const item of valor) extrairValoresNumericosBrutos(item, acumulador);
  } else if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) extrairValoresNumericosBrutos(v, acumulador);
  }
  return acumulador;
}

/**
 * Conjunto de valores "conhecidos" (normalizados) — cada número bruto
 * sozinho, MAIS a soma de até 3 deles. Episódio real: o Atendente respondeu
 * corretamente "o adicional de ovo é R$ 4,00, aí fica R$ 36,90 no total"
 * (X-Bacon R$ 32,90 + ovo R$ 4,00) ANTES do cliente confirmar adicionar ao
 * carrinho de verdade (sem "consultar_carrinho" pra gerar um total pronto)
 * — os dois valores de origem eram reais, mas "36,90" nunca aparece
 * literalmente em nenhuma evidência sozinha, e a checagem antiga
 * derrubava a resposta como se fosse inventada. Somar é aritmética
 * verificável, não invenção — continua vetando qualquer valor que não seja
 * nem um número real nem a soma de até 3 deles.
 */
function valoresConhecidosComSomas(brutos: number[]): Set<string> {
  const conhecidos = new Set<string>();
  for (const v of brutos) conhecidos.add(normalizarValor(v.toFixed(2)));

  for (let i = 0; i < brutos.length; i++) {
    for (let j = i; j < brutos.length; j++) {
      conhecidos.add(normalizarValor((brutos[i]! + brutos[j]!).toFixed(2)));
      for (let k = j; k < brutos.length; k++) {
        conhecidos.add(normalizarValor((brutos[i]! + brutos[j]! + brutos[k]!).toFixed(2)));
      }
    }
  }

  return conhecidos;
}

/**
 * Checagem determinística (não-LLM) pós-redação: todo valor em R$ que
 * aparece no texto que o Atendente escreveu precisa existir na EVIDÊNCIA
 * BRUTA real (o JSON que a ferramenta de fato retornou), sozinho ou como
 * soma de até 3 valores reais — nunca contra `relatorio.afirmacoes[].texto`,
 * que já é uma paráfrase de outro LLM (o Investigador). Comparar contra o
 * resumo em vez do dado real deixa passar o caso em que o Investigador
 * resume errado E o Atendente cita esse resumo errado — as duas
 * alucinações "combinam" e nada pega isso. Necessário porque o Atendente é
 * um segundo LLM e pode divergir do relatório mesmo bem instruído
 * (CLAUDE.md regra 1).
 */
export function contemValorNaoVerificado(textoFinal: string, evidencias: EvidenciaColetada[]): boolean {
  const valoresNoTexto = (textoFinal.match(REGEX_VALOR_MONETARIO) ?? []).map(normalizarValor);
  if (valoresNoTexto.length === 0) return false;

  const brutos = evidencias.flatMap((e) => extrairValoresNumericosBrutos(e.output));
  const valoresConhecidos = valoresConhecidosComSomas(brutos);

  return valoresNoTexto.some((v) => !valoresConhecidos.has(v));
}

/**
 * Lista fechada de capacidades que a plataforma REALMENTE tem hoje — a IA só
 * fala com o cliente por texto simples no WhatsApp (ver CLAUDE.md regra 7 e
 * docs/product/). Qualquer promessa de formato/canal fora disso (PDF, envio
 * de arquivo/imagem do cardápio, link externo, e-mail) é uma alucinação de
 * capacidade — episódio real: a IA ofereceu "enviar o cardápio em PDF" sem
 * essa funcionalidade existir em lugar nenhum do sistema. Regex, não
 * confiança na palavra do modelo, mesmo que o prompt já instrua o oposto
 * (CLAUDE.md regra 1 — "IA nunca inventa dados" vale pra capacidade do
 * sistema tanto quanto pra preço).
 */
const REGEX_PROMESSA_NAO_SUPORTADA =
  /\bpdf\b|em anexo|arquivo do card[áa]pio|imagem do card[áa]pio|foto do card[áa]pio|link do card[áa]pio|card[áa]pio (?:em|por) (?:e-?mail|email)/i;

export function contemPromessaNaoSuportada(textoFinal: string): boolean {
  return REGEX_PROMESSA_NAO_SUPORTADA.test(textoFinal);
}

/**
 * O sistema resolve o pedido atual da conversa sozinho (ver
 * tools/pedido.ts, resolverPedidoId) — não existe, em lugar nenhum, um
 * número/código de pedido pro cliente informar. Episódio real: a IA pediu
 * "o número ou código do seu pedido" pra responder "o que já tem no meu
 * pedido", algo que o cliente não tinha como fornecer. Mesmo padrão de
 * denylist determinístico de `contemPromessaNaoSuportada`.
 */
const REGEX_PEDE_CODIGO_PEDIDO = /(?:n[úu]mero|c[óo]digo|id)\s+(?:d[oe]\s+)?(?:seu\s+)?pedido/i;

export function pedeCodigoDePedido(textoFinal: string): boolean {
  return REGEX_PEDE_CODIGO_PEDIDO.test(textoFinal);
}

/**
 * Checagem determinística mais crítica de todas (CLAUDE.md regra 1 e 6): o
 * texto final nunca pode afirmar que o pedido foi confirmado/criado/enviado
 * pra cozinha a menos que exista, NA EVIDÊNCIA BRUTA REAL desta mesma rodada,
 * uma chamada de "criar_pedido" que de fato retornou `pedido_criado: true`.
 * Sem isso, nada impede o Atendente (um segundo LLM, que só vê o texto de
 * "afirmações" já parafraseadas pelo Investigador) de simplesmente compor uma
 * confirmação plausível a partir da conversa ("cliente confirmou, então eu
 * confirmo de volta") sem que o pedido tenha sido criado de verdade —
 * episódio real: cliente confirmou um item sem nunca ter informado entrega
 * nem forma de pagamento, e a IA respondeu "seu pedido já está confirmado e
 * vai pra cozinha" sem nenhuma chamada real de "criar_pedido" ter
 * acontecido. Mesmo padrão das outras checagens desta lista: regex
 * determinística, nunca confiança na palavra do modelo.
 */
const REGEX_CONFIRMACAO_DE_PEDIDO =
  /pedido\b[^.!?\n]{0,40}\b(confirmado|criado|realizado|registrado|enviado)\b|\b(confirmado|recebemos|registramos)\b[^.!?\n]{0,20}\bpedido\b|pedido\b[^.!?\n]{0,30}\b(cozinha|prepara[çc][ãa]o)\b|est[áa]\s+(?:sendo\s+)?prepara(?:do|ndo)\b|\ba\s+caminho\b/i;

/**
 * Só considera frases AFIRMATIVAS ("seu pedido já está confirmado") —
 * nunca uma pergunta pedindo confirmação ("Confirma pra eu enviar pra
 * cozinha?"), que é o fluxo legítimo e esperado antes de "criar_pedido"
 * (ver regra 11 do prompt do Investigador). Separa o texto em frases pelos
 * terminadores usuais e descarta qualquer uma que termine em "?".
 */
function frasesAfirmativas(textoFinal: string): string[] {
  return textoFinal
    .split(/(?<=[.!?\n])/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.endsWith("?"));
}

/** Só a parte de detecção de texto (sem checar evidência) — reaproveitada
 * pelo gabarito de personas (eval/personas/cenarios.ts) pra saber quando
 * vale a pena ir conferir no banco real se um pedido de fato foi criado. */
export function afirmaPedidoConfirmado(textoFinal: string): boolean {
  return frasesAfirmativas(textoFinal).some((frase) => REGEX_CONFIRMACAO_DE_PEDIDO.test(frase));
}

export function contemConfirmacaoDePedidoNaoVerificada(textoFinal: string, evidencias: EvidenciaColetada[]): boolean {
  const temAfirmacao = afirmaPedidoConfirmado(textoFinal);
  if (!temAfirmacao) return false;

  const pedidoCriadoDeVerdade = evidencias.some(
    (e) =>
      e.toolNome === "criar_pedido" &&
      e.output &&
      typeof e.output === "object" &&
      (e.output as Record<string, unknown>).pedido_criado === true,
  );
  return !pedidoCriadoDeVerdade;
}

/** Ferramentas cujo resultado inclui nome real de produto/combo — base pra
 * verificar se um nome que o Atendente colocou em negrito existe de
 * verdade. Cada shape é inventariado nas próprias tools (tools/catalogo.ts,
 * cliente.ts, pedido.ts). */
function nomesReaisDeProduto(evidencias: EvidenciaColetada[]): Set<string> {
  const nomes = new Set<string>();
  for (const e of evidencias) {
    const output = e.output as Record<string, unknown> | null;
    if (!output || typeof output !== "object") continue;
    const listas = [output.resultados, output.recomendacoes, output.itens];
    for (const lista of listas) {
      if (!Array.isArray(lista)) continue;
      for (const item of lista) {
        const nome = (item as Record<string, unknown>)?.nome ?? (item as Record<string, unknown>)?.nome_produto;
        if (typeof nome === "string") nomes.add(nome.trim().toLowerCase());
      }
    }
  }
  return nomes;
}

const REGEX_NEGRITO = /\*([^*\n]+)\*/g;

/** Palavras de ênfase comuns que nunca são nome de produto, mesmo em
 * negrito — episódio real: com o carrinho em uso, `nomesConhecidos` deixou
 * de ficar vazio na maioria das conversas (toda tool de carrinho retorna
 * nome de item real), então a rede de segurança de `nomesConhecidos.size
 * === 0` (só protege contra negrito de ênfase quando NENHUM produto foi
 * consultado) parou de cobrir o caso comum: o Atendente escreveu "*Total*"
 * (ou similar) só como ênfase de estilo, isso não bateu com nenhum nome
 * real do carrinho, e a resposta inteira foi descartada por engano —
 * alucinação zero, handoff desnecessário. Lista curta e literal (não regex
 * genérica) pra nunca esconder um nome de produto real que por acaso
 * coincida com uma dessas palavras. */
const PALAVRAS_ENFASE_NAO_PRODUTO = new Set([
  "total",
  "subtotal",
  "pedido",
  "carrinho",
  "confirmar",
  "confirmação",
  "atenção",
  "importante",
  "obrigado",
  "obrigada",
  "desconto",
  "promoção",
  "entrega",
  "pagamento",
  "endereço",
]);

/**
 * Checagem determinística: todo nome de produto que o Atendente escreveu em
 * *negrito* (sintaxe WhatsApp já exigida no prompt pra nome de produto)
 * precisa bater com um nome real retornado por uma busca de catálogo nesta
 * mesma investigação — nunca inventado. Só roda quando a investigação de
 * fato usou alguma ferramenta de catálogo (senão não há base de comparação
 * e o check ficaria cego, gerando falso positivo em qualquer negrito de
 * ênfase comum, tipo "*Atenção*"). Best-effort (não tão forte quanto a
 * checagem de valor monetário — nomes podem ter pequenas variações de
 * grafia), mas fecha a lacuna real: hoje só preço é verificado, nome de
 * produto/categoria inventado passa reto.
 */
export function contemProdutoNaoVerificado(textoFinal: string, evidencias: EvidenciaColetada[]): boolean {
  const nomesConhecidos = nomesReaisDeProduto(evidencias);
  if (nomesConhecidos.size === 0) return false;

  const negritos = [...textoFinal.matchAll(REGEX_NEGRITO)]
    .map((m) => (m[1] ?? "").trim())
    .filter((texto) => texto.length >= 3 && /[a-zà-ú]/i.test(texto))
    .filter((texto) => !PALAVRAS_ENFASE_NAO_PRODUTO.has(texto.toLowerCase()));

  return negritos.some((negrito) => {
    const normalizado = negrito.toLowerCase();
    return ![...nomesConhecidos].some((nome) => nome.includes(normalizado) || normalizado.includes(nome));
  });
}
