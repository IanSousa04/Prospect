-- Remove o schema do MVP anterior (prospecção outbound).
-- O projeto pivotou para a Plataforma de Atendimento e Vendas com IA para
-- Food Service (ver docs/product/). Nenhuma das tabelas abaixo é reaproveitada
-- pelo novo domínio — o schema novo será criado em migrations subsequentes.
-- Rodar no SQL Editor do projeto Supabase.

drop trigger if exists trg_leads_atualizado_em on leads;
drop function if exists set_atualizado_em();

drop table if exists prospecting_runs cascade;
drop table if exists agent_runs cascade;
drop table if exists messages cascade;
drop table if exists pending_actions cascade;
drop table if exists lead_events cascade;
drop table if exists lead_sources cascade;
drop table if exists leads cascade;
