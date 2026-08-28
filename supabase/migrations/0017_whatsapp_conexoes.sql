-- Status de conexão do WhatsApp por empresa (aba WhatsApp no painel) — o
-- whatsapp-worker (1 processo por empresa, ver tasks/0024 e tasks/0027)
-- publica aqui o que observa de verdade nos eventos do whatsapp-web.js
-- (qr/ready/disconnected), e o painel escreve um "comando" que o worker
-- consome via polling — mesmo padrão de comunicação assíncrona via tabela já
-- usado em numeros_whitelist (0011).
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0016_definir_forma_pagamento.sql.

create table if not exists whatsapp_conexoes (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  status text not null default 'desconectado' check (status in ('desconectado', 'aguardando_qr', 'conectado')),
  qr_code text,
  numero_conectado text,
  comando text check (comando in ('desconectar', 'reconectar')),
  atualizado_em timestamptz not null default now()
);

alter table whatsapp_conexoes enable row level security;
create policy whatsapp_conexoes_isolamento on whatsapp_conexoes for all using (empresa_id = auth_empresa_id());

alter publication supabase_realtime add table whatsapp_conexoes;
