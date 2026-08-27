# Tool `cancelar_pedido`

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [Tools de escrita restantes (0021)](0021-tools_escrita_restantes.md)
**Depende de:** `criar_pedido` validado em produção (0053-0055), [Risco real na matriz de decisão (0023)](0023-risco_matriz_decisao.md)

Sem executor registrado hoje, só existe como nome no enum `NOMES_FERRAMENTAS`. Ação irreversível com impacto financeiro/operacional real (mesma categoria de risco de `confirm_order`, ver 0055) — exige confiança alta + baixo risco + permissão explícita (CLAUDE.md regra 6), nunca só a IA decidindo cancelar porque "pareceu" que o cliente desistiu. Reaproveitar a transição `-> cancelado` já validada em `TRANSICOES` (`apps/api/src/routes/pedidos.ts`) — a tool não pode pular essa validação. Depende de 0023 estar em produção pra ter risco real avaliado antes de habilitar esta tool (hoje `agent/decisao.ts` sempre assume risco "baixo").
