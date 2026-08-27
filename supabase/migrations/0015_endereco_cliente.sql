-- Endereço salvo do cliente (tarefa 0020) — decisão de escopo: um campo
-- único (não tabela de múltiplos endereços) guardando o último endereço de
-- entrega usado, pra "entregar no mesmo endereço de sempre?" na próxima
-- conversa. Nenhuma tarefa do ROADMAP pediu múltiplos endereços salvos —
-- resolver isso só quando essa necessidade aparecer de verdade, não antes.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0014_definir_tipo_entrega.sql.

alter table clientes
  add column if not exists endereco_json jsonb;

-- Tool `definir_endereco_entrega` (ver apps/ai-orchestrator/src/tools/carrinho.ts)
alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
  'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho',
  'definir_tipo_entrega', 'definir_endereco_entrega',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento'
));
