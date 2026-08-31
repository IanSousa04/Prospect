-- Refatoração de arquitetura: o link público vira o núcleo do pedido e a IA
-- deixa de ter qualquer ferramenta de escrita (criar/cancelar/alterar pedido,
-- montar carrinho, definir entrega/endereço/pagamento). A IA passa a ser uma
-- camada de assistência pura: responder perguntas, mandar cardápio por
-- categoria e dar prazo de entrega.
--
-- Três mudanças:
--
-- 1. `ia_permissoes.ferramenta`: a lista de ferramentas válidas perde todas as
--    de escrita e ganha as duas novas de leitura de cardápio por categoria
--    (`listar_categorias`, `listar_produtos_por_categoria`). Linhas existentes
--    das ferramentas removidas são apagadas ANTES de reescrever o constraint.
--
-- 2. `ia_configuracoes.prazo_*`: o prazo deixa de ser um texto livre
--    (`prazo_entrega_texto`) ou um cálculo de fila (`prazo_entrega_modo`) e
--    vira um RANGE fixo e configurável, default 60-90 minutos. É a ÚNICA fonte
--    de verdade do prazo — consumida tanto pela IA (`consultar_prazo_entrega`)
--    quanto pela página pública (GET /publico/:slug).
--
-- 3. `ia_invariantes.evento`: os eventos que só faziam sentido no checkout
--    determinístico (confirmação/estado transacional) saem do constraint.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0027_publico_config.sql.

-- 1. Limpar permissões de ferramentas que deixam de existir.
delete from ia_permissoes
where ferramenta in (
  'atualizar_cliente',
  'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho',
  'definir_tipo_entrega', 'definir_endereco_entrega', 'definir_forma_pagamento'
);

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'listar_categorias', 'listar_produtos_por_categoria',
  'consultar_cliente', 'consultar_historico',
  'consultar_pedido', 'consultar_status',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento', 'consultar_prazo_entrega', 'consultar_opcoes_atendimento'
));

-- 2. Prazo de entrega: range fixo configurável (fonte de verdade única).
alter table ia_configuracoes
  drop column if exists prazo_entrega_modo,
  drop column if exists prazo_entrega_texto,
  add column if not exists prazo_entrega_min_minutos int not null default 60 check (prazo_entrega_min_minutos > 0),
  add column if not exists prazo_entrega_max_minutos int not null default 90 check (prazo_entrega_max_minutos >= prazo_entrega_min_minutos);

-- 3. Invariantes: removem-se os eventos exclusivos do checkout determinístico.
-- Linhas já gravadas com os eventos antigos violariam o novo constraint, então
-- são apagadas ANTES de reescrevê-lo (são log de detector de bug de um fluxo
-- que deixou de existir — não há valor em preservá-las).
delete from ia_invariantes
where evento in (
  'confirmation_without_order',
  'order_without_confirmation',
  'handoff_without_order',
  'state_mutation_without_tool',
  'tool_expected_but_not_called',
  'tool_success_without_state_change',
  'transactional_claim_without_evidence'
);

alter table ia_invariantes drop constraint if exists ia_invariantes_evento_check;

alter table ia_invariantes add constraint ia_invariantes_evento_check check (
  evento in (
    'handoff_without_handoff_id',
    'business_claim_without_evidence',
    'claim_contradicts_evidence',
    'question_without_tool_call'
  )
);
