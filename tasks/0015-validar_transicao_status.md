# `POST /atendimentos/:id/status` não valida transição nenhuma

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

Diferente de `pedidos.ts`, que tem `TRANSICOES: Record<StatusPedido, StatusPedido[]>` (`apps/api/src/routes/pedidos.ts`) impedindo, por exemplo, voltar um pedido `entregue` pra `aberto`. Em atendimentos, hoje dá pra pular de qualquer status pra qualquer status via essa rota — vale considerar o mesmo padrão de transições permitidas, especialmente antes de implementar "finalizar"/"devolver pra IA" de verdade.

**Resolução:** mapa `TRANSICOES: Record<StatusAtendimento, StatusAtendimento[]>` adicionado em `apps/api/src/routes/atendimentos.ts`, seguindo o mesmo padrão de `pedidos.ts`. `resolvido` não permite nenhuma transição de saída; os demais estados podem ir para `humano_atendendo`, entre si, ou `resolvido`. `POST /atendimentos/:id/status` agora busca o status atual e rejeita com `transicao_de_status_nao_permitida` (400) quando a transição não está no mapa.
