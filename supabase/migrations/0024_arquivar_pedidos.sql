-- Tarefa 0066 — arquivamento de pedidos entregues/cancelados no board
-- operacional unificado, sem afetar pedidos.status (fonte de verdade
-- própria, consumida por outras rotas isoladamente).

alter table pedidos add column if not exists arquivado_em timestamptz;
