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

/** Conjunto de valores "conhecidos" (normalizados) — cada número bruto
 * sozinho, MAIS a soma de até 3 deles. Somar é aritmética verificável, não
 * invenção — continua vetando qualquer valor que não seja nem um número real
 * nem a soma de até 3 deles. */
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

/** Checagem determinística (não-LLM) pós-redação: todo valor em R$ que
 * aparece no texto que o Atendente escreveu precisa existir na EVIDÊNCIA
 * BRUTA real (o JSON que a ferramenta de fato retornou), sozinho ou como
 * soma de até 3 valores reais — nunca contra `relatorio.afirmacoes[].texto`,
 * que já é uma paráfrase de outro LLM (o Investigador). (CLAUDE.md regra 1). */
export function contemValorNaoVerificado(textoFinal: string, evidencias: EvidenciaColetada[]): boolean {
  const valoresNoTexto = (textoFinal.match(REGEX_VALOR_MONETARIO) ?? []).map(normalizarValor);
  if (valoresNoTexto.length === 0) return false;

  const brutos = evidencias.flatMap((e) => extrairValoresNumericosBrutos(e.output));
  const valoresConhecidos = valoresConhecidosComSomas(brutos);

  return valoresNoTexto.some((v) => !valoresConhecidos.has(v));
}

/**
 * Lista fechada de capacidades que a plataforma REALMENTE tem hoje — a IA só
 * fala com o cliente por texto simples no WhatsApp (ver CLAUDE.md regra 7).
 * Qualquer promessa de formato/canal fora disso (PDF, envio de arquivo/imagem
 * do cardápio, link do cardápio, e-mail) é uma alucinação de capacidade. O
 * redirecionamento pro link público é feito por mensagem FIXA determinística
 * (agent/deteccao.ts), nunca gerado aqui.
 */
const REGEX_PROMESSA_NAO_SUPORTADA =
  /\bpdf\b|em anexo|arquivo do card[áa]pio|imagem do card[áa]pio|foto do card[áa]pio|link do card[áa]pio|card[áa]pio (?:em|por) (?:e-?mail|email)/i;

export function contemPromessaNaoSuportada(textoFinal: string): boolean {
  return REGEX_PROMESSA_NAO_SUPORTADA.test(textoFinal);
}

/**
 * O sistema resolve o pedido atual da conversa sozinho (ver
 * tools/pedido.ts, resolverPedidoId) — não existe, em lugar nenhum, um
 * número/código de pedido pro cliente informar.
 */
const REGEX_PEDE_CODIGO_PEDIDO = /(?:n[úu]mero|c[óo]digo|id)\s+(?:d[oe]\s+)?(?:seu\s+)?pedido/i;

export function pedeCodigoDePedido(textoFinal: string): boolean {
  return REGEX_PEDE_CODIGO_PEDIDO.test(textoFinal);
}

/** Separa o texto em frases pelos terminadores usuais e descarta qualquer
 * uma que termine em "?" — usado pelo gate de lastro pra considerar só
 * frases afirmativas. */
export function frasesAfirmativas(textoFinal: string): string[] {
  return textoFinal
    .split(/(?<=[.!?\n])/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.endsWith("?"));
}

/** Ferramentas cujo resultado inclui nome real de produto/combo — base pra
 * verificar se um nome que o Atendente colocou em negrito existe de
 * verdade. */
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
 * negrito. Lista curta e literal (não regex genérica) pra nunca esconder um
 * nome de produto real que por acaso coincida com uma dessas palavras. */
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
  "retirada",
  "pagamento",
  "endereço",
  "dinheiro",
  "pix",
  "cartão",
  "crédito",
  "débito",
  "resumo",
  "valor",
  "taxa",
]);

/**
 * Checagem determinística: todo nome de produto que o Atendente escreveu em
 * *negrito* (sintaxe WhatsApp já exigida no prompt pra nome de produto)
 * precisa bater com um nome real retornado por uma busca de catálogo nesta
 * mesma investigação — nunca inventado. Só roda quando a investigação de
 * fato usou alguma ferramenta de catálogo (senão não há base de comparação).
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
