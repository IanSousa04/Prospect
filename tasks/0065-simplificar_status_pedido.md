# Simplificar `StatusPedido` (aberto/confirmado/em_preparo → `em_preparacao`; pronto/saiu_para_entrega → `pronto`)

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)
**Depende de:** nada — pode ser feita isoladamente, mas é pré-requisito de [0066](0066-estagio_operacional_unificado.md)/[0067](0067-kanban_unificado.md)

Parte do refactor de status pedido pelo usuário (item 2 do pedido original): o board unificado só tem 3 estágios de pedido (Em preparação, Pronto, Entregue) — hoje `pedidos.status` tem 6 (`aberto`, `confirmado`, `em_preparo`, `pronto`, `saiu_para_entrega`, `entregue`, `cancelado`, `supabase/migrations/0008_fase3_pedidos.sql:26`). Decisão de mapeamento (a confirmar com o usuário antes de implementar, mas proposta inicial coerente com o board aprovado):

- `aberto` + `confirmado` + `em_preparo` → um só, `em_preparacao` (o cliente/atendente não precisa de 3 estados pra "ainda não ficou pronto").
- `pronto` + `saiu_para_entrega` → um só, `pronto` (tanto "pronto pra retirada" quanto "saiu pra entrega" significam, do ponto de vista operacional do board, "não precisa mais de ação na cozinha").
- `entregue` e `cancelado` continuam existindo sem mudança.

## Escopo

- Migration: `UPDATE pedidos SET status = 'em_preparacao' WHERE status IN ('aberto','confirmado','em_preparo')`, `UPDATE pedidos SET status = 'pronto' WHERE status = 'saiu_para_entrega'`, ANTES de reescrever o check constraint com os 4 valores finais (`em_preparacao`, `pronto`, `entregue`, `cancelado`).
- `packages/shared/src/pedidos.ts` — `StatusPedido` reduzido pros 4 valores.
- `apps/api/src/routes/pedidos.ts` — `STATUS_VALIDOS`/`TRANSICOES` reescritos: `em_preparacao → [pronto, cancelado]`, `pronto → [entregue, cancelado]`, `entregue → []`, `cancelado → []`.
- `apps/web/src/pages/Atendimento.tsx` — `TRANSICOES_PEDIDO`, `STATUS_PEDIDO_LABEL` (linhas ~25-44) atualizados.
- `apps/web/src/components/PedidoBuilder.tsx` — não seleciona status diretamente (sempre cria em `aberto`), então só precisa que o valor inicial passe a ser `em_preparacao`.
- Conferir `apps/web/src/lib/api.ts` (tipos `StatusPedido` importados) e qualquer filtro/label duplicado.

**Ponto em aberto pra confirmar com o usuário antes de implementar:** essa fusão perde a distinção operacional entre "aberto" (pedido acabou de entrar, ninguém confirmou ainda) e "em_preparo" (já está sendo feito) — hoje isso é uma transição manual real no painel (`STATUS_PEDIDO_EDITAVEIS`). Se a cozinha precisar saber "esse pedido ainda não foi nem aceito" separado de "já está sendo preparado", talvez `aberto` mereça ficar de fora dessa fusão. Confirmar antes de implementar.
