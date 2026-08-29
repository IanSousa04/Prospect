-- Pipeline "nada sai sem lastro" (tarefa 0082).
--
-- Duas coisas:
--
-- 1. A ferramenta `consultar_opcoes_atendimento`, que devolve o que a loja
--    de fato oferece (tipos de entrega e formas de pagamento) a partir de
--    `ia_configuracoes.fluxo_pedido_json`. Existe para que a CONFIGURAÇÃO
--    vire evidência real, com linha em `ia_execucoes`, e não um fato sem
--    fonte. É ela que torna impossível a IA dizer "não fazemos entrega"
--    quando a configuração da empresa diz o contrário — episódio real que
--    motivou esta tarefa.
--
--    Diferente das outras ferramentas, esta é liberada por padrão para as
--    empresas existentes (insert abaixo): ela só lê a configuração que a
--    própria empresa preencheu e que o orquestrador já carrega em memória a
--    cada mensagem, então não há decisão de negócio a autorizar. A linha
--    existe de verdade em `ia_permissoes` (nada de default implícito, ver
--    CLAUDE.md regra 2) e o dono pode revogá-la na tela de permissões.
--
-- 2. Os três eventos de invariante novos do gate de lastro.
--
-- Rodar no SQL Editor do projeto Supabase, depois de 0020_ia_invariantes.sql.

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico', 'atualizar_cliente',
  'consultar_pedido', 'criar_pedido', 'adicionar_item', 'alterar_item', 'cancelar_pedido', 'consultar_status',
  'adicionar_ao_carrinho', 'remover_do_carrinho', 'atualizar_item_carrinho', 'consultar_carrinho',
  'definir_tipo_entrega', 'definir_endereco_entrega', 'definir_forma_pagamento',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento', 'consultar_prazo_entrega', 'consultar_opcoes_atendimento'
));

insert into ia_permissoes (empresa_id, ferramenta, permitido)
select id, 'consultar_opcoes_atendimento', true from empresas
on conflict (empresa_id, ferramenta) do nothing;

alter table ia_invariantes drop constraint if exists ia_invariantes_evento_check;

alter table ia_invariantes add constraint ia_invariantes_evento_check check (
  evento in (
    'confirmation_without_order',
    'order_without_confirmation',
    'handoff_without_order',
    'handoff_without_handoff_id',
    'state_mutation_without_tool',
    'tool_expected_but_not_called',
    'tool_success_without_state_change',
    'transactional_claim_without_evidence',
    -- Tarefa 0082: afirmação de regra de negócio sem fato que a sustente,
    -- afirmação que contradiz um fato coletado, e pergunta de negócio que
    -- não resultou em nenhuma execução de ferramenta.
    'business_claim_without_evidence',
    'claim_contradicts_evidence',
    'question_without_tool_call'
  )
);
