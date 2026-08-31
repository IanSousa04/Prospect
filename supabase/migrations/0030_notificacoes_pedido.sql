-- Notificação de progresso do pedido pro cliente (mensagens de status do
-- Kanban). Quando o humano move o card pra "Na cozinha" (`em_preparacao`) ou
-- "Pronto" (`pronto`), a API enfileira uma notificação nesta tabela e o
-- whatsapp-worker envia via WhatsApp — SEM nunca gravar em `mensagens`.
--
-- Decisão explícita, mesmo motivo de `verificacoes_telefone` (0026):
-- `mensagens` é o histórico da conversa que a IA lê a cada turno e que o
-- painel exibe. Uma notificação automática de status ali poluiria o
-- histórico de conversa com texto que o atendente não escreveu, e o cliente
-- veria "system" como se fosse um humano. Fila própria = envio direto pelo
-- worker, fora de `mensagens`.
--
-- Vale a regra 7 do CLAUDE.md: `enviado_em` só é gravado depois de
-- confirmação real da API do WhatsApp, nunca antes. Uma falha fica em
-- `erro_envio` e `tentativas_envio` (teto no worker, anti-loop).

-- =========================================================================
-- NOTIFICACOES_PEDIDO — fila de envio de notificação de status do pedido.
-- =========================================================================
create table if not exists notificacoes_pedido (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,

  -- Status que originou a notificação — é o que permite, no futuro, filtrar
  -- reenvios por tipo sem ter que reler o pedido.
  tipo text not null check (tipo in ('em_preparacao', 'pronto')),

  -- Texto final a enviar, resolvido na API no momento do enfileiramento
  -- (inclusive a variação por tipo_entrega em `pronto`). O worker não decide
  -- conteúdo — só envia.
  conteudo text not null,

  tentativas_envio integer not null default 0,
  enviado_em timestamptz,
  erro_envio text,

  criado_em timestamptz not null default now()
);
-- Fila do worker: só o que ainda não foi enviado, por empresa.
create index if not exists idx_notificacoes_pedido_pendentes
  on notificacoes_pedido(empresa_id, criado_em)
  where enviado_em is null;

-- RLS ligada e SEM policy nenhuma, de propósito: nada além do service_role
-- (apps/api e whatsapp-worker) lê ou escreve nesta tabela. É uma fila
-- interna de operação, não dado de painel.
alter table notificacoes_pedido enable row level security;
