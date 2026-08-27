-- Fase 4 — telefone do lead (para vincular ao WhatsApp) e controle de
-- execução das pending_actions (evita reenvio em caso de polling duplicado).
-- Rodar no SQL Editor do projeto Supabase.

alter table leads add column if not exists telefone text;

alter table pending_actions add column if not exists executado_em timestamptz;

create index if not exists idx_leads_telefone on leads(telefone);
