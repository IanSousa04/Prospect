-- Tools de carrinho da IA (tarefa 0054, subtarefa 2/3 de `criar_pedido` —
-- tarefa 0017): `adicionar_ao_carrinho`, `remover_do_carrinho`,
-- `atualizar_item_carrinho`, `consultar_carrinho` (esta última já devolve o
-- subtotal calculado — sem tool separada de "calculate_cart", ver
-- apps/ai-orchestrator/src/tools/carrinho.ts). Mutam só o Order Context em
-- `ia_sessoes.estado_json.pedido` (tarefa 0053) — nenhuma cria um pedido
-- real em `pedidos`/`itens_pedido` ainda, isso é a tarefa 0055.
--
-- O check constraint de `ia_permissoes.ferramenta` precisa ser reescrito
-- (Postgres não tem "add value to check constraint", só dropar/recriar) —
-- lista completa é a mesma de 0010_ia_permissoes.sql + as 4 novas.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0012_identidade_ia.sql.

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
  'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento'
));
