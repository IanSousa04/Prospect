-- Fase 1 — schema mínimo do MVP
-- Rodar no SQL Editor do projeto Supabase (https://supabase.com/dashboard/project/_/sql/new)

create extension if not exists pgcrypto;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  empresa text,
  segmento text,
  localizacao text,
  origem text,
  score numeric,
  status text not null default 'novo'
    check (status in ('novo','qualificando','qualificado','em_contato','negociando','convertido','perdido')),
  responsavel text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists lead_sources (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  url text,
  tipo_fonte text not null,
  dados_brutos_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_lead_sources_lead_id on lead_sources(lead_id);

create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  tipo_evento text not null,
  descricao text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_lead_events_lead_id on lead_events(lead_id);

create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  agente_origem text not null
    check (agente_origem in ('prospecting','qualification','research','commercial','followup')),
  tipo_acao text not null,
  payload_json jsonb not null default '{}'::jsonb,
  justificativa text,
  resultado_esperado text,
  status text not null default 'pending'
    check (status in ('pending','approved','edited','reformulate_requested','rejected')),
  criado_em timestamptz not null default now(),
  decidido_em timestamptz
);
create index if not exists idx_pending_actions_lead_id on pending_actions(lead_id);
create index if not exists idx_pending_actions_status on pending_actions(status);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  canal text not null default 'whatsapp' check (canal in ('whatsapp','outro')),
  remetente text not null check (remetente in ('lead','agente','usuario')),
  conteudo text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_messages_lead_id on messages(lead_id);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agente text not null
    check (agente in ('prospecting','qualification','research','commercial','followup')),
  lead_id uuid references leads(id) on delete set null,
  status text not null default 'running' check (status in ('running','success','error')),
  input_json jsonb,
  output_json jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  finalizado_em timestamptz
);
create index if not exists idx_agent_runs_lead_id on agent_runs(lead_id);

-- Trigger para manter leads.atualizado_em em dia
create or replace function set_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leads_atualizado_em on leads;
create trigger trg_leads_atualizado_em
  before update on leads
  for each row execute function set_atualizado_em();

-- RLS: habilitado, sem policies — o backend usa a service_role key (que
-- ignora RLS), então nada acessa estas tabelas diretamente pelo anon key.
alter table leads enable row level security;
alter table lead_sources enable row level security;
alter table lead_events enable row level security;
alter table pending_actions enable row level security;
alter table messages enable row level security;
alter table agent_runs enable row level security;
