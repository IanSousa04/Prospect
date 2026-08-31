-- Remoção da feature "cardápio por categoria" (task 0083 obsoleta): a IA não
-- lista itens do cardápio — o cliente é direcionado ao cardápio online (link
-- público), onde ele mesmo vê tudo e monta o pedido.
--
-- Remove `listar_categorias` e `listar_produtos_por_categoria` da lista de
-- ferramentas válidas de `ia_permissoes` e apaga linhas existentes dessas
-- ferramentas (permissão de uma capacidade que deixou de existir).

delete from ia_permissoes
where ferramenta in ('listar_categorias', 'listar_produtos_por_categoria');

alter table ia_permissoes drop constraint if exists ia_permissoes_ferramenta_check;

alter table ia_permissoes add constraint ia_permissoes_ferramenta_check check (ferramenta in (
  'buscar_produtos', 'buscar_opcoes', 'buscar_adicionais', 'buscar_combos', 'buscar_recomendacoes',
  'consultar_cliente', 'consultar_historico',
  'consultar_pedido', 'consultar_status',
  'consultar_horario', 'consultar_taxa', 'consultar_regiao', 'consultar_politica',
  'buscar_conhecimento', 'consultar_prazo_entrega', 'consultar_opcoes_atendimento'
));
