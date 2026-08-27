-- Tool `definir_forma_pagamento` (tarefa 0019) — registra a forma de
-- pagamento escolhida pelo cliente no Order Context. Sem gateway real
-- ainda (ver tarefa "Gateway de pagamento real") — só registra a escolha,
-- nunca cobra de verdade.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0015_endereco_cliente.sql.

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
  'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho',
  'definir_tipo_entrega', 'definir_endereco_entrega', 'definir_forma_pagamento',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento'
));
