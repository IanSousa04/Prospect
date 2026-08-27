# Formatação das respostas deve usar a sintaxe real do WhatsApp, não Markdown genérico

**Status:** concluído
**Prioridade:** P2 (seção 3, sem tag explícita no item original)
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Implementado com as duas primeiras camadas do caminho recomendado:

- `agent/atendente.ts` agora instrui explicitamente a sintaxe do WhatsApp no prompt (negrito `*x*`, itálico `_x_`, tachado `~x~`, sem cabeçalhos, listas com `-`/`•` em vez de numeração).
- `agent/sanitizacao.ts` (`sanitizarFormatacaoWhatsapp`, mesmo padrão de `contemValorNaoVerificado` em `verificacao.ts`) roda depois de `redigir()` em `agent/orquestrador.ts`, como rede de segurança determinística: converte `**x**`/`***x***` → `*x*`, `__x__` → `_x_`, remove cabeçalhos `#`/`##`/etc, e colapsa blocos ```` ```x``` ```` markdown pro monoespaçado real do WhatsApp (`` `x` ``).
- **Ainda não implementado (fora do escopo desta mudança)**: montar a lista de produtos/preços em código direto do resultado de `buscar_produtos` em vez de deixar o LLM redigir preço em prosa livre — continua recomendado para eliminar de vez risco de erro de dígito, mas exige tocar a estrutura de retorno da tool de catálogo, escopo maior que a formatação de texto corrigida aqui.
