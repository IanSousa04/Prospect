-- Motor de etapas configurável do pedido (tasks/0056/0077/0078) — hoje toda
-- empresa é forçada a oferecer entrega E retirada, e a sempre perguntar
-- forma de pagamento, mesmo quando isso não faz sentido pro negócio dela
-- (ex.: hamburgueria que só faz delivery, ou que não quer negociar forma de
-- pagamento pelo WhatsApp). Uma coluna jsonb, mesmo padrão de
-- `comportamento_json` (estrutura com array + boolean, não um enum simples
-- como `prazo_entrega_modo`).
--
-- Default reproduz o comportamento anterior a esta migration (permissivo,
-- ambos os tipos de entrega, todas as formas de pagamento, sempre pergunta)
-- — nenhuma empresa em produção muda de comportamento sem ação explícita.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0018_prazo_entrega.sql.

alter table ia_configuracoes
  add column if not exists fluxo_pedido_json jsonb not null default '{
    "tipos_entrega_oferecidos": ["entrega", "retirada"],
    "perguntar_forma_pagamento": true,
    "formas_pagamento_aceitas": ["dinheiro", "cartao_credito", "cartao_debito", "pix", "outro"]
  }'::jsonb;
