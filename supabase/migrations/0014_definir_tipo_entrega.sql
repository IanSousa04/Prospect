-- Tool `definir_tipo_entrega` (tarefa 0018) — a IA passa a poder registrar
-- o tipo de entrega escolhido pelo cliente (entrega/retirada) no Order
-- Context, depois de perguntar. Continua sem criar nenhum pedido real —
-- só muta `ia_sessoes.estado_json.pedido`, igual às tools de carrinho.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0013_carrinho_ferramentas.sql.

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
  'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho', 'definir_tipo_entrega',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento'
));
