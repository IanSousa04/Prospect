-- Prazo de entrega (tarefa 0075) — hoje a IA não tem nenhuma forma
-- confiável de responder "quanto tempo demora meu pedido?" (CLAUDE.md
-- regra 1: sem fonte real, seria um número inventado pelo modelo).
--
-- Modo `padrao`: a empresa cadastra um texto livre fixo (ex. "30-45
-- minutos") e a IA sempre responde isso, nunca calcula. Modo `calculado`:
-- a tool `consultar_prazo_entrega` soma o tempo de preparo dos produtos na
-- fila ativa de pedidos, usando o novo campo `produtos.tempo_preparo_minutos`.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0017_whatsapp_conexoes.sql.

alter table produtos
  add column if not exists tempo_preparo_minutos int check (tempo_preparo_minutos is null or tempo_preparo_minutos > 0);

alter table ia_configuracoes
  add column if not exists prazo_entrega_modo text not null default 'padrao' check (prazo_entrega_modo in ('padrao', 'calculado')),
  add column if not exists prazo_entrega_texto text;

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
  'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho',
  'definir_tipo_entrega', 'definir_endereco_entrega', 'definir_forma_pagamento',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento', 'consultar_prazo_entrega'
));
