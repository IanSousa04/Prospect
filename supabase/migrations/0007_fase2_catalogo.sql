-- Fase 2 — Catálogo Inteligente (ver docs/product/04-catalogo.md e
-- docs/product/08-roadmap.md §8.1).
--
-- Modelagem segue o padrão validado em docs/architecture/referencias-mercado.md
-- §2 (iFood/Rappi): combo e modificador não são entidades à parte — são
-- produto e grupos_opcoes/opcoes reaproveitados. Isso cobre adicionais,
-- molhos, acompanhamentos, escolhas obrigatórias e combos com uma única
-- estrutura relacional, em vez de uma tabela por categoria do documento de
-- produto (que descreve o conceito de negócio, não o schema físico).
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0006_realtime.sql.

-- =========================================================================
-- CATEGORIAS
-- =========================================================================
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  status text not null default 'ativo' check (status in ('ativo', 'arquivado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_categorias_empresa_id on categorias(empresa_id);

drop trigger if exists trg_categorias_atualizado_em on categorias;
create trigger trg_categorias_atualizado_em
  before update on categorias
  for each row execute function set_atualizado_em();

-- =========================================================================
-- PRODUTOS
-- tipo='combo' é só um produto cujos grupos_opcoes referenciam outros
-- produtos (via opcoes.produto_referenciado_id) — ver docs/product/04-catalogo.md §4.5.
-- =========================================================================
create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  categoria_id uuid references categorias(id) on delete set null,
  tipo text not null default 'produto' check (tipo in ('produto', 'combo')),

  nome text not null,
  nome_curto text,
  descricao text,
  descricao_comercial text,
  imagem_url text,
  tags text[] not null default '{}',
  status text not null default 'ativo' check (status in ('ativo', 'rascunho', 'arquivado')),

  preco numeric(10, 2) not null,
  preco_promocional numeric(10, 2),
  disponivel boolean not null default true,
  horario_inicio time,
  horario_fim time,
  quantidade_minima int not null default 1,
  quantidade_maxima int,

  restricoes text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint chk_preco_promocional_menor check (preco_promocional is null or preco_promocional < preco),
  constraint chk_quantidade_maxima check (quantidade_maxima is null or quantidade_maxima >= quantidade_minima)
);
create index if not exists idx_produtos_empresa_id on produtos(empresa_id);
create index if not exists idx_produtos_categoria_id on produtos(categoria_id);
create index if not exists idx_produtos_status on produtos(status);

drop trigger if exists trg_produtos_atualizado_em on produtos;
create trigger trg_produtos_atualizado_em
  before update on produtos
  for each row execute function set_atualizado_em();

-- =========================================================================
-- INGREDIENTES — composição/alérgenos exibidos ao cliente (ver §4.2).
-- Não é o mesmo conceito de "opção" (que é escolha do cliente); ingrediente
-- aqui é informação, não personalização.
-- =========================================================================
create table if not exists ingredientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  nome text not null,
  alergeno boolean not null default false,
  ordem int not null default 0
);
create index if not exists idx_ingredientes_produto_id on ingredientes(produto_id);

-- =========================================================================
-- GRUPOS DE OPÇÕES — modificadores, adicionais, molhos, acompanhamentos e
-- as escolhas de um combo são todos grupos_opcoes de algum tipo (ver §4.3/§4.4).
-- =========================================================================
create table if not exists grupos_opcoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,

  nome text not null,
  tipo text not null check (tipo in ('adicionar', 'remover', 'substituir', 'escolher')),
  obrigatorio boolean not null default false,
  minimo int not null default 0,
  maximo int not null default 1,
  ordem int not null default 0,

  constraint chk_grupo_min_max check (maximo >= minimo),
  constraint chk_grupo_obrigatorio_min check (not obrigatorio or minimo >= 1)
);
create index if not exists idx_grupos_opcoes_produto_id on grupos_opcoes(produto_id);

-- =========================================================================
-- OPÇÕES — item dentro de um grupo. Quando o grupo é a escolha de um combo
-- (tipo='escolher' apontando pra um produto real), produto_referenciado_id
-- resolve pra outro produto; caso contrário é só um nome + preço adicional
-- (ex.: "Bacon +R$5,00").
-- =========================================================================
create table if not exists opcoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  grupo_opcoes_id uuid not null references grupos_opcoes(id) on delete cascade,

  nome text not null,
  preco_adicional numeric(10, 2) not null default 0,
  produto_referenciado_id uuid references produtos(id) on delete set null,
  disponivel boolean not null default true,
  ordem int not null default 0
);
create index if not exists idx_opcoes_grupo_opcoes_id on opcoes(grupo_opcoes_id);

-- =========================================================================
-- RECOMENDAÇÕES — relações comerciais entre produtos (ver §4.6).
-- =========================================================================
create table if not exists produto_relacionados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  relacionado_id uuid not null references produtos(id) on delete cascade,
  tipo text not null check (tipo in ('combina_com', 'frequentemente_comprado_com', 'alternativa', 'similar')),

  constraint chk_produto_relacionado_diferente check (produto_id <> relacionado_id),
  unique (produto_id, relacionado_id, tipo)
);
create index if not exists idx_produto_relacionados_produto_id on produto_relacionados(produto_id);

-- =========================================================================
-- RLS — mesmo padrão da Fase 1 (ver 0005_fase1_atendimento.sql).
-- =========================================================================
alter table categorias enable row level security;
alter table produtos enable row level security;
alter table ingredientes enable row level security;
alter table grupos_opcoes enable row level security;
alter table opcoes enable row level security;
alter table produto_relacionados enable row level security;

create policy categorias_isolamento on categorias for all using (empresa_id = auth_empresa_id());
create policy produtos_isolamento on produtos for all using (empresa_id = auth_empresa_id());
create policy ingredientes_isolamento on ingredientes for all using (empresa_id = auth_empresa_id());
create policy grupos_opcoes_isolamento on grupos_opcoes for all using (empresa_id = auth_empresa_id());
create policy opcoes_isolamento on opcoes for all using (empresa_id = auth_empresa_id());
create policy produto_relacionados_isolamento on produto_relacionados for all using (empresa_id = auth_empresa_id());

alter publication supabase_realtime add table produtos;
