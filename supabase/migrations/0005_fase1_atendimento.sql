-- Fase 1 — Atendimento IA (ver docs/product/08-roadmap.md §8.1)
-- Schema mínimo para: empresa (tenant), usuários do painel, clientes finais,
-- conversas/kanban de atendimento, mensagens, handoff e conhecimento base.
-- Catálogo, pedidos e versionamento pleno de conhecimento entram nas Fases 2-3.
--
-- Isolamento multi-tenant é reforçado em dois níveis (ver CLAUDE.md, regra 5):
--   1. Toda tabela de domínio carrega empresa_id (nunca inferido).
--   2. RLS habilitado com policy baseada em app_metadata.empresa_id do JWT,
--      para o dia em que o painel usar a anon key diretamente (ex.: realtime
--      no Kanban). O backend com service_role continua ignorando RLS.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0004_drop_legacy_prospecting_schema.sql.

create extension if not exists pgcrypto;

-- Função genérica de atualizado_em (substitui a versão específica de "leads" removida em 0004).
create or replace function set_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

-- Helper: empresa_id do usuário autenticado, lido do JWT (app_metadata.empresa_id).
-- Usado pelas policies de RLS abaixo. Retorna null para o service_role (que
-- ignora RLS de qualquer forma) e para JWTs sem essa claim.
create or replace function auth_empresa_id()
returns uuid as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'empresa_id', '')::uuid
$$ language sql stable;

-- =========================================================================
-- EMPRESAS (tenant)
-- =========================================================================
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  segmento text
    check (segmento in ('hamburgueria','pizzaria','acaiteria','restaurante','sushi','marmitaria','lanchonete','delivery','outro')),
  telefone_whatsapp text,
  status text not null default 'trial' check (status in ('trial','ativo','suspenso','cancelado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_empresas_atualizado_em on empresas;
create trigger trg_empresas_atualizado_em
  before update on empresas
  for each row execute function set_atualizado_em();

-- =========================================================================
-- USUÁRIOS (equipe da empresa com acesso ao painel)
-- =========================================================================
create table if not exists usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  email text not null,
  papel text not null default 'atendente' check (papel in ('owner','admin','atendente')),
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_usuarios_empresa_id on usuarios(empresa_id);

drop trigger if exists trg_usuarios_atualizado_em on usuarios;
create trigger trg_usuarios_atualizado_em
  before update on usuarios
  for each row execute function set_atualizado_em();

-- =========================================================================
-- CLIENTES (usuário final, identificado pelo WhatsApp)
-- =========================================================================
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text,
  telefone text not null,
  whatsapp_id text,
  primeiro_contato_em timestamptz not null default now(),
  ultima_interacao_em timestamptz not null default now(),
  tags text[] not null default '{}',
  preferencias_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, telefone)
);
create index if not exists idx_clientes_empresa_id on clientes(empresa_id);
create index if not exists idx_clientes_telefone on clientes(telefone);

drop trigger if exists trg_clientes_atualizado_em on clientes;
create trigger trg_clientes_atualizado_em
  before update on clientes
  for each row execute function set_atualizado_em();

-- =========================================================================
-- CONHECIMENTO (base mínima — versionamento pleno e ingestão vêm depois,
-- ver docs/product/05-ia-conhecimento.md §5.2-5.3)
-- =========================================================================
create table if not exists conhecimento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  categoria text not null
    check (categoria in ('faq','politica','procedimento','entrega','pagamento','cancelamento','promocao','horario','regiao','outro')),
  titulo text not null,
  conteudo text not null,
  status text not null default 'ativo' check (status in ('ativo','rascunho','arquivado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_conhecimento_itens_empresa_id on conhecimento_itens(empresa_id);
create index if not exists idx_conhecimento_itens_categoria on conhecimento_itens(categoria);

drop trigger if exists trg_conhecimento_itens_atualizado_em on conhecimento_itens;
create trigger trg_conhecimento_itens_atualizado_em
  before update on conhecimento_itens
  for each row execute function set_atualizado_em();

-- =========================================================================
-- CONFIGURAÇÃO DA IA (1:1 por empresa — ver docs/product/05-ia-conhecimento.md §5.4/5.7)
-- =========================================================================
create table if not exists ia_configuracoes (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  tom_de_voz text not null default 'amigavel' check (tom_de_voz in ('formal','neutro','amigavel','descontraido')),
  usa_emoji boolean not null default true,
  comportamento_json jsonb not null default '{}'::jsonb,
  permissoes_json jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_ia_configuracoes_atualizado_em on ia_configuracoes;
create trigger trg_ia_configuracoes_atualizado_em
  before update on ia_configuracoes
  for each row execute function set_atualizado_em();

-- =========================================================================
-- ATENDIMENTOS (card do Kanban — ver docs/product/03-atendimento-e-crm.md §3.2)
-- =========================================================================
create table if not exists atendimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  status text not null default 'ia_atendendo'
    check (status in ('ia_atendendo','ia_solicitou_humano','cliente_solicitou_humano','humano_atendendo','resolvido')),
  responsavel_usuario_id uuid references usuarios(id) on delete set null,
  intencao text,
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta')),
  ultima_mensagem_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_atendimentos_empresa_id on atendimentos(empresa_id);
create index if not exists idx_atendimentos_cliente_id on atendimentos(cliente_id);
create index if not exists idx_atendimentos_status on atendimentos(status);

drop trigger if exists trg_atendimentos_atualizado_em on atendimentos;
create trigger trg_atendimentos_atualizado_em
  before update on atendimentos
  for each row execute function set_atualizado_em();

-- =========================================================================
-- MENSAGENS
-- =========================================================================
create table if not exists mensagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  remetente text not null check (remetente in ('cliente','ia','humano')),
  conteudo text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_mensagens_empresa_id on mensagens(empresa_id);
create index if not exists idx_mensagens_atendimento_id on mensagens(atendimento_id);

-- =========================================================================
-- HANDOFFS (ver docs/product/03-atendimento-e-crm.md §3.4)
-- =========================================================================
create table if not exists handoffs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  origem text not null
    check (origem in ('cliente_solicitou','ia_solicitou','regra_operacional','falha_conhecimento','acao_sem_permissao','alto_risco')),
  motivo text not null,
  resumo text not null,
  acao_sugerida text,
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta')),
  status text not null default 'aberto' check (status in ('aberto','assumido','resolvido')),
  assumido_por_usuario_id uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists idx_handoffs_empresa_id on handoffs(empresa_id);
create index if not exists idx_handoffs_atendimento_id on handoffs(atendimento_id);
create index if not exists idx_handoffs_status on handoffs(status);

-- =========================================================================
-- RLS — isolamento por empresa (ver CLAUDE.md, regra 5)
-- service_role ignora RLS por padrão; as policies abaixo cobrem o cenário em
-- que o painel usa a anon/authenticated key diretamente (ex.: realtime).
-- =========================================================================
alter table empresas enable row level security;
alter table usuarios enable row level security;
alter table clientes enable row level security;
alter table conhecimento_itens enable row level security;
alter table ia_configuracoes enable row level security;
alter table atendimentos enable row level security;
alter table mensagens enable row level security;
alter table handoffs enable row level security;

create policy empresas_isolamento on empresas
  for all using (id = auth_empresa_id());

create policy usuarios_isolamento on usuarios
  for all using (empresa_id = auth_empresa_id());

create policy clientes_isolamento on clientes
  for all using (empresa_id = auth_empresa_id());

create policy conhecimento_itens_isolamento on conhecimento_itens
  for all using (empresa_id = auth_empresa_id());

create policy ia_configuracoes_isolamento on ia_configuracoes
  for all using (empresa_id = auth_empresa_id());

create policy atendimentos_isolamento on atendimentos
  for all using (empresa_id = auth_empresa_id());

create policy mensagens_isolamento on mensagens
  for all using (empresa_id = auth_empresa_id());

create policy handoffs_isolamento on handoffs
  for all using (empresa_id = auth_empresa_id());
