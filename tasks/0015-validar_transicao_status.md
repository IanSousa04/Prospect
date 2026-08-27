# `POST /atendimentos/:id/status` não valida transição nenhuma

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

Diferente de `pedidos.ts`, que tem `TRANSICOES: Record<StatusPedido, StatusPedido[]>` (`apps/api/src/routes/pedidos.ts`) impedindo, por exemplo, voltar um pedido `entregue` pra `aberto`. Em atendimentos, hoje dá pra pular de qualquer status pra qualquer status via essa rota — vale considerar o mesmo padrão de transições permitidas, especialmente antes de implementar "finalizar"/"devolver pra IA" de verdade.
