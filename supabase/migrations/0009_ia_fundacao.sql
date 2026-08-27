-- Fase 5 (Fundação) — Camada de IA: sessão de conversa, auditoria de tools e
-- decisões, e busca textual em conhecimento_itens.
-- Ver docs/product/05-ia-conhecimento.md e o plano de implementação da
-- camada de IA (Investigador/Atendente, inspirado no Eddy — ver
-- docs/product/01-visao-e-principios.md §1.5).
--
-- Esta migration NÃO cria nenhuma ferramenta de escrita nem tabela de
-- gabarito ainda (isso é passo posterior do MVP 1) — só a fundação de
-- memória/auditoria/busca que todo o resto depende.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0008_fase3_pedidos.sql.

-- =========================================================================
-- BUSCA TEXTUAL EM CONHECIMENTO_ITENS
-- Decisão consciente (ver plano): sem embeddings/pgvector nesta fase — o
-- volume por empresa é pequeno, tsvector nativo do Postgres resolve.
-- =========================================================================
alter table conhecimento_itens
  add column if not exists conteudo_busca tsvector
    generated always as (
      to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(conteudo, ''))
    ) stored;

create index if not exists idx_conhecimento_busca on conhecimento_itens using gin(conteudo_busca);

-- =========================================================================
-- IA_SESSOES — memória curta de conversa (1 sessão ativa por atendimento).
-- Histórico bruto de mensagens continua vindo de `mensagens` — isto só
-- guarda estado derivado que não dá pra recalcular barato a cada turno
-- (carrinho em construção, confirmação pendente com hash+expiração).
-- =========================================================================
create table if not exists ia_sessoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  estado_json jsonb not null default '{}'::jsonb,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (atendimento_id)
);
create index if not exists idx_ia_sessoes_empresa_id on ia_sessoes(empresa_id);

drop trigger if exists trg_ia_sessoes_atualizado_em on ia_sessoes;
create trigger trg_ia_sessoes_atualizado_em
  before update on ia_sessoes
  for each row execute function set_atualizado_em();

-- =========================================================================
-- IA_EXECUCOES — log append-only de cada chamada de ferramenta (fase
-- investigacao/decisao/execucao/validacao). Fundação da auditoria "por que
-- a IA disse esse preço" / "por que executou essa ação".
-- =========================================================================
create table if not exists ia_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  mensagem_id uuid references mensagens(id) on delete set null,
  fase text not null check (fase in ('investigacao', 'decisao', 'execucao', 'validacao')),
  tool_nome text,
  tool_input_json jsonb,
  tool_output_json jsonb,
  sucesso boolean,
  erro text,
  duracao_ms integer,
  criado_em timestamptz not null default now()
);
create index if not exists idx_ia_execucoes_empresa_id on ia_execucoes(empresa_id);
create index if not exists idx_ia_execucoes_atendimento_id on ia_execucoes(atendimento_id);

-- =========================================================================
-- IA_DECISOES — uma linha por decisão final do orquestrador (confiança,
-- risco, cobertura, ação decidida). Nunca editável — auditoria real.
-- =========================================================================
create table if not exists ia_decisoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  mensagem_id uuid references mensagens(id) on delete set null,
  confianca text not null check (confianca in ('alta', 'media', 'baixa')),
  risco text not null check (risco in ('baixo', 'medio', 'alto')),
  cobertura_ferramentas integer not null default 0,
  acao_decidida text not null check (acao_decidida in ('responder', 'executar_acao', 'pedir_esclarecimento', 'handoff')),
  tool_executada text,
  justificativa_estruturada_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_ia_decisoes_empresa_id on ia_decisoes(empresa_id);
create index if not exists idx_ia_decisoes_atendimento_id on ia_decisoes(atendimento_id);

-- =========================================================================
-- RLS — mesmo padrão das fases anteriores. ia_execucoes/ia_decisoes são
-- append-only por design: nenhuma policy de update/delete é criada para
-- nenhuma role de aplicação (nem "for all" nelas) — só insert/select.
-- =========================================================================
alter table ia_sessoes enable row level security;
alter table ia_execucoes enable row level security;
alter table ia_decisoes enable row level security;

create policy ia_sessoes_isolamento on ia_sessoes for all using (empresa_id = auth_empresa_id());

create policy ia_execucoes_select on ia_execucoes for select using (empresa_id = auth_empresa_id());
create policy ia_execucoes_insert on ia_execucoes for insert with check (empresa_id = auth_empresa_id());

create policy ia_decisoes_select on ia_decisoes for select using (empresa_id = auth_empresa_id());
create policy ia_decisoes_insert on ia_decisoes for insert with check (empresa_id = auth_empresa_id());

alter publication supabase_realtime add table ia_sessoes;
