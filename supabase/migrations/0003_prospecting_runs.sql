-- Fase 9 — prospecção assíncrona com pipeline paralelo por lead.
-- Rodar no SQL Editor do projeto Supabase.

create table if not exists prospecting_runs (
  id uuid primary key default gen_random_uuid(),
  criteria_json jsonb not null,
  status text not null default 'running' check (status in ('running','success','error')),
  leads_encontrados int not null default 0,
  leads_criados int not null default 0,
  leads_duplicados int not null default 0,
  erro text,
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz
);
alter table prospecting_runs enable row level security;

alter table leads add column if not exists enrichment_status jsonb not null default '{}'::jsonb;
alter table leads add column if not exists prospecting_run_id uuid references prospecting_runs(id) on delete set null;
alter table leads add column if not exists cnpj text;

create index if not exists idx_leads_prospecting_run_id on leads(prospecting_run_id);
