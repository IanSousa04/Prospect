# Finalizar atendimento

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

Não existe hoje nenhum botão/ação dedicada pra encerrar um atendimento. A rota `POST /atendimentos/:id/status` (`apps/api/src/routes/atendimentos.ts:105-134`) já aceita `status: 'resolvido'` tecnicamente (não valida transição nenhuma, ao contrário de `pedidos.ts` que tem um mapa `TRANSICOES` — ver tarefa de validação de transição), mas não há UI (`apps/web/src/pages/Atendimento.tsx`) nem confirmação, nem verificação de que não existe handoff aberto antes de encerrar.

**Resolução:** botão "Finalizar atendimento" em `apps/web/src/pages/Atendimento.tsx` com confirmação via `window.confirm`, chamando `POST /atendimentos/:id/status` com `resolvido`. A rota agora usa o mapa `TRANSICOES` (ver tarefa 0015) e bloqueia a finalização com erro `handoff_pendente_impede_finalizar` se houver handoff `aberto`/`assumido` — decisão: bloquear em vez de auto-resolver o handoff (diferente de "devolver pra IA"), porque encerrar é uma ação final e um handoff pendente significa que um humano pode estar esperando decisão.
