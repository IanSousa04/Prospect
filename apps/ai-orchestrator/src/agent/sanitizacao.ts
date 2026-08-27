/**
 * Rede de segurança determinística (não-LLM) pós-redação: corrige os erros
 * de formatação mais comuns do Atendente (segundo LLM, mesmo bem instruído
 * no prompt — ver `redigir()` em atendente.ts) para a sintaxe real do
 * WhatsApp, nunca Markdown genérico. Mesmo espírito de `verificacao.ts`
 * (checagem em código depois da geração, prompt sozinho não garante 100%).
 *
 * Sintaxe do WhatsApp: negrito com *um* asterisco, itálico com _underscore_,
 * tachado com ~til~; não existe suporte a cabeçalhos (#) nem a blocos de
 * código Markdown (```) fora do monoespaçado real.
 */
export function sanitizarFormatacaoWhatsapp(texto: string): string {
  let resultado = texto;

  // "***negrito+itálico***" (markdown) não existe no WhatsApp — colapsa pra
  // negrito simples antes de tratar o par duplo, senão sobra um asterisco solto.
  resultado = resultado.replace(/\*\*\*(.+?)\*\*\*/g, "*$1*");
  // "**negrito**" (markdown) -> "*negrito*" (WhatsApp).
  resultado = resultado.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // "__itálico__" (markdown) -> "_itálico_" (WhatsApp, já usa underscore simples).
  resultado = resultado.replace(/__(.+?)__/g, "_$1_");
  // Cabeçalhos Markdown ("# Título", "## Título") não têm equivalente — vira
  // texto simples, só removendo os "#" e o espaço que os segue.
  resultado = resultado.replace(/^#{1,6}\s+/gm, "");
  // O WhatsApp usa um único acento grave (`texto`) pra monoespaçado — o
  // cercado triplo do Markdown (```texto```) não é interpretado, então vira
  // texto cru com as cercas visíveis. Colapsa pro formato que o WhatsApp entende.
  resultado = resultado.replace(/```/g, "`");

  return resultado;
}
