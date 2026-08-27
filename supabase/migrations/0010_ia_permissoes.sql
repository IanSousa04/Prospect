-- Fase 5 — permissões da IA como tabela própria (uma linha por
-- empresa+ferramenta), substituindo ia_configuracoes.permissoes_json.
-- Motivo: jsonb solto não dá pra gerenciar numa UI de verdade (sem
-- validação por linha, sem granularidade de RLS, sem histórico). A lista de
-- ferramentas continua sendo a fonte de verdade em código
-- (packages/shared/src/ia-config.ts, NOMES_FERRAMENTAS) — o check constraint
-- abaixo espelha exatamente essa lista.
--
-- Regra inviolável (CLAUDE.md #2) continua garantida: ausência de linha
-- para uma ferramenta = negado (nunca existe default "permitido" implícito
-- — toda linha nova começa com permitido=false).
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0009_ia_fundacao.sql.

create table if not exists ia_permissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  ferramenta text not null check (ferramenta in (
    'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
    'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
    'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
    'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
    'buscar_conhecimento'
  )),
  permitido boolean not null default false,
  exige_confirmacao_humana boolean,
  valor_maximo_sem_handoff numeric(10, 2),
  condicoes_json jsonb,
  campos_permitidos text[],
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, ferramenta)
);
create index if not exists idx_ia_permissoes_empresa_id on ia_permissoes(empresa_id);

drop trigger if exists trg_ia_permissoes_atualizado_em on ia_permissoes;
create trigger trg_ia_permissoes_atualizado_em
  before update on ia_permissoes
  for each row execute function set_atualizado_em();

alter table ia_permissoes enable row level security;
create policy ia_permissoes_isolamento on ia_permissoes for all using (empresa_id = auth_empresa_id());

alter publication supabase_realtime add table ia_permissoes;

-- permissoes_json fica obsoleto — a tabela acima é a única fonte de verdade
-- a partir de agora.
alter table ia_configuracoes drop column if exists permissoes_json;
