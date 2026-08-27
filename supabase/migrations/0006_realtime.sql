-- Fase 1 — habilita Realtime nas tabelas que alimentam o Kanban ao vivo
-- (ver docs/product/03-atendimento-e-crm.md §3.2, "acompanhar em tempo real").
-- Sem isso, o painel só atualiza via polling/refresh manual.
--
-- Todo projeto Supabase já vem com a publication `supabase_realtime` criada
-- vazia; aqui só adicionamos as tabelas de domínio que o painel precisa
-- assinar. RLS (0005) continua sendo o que decide o que cada conexão
-- realmente recebe — Realtime nunca contorna isolamento multi-tenant.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0005_fase1_atendimento.sql.

alter publication supabase_realtime add table atendimentos;
alter publication supabase_realtime add table mensagens;
alter publication supabase_realtime add table handoffs;

-- replica identity full: garante que o payload de UPDATE/DELETE do realtime
-- traga os valores antigos das colunas (necessário pra o Kanban saber de
-- qual coluna/status um card saiu, não só pra onde foi).
alter table atendimentos replica identity full;
alter table handoffs replica identity full;
