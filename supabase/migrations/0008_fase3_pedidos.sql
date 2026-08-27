-- Fase 3 — Pedidos (ver docs/product/08-roadmap.md §8.1).
--
-- Escopo desta migration: criação de pedido, itens, personalizações, status
-- e pagamento. "Integração com sistema externo" (ERP/delivery) fica de fora
-- — não há provedor real para integrar ainda; o schema não fecha a porta
-- (pedidos.origem existe para isso), mas nenhuma integração é fabricada.
--
-- Itens e opções gravam um SNAPSHOT do nome/preço do produto/opção no
-- momento da compra (nome_produto, preco_unitario, nome_opcao,
-- preco_adicional) — o pedido não pode mudar de valor silenciosamente se o
-- catálogo for editado depois (CLAUDE.md regra 1: nenhuma resposta/registro
-- comercial sem fonte rastreável, e aqui a fonte é o preço no instante da venda).
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0007_fase2_catalogo.sql.

-- =========================================================================
-- PEDIDOS
-- =========================================================================
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  atendimento_id uuid references atendimentos(id) on delete set null,

  status text not null default 'aberto'
    check (status in ('aberto', 'confirmado', 'em_preparo', 'pronto', 'saiu_para_entrega', 'entregue', 'cancelado')),
  origem text not null default 'painel' check (origem in ('painel', 'ia', 'integracao_externa')),

  tipo_entrega text not null default 'entrega' check (tipo_entrega in ('entrega', 'retirada')),
  endereco_json jsonb,
  taxa_entrega numeric(10, 2) not null default 0,

  forma_pagamento text check (forma_pagamento in ('dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'outro')),
  status_pagamento text not null default 'pendente' check (status_pagamento in ('pendente', 'pago', 'parcial', 'estornado')),

  subtotal numeric(10, 2) not null default 0,
  desconto numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,

  observacoes text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_pedidos_empresa_id on pedidos(empresa_id);
create index if not exists idx_pedidos_cliente_id on pedidos(cliente_id);
create index if not exists idx_pedidos_atendimento_id on pedidos(atendimento_id);
create index if not exists idx_pedidos_status on pedidos(status);

drop trigger if exists trg_pedidos_atualizado_em on pedidos;
create trigger trg_pedidos_atualizado_em
  before update on pedidos
  for each row execute function set_atualizado_em();

-- =========================================================================
-- ITENS DO PEDIDO
-- =========================================================================
create table if not exists itens_pedido (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  produto_id uuid references produtos(id) on delete set null,

  nome_produto text not null,
  quantidade int not null default 1 check (quantidade > 0),
  preco_unitario numeric(10, 2) not null,
  observacoes text,
  ordem int not null default 0
);
create index if not exists idx_itens_pedido_pedido_id on itens_pedido(pedido_id);

-- =========================================================================
-- PERSONALIZAÇÕES ESCOLHIDAS EM CADA ITEM
-- =========================================================================
create table if not exists itens_pedido_opcoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  item_pedido_id uuid not null references itens_pedido(id) on delete cascade,
  opcao_id uuid references opcoes(id) on delete set null,

  nome_opcao text not null,
  preco_adicional numeric(10, 2) not null default 0
);
create index if not exists idx_itens_pedido_opcoes_item_id on itens_pedido_opcoes(item_pedido_id);

-- =========================================================================
-- RLS — mesmo padrão das fases anteriores.
-- =========================================================================
alter table pedidos enable row level security;
alter table itens_pedido enable row level security;
alter table itens_pedido_opcoes enable row level security;

create policy pedidos_isolamento on pedidos for all using (empresa_id = auth_empresa_id());
create policy itens_pedido_isolamento on itens_pedido for all using (empresa_id = auth_empresa_id());
create policy itens_pedido_opcoes_isolamento on itens_pedido_opcoes for all using (empresa_id = auth_empresa_id());

alter publication supabase_realtime add table pedidos;
alter table pedidos replica identity full;
