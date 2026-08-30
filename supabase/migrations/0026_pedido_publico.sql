-- Página pública de pedido (tarefa 0043) — canal de venda por link direto,
-- sem WhatsApp. Duas tabelas novas, ambas de autenticação do CLIENTE FINAL
-- (não do painel): o código de verificação enviado ao WhatsApp dele e a
-- sessão que esse código gera.
--
-- Decisão explícita: o código de verificação NUNCA entra em `mensagens`.
-- Aquela tabela é o histórico da conversa que a IA lê a cada turno — um
-- código de acesso ali seria dado de autenticação exposto ao modelo (e ao
-- lastro/prompt), sem nenhuma razão de negócio. O envio real fica com o
-- whatsapp-worker, que faz poll desta tabela do mesmo jeito que faz de
-- `mensagens` (mesmo rate limit natural, mesma regra 7 do CLAUDE.md: só
-- marca `enviado_em` depois de confirmação real da API).

-- =========================================================================
-- VERIFICACOES_TELEFONE — um código OTP por tentativa de login público.
-- =========================================================================
create table if not exists verificacoes_telefone (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,

  -- Mesmo formato de `clientes.telefone` (só dígitos, com DDI, ex.
  -- "5511999999999") — normalizado na API antes de chegar aqui, nunca o
  -- texto cru que o cliente digitou.
  telefone text not null,

  -- Só o hash do código, nunca o código em claro: quem tem acesso de leitura
  -- ao banco não deve conseguir se autenticar como um cliente. O worker
  -- precisa do código em claro pra enviar, então ele vive em
  -- `codigo_envio` até o envio acontecer e é apagado logo depois.
  codigo_hash text not null,
  codigo_envio text,

  tentativas integer not null default 0,
  expira_em timestamptz not null,
  verificado_em timestamptz,

  -- Preenchido pelo whatsapp-worker só depois de confirmação real da API do
  -- WhatsApp (CLAUDE.md regra 7 — nunca simular sucesso de envio).
  enviado_em timestamptz,
  erro_envio text,
  -- Quantas vezes o worker já TENTOU enviar. Existe porque uma falha da API
  -- do WhatsApp não prova que a mensagem não saiu (timeout depois do envio é
  -- um caso real) — sem um teto, um erro persistente viraria dezenas de
  -- mensagens no telefone de um cliente (CLAUDE.md regra 7: nunca enviar em
  -- loop).
  tentativas_envio integer not null default 0,

  criado_em timestamptz not null default now()
);
create index if not exists idx_verificacoes_telefone_lookup
  on verificacoes_telefone(empresa_id, telefone, criado_em desc);
-- Fila do worker: só o que ainda não foi enviado.
create index if not exists idx_verificacoes_telefone_pendentes
  on verificacoes_telefone(empresa_id, criado_em)
  where enviado_em is null;

-- =========================================================================
-- SESSOES_PUBLICAS — o que o código de verificação gera. Identifica um
-- CLIENTE (clientes.id), nunca um usuário do painel: estas sessões não têm
-- nenhum acesso ao painel, só às rotas /publico da API.
-- =========================================================================
create table if not exists sessoes_publicas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,

  -- Hash do token (o token em claro só existe no navegador do cliente),
  -- mesma razão de `codigo_hash` acima.
  token_hash text not null unique,

  expira_em timestamptz not null,
  ultimo_uso_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
create index if not exists idx_sessoes_publicas_cliente
  on sessoes_publicas(empresa_id, cliente_id);

-- RLS ligada e SEM policy nenhuma, de propósito: nada além do service_role
-- (apps/api) pode ler ou escrever nestas tabelas. Um usuário do painel não
-- tem motivo pra ver código de verificação de cliente, e o cliente final
-- nunca fala com o Supabase direto — só com /publico na API.
alter table verificacoes_telefone enable row level security;
alter table sessoes_publicas enable row level security;

-- =========================================================================
-- ORIGEM 'web_publico' — pedido que nasceu na página pública, feito pelo
-- próprio cliente. Precisa ser distinguível de 'painel' (atendente digitou)
-- e de 'ia' (a IA montou na conversa): quem olha o Kanban decide diferente
-- se sabe que ninguém falou com esse cliente ainda.
-- =========================================================================
alter table pedidos drop constraint if exists pedidos_origem_check;
alter table pedidos add constraint pedidos_origem_check
  check (origem in ('painel', 'ia', 'integracao_externa', 'web_publico'));
