-- Modo teste com whitelist de números — ver docs/ROADMAP.md §3 "Modo teste
-- com whitelist de números". Enquanto `ia_configuracoes.modo_teste` estiver
-- ligado para uma empresa, o whatsapp-worker ignora por completo (nem
-- cliente, nem atendimento, nem mensagem) qualquer telefone que não esteja
-- em `numeros_whitelist` com `ativo = true` para aquela empresa.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0010_ia_permissoes.sql.

alter table ia_configuracoes
  add column if not exists modo_teste boolean not null default false;

create table if not exists numeros_whitelist (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  telefone text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, telefone)
);
create index if not exists idx_numeros_whitelist_empresa_id on numeros_whitelist(empresa_id);

alter table numeros_whitelist enable row level security;
create policy numeros_whitelist_isolamento on numeros_whitelist for all using (empresa_id = auth_empresa_id());

alter publication supabase_realtime add table numeros_whitelist;
