# Finalizar atendimento

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

Não existe hoje nenhum botão/ação dedicada pra encerrar um atendimento. A rota `POST /atendimentos/:id/status` (`apps/api/src/routes/atendimentos.ts:105-134`) já aceita `status: 'resolvido'` tecnicamente (não valida transição nenhuma, ao contrário de `pedidos.ts` que tem um mapa `TRANSICOES` — ver tarefa de validação de transição), mas não há UI (`apps/web/src/pages/Atendimento.tsx`) nem confirmação, nem verificação de que não existe handoff aberto antes de encerrar.
