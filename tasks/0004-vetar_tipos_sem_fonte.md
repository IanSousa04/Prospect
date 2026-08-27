# Vetar tipos sem fonte real + não passar afirmação não-verificada ao Atendente

**Status:** concluído
**Prioridade:** P0
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

`TIPOS_COMERCIAIS` (`agent/types.ts`) agora inclui `politica`. `orquestrador.ts` filtra `relatorio.afirmacoes` (mantém só `fonte_tool_execucao_id !== null`) antes de montar os fatos do Atendente — fecha a lacuna pra **qualquer** tipo, incluindo `generico`, não só os comerciais. As afirmações sintéticas de resultado vazio (ponto acima) sempre têm fonte real, continuam passando normalmente.
