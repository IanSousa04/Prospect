import type { EvidenciaColetada } from "./investigador.js";

const REGEX_VALOR_MONETARIO = /R\$\s?\d+(?:[.,]\d{2})?/g;

function normalizarValor(valor: string): string {
  return valor.replace(/[^\d]/g, "");
}

/**
 * Varre recursivamente a evidência bruta (JSON real da ferramenta) e
 * coleta todo valor numérico como um possível preço real, normalizado pro
 * mesmo formato de `normalizarValor` (ex.: 32.9 → "32.90" → "3290", igual
 * "R$ 32,90" normalizado) — os campos monetários têm nomes diferentes por
 * tool (`preco`, `preco_promocional`, `taxa_entrega`, `total`...), então em
 * vez de manter uma lista de nomes de campo (frágil a ferramenta nova),
 * trata qualquer número na árvore como candidato. Só amplia o conjunto
 * "conhecido" (nunca restringe), então o pior caso é ser permissivo demais
 * com um número que por acaso bate — nunca bloqueia uma resposta legítima.
 */
function extrairValoresNumericos(valor: unknown, acumulador: string[] = []): string[] {
  if (typeof valor === "number") {
    acumulador.push(normalizarValor(valor.toFixed(2)));
  } else if (Array.isArray(valor)) {
    for (const item of valor) extrairValoresNumericos(item, acumulador);
  } else if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) extrairValoresNumericos(v, acumulador);
  }
  return acumulador;
}

/**
 * Checagem determinística (não-LLM) pós-redação: todo valor em R$ que
 * aparece no texto que o Atendente escreveu precisa existir na EVIDÊNCIA
 * BRUTA real (o JSON que a ferramenta de fato retornou) — nunca contra
 * `relatorio.afirmacoes[].texto`, que já é uma paráfrase de outro LLM
 * (o Investigador). Comparar contra o resumo em vez do dado real deixa
 * passar o caso em que o Investigador resume errado E o Atendente cita
 * esse resumo errado — as duas alucinações "combinam" e nada pega isso.
 * Necessário porque o Atendente é um segundo LLM e pode divergir do
 * relatório mesmo bem instruído (CLAUDE.md regra 1).
 */
export function contemValorNaoVerificado(textoFinal: string, evidencias: EvidenciaColetada[]): boolean {
  const valoresNoTexto = (textoFinal.match(REGEX_VALOR_MONETARIO) ?? []).map(normalizarValor);
  if (valoresNoTexto.length === 0) return false;

  const valoresConhecidos = new Set(evidencias.flatMap((e) => extrairValoresNumericos(e.output)));

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
