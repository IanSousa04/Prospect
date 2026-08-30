-- Seed de desenvolvimento — NUNCA rodar em produção.
-- Cria 2 empresas fictícias com dados suficientes pra testar o Kanban da
-- Fase 1 e, principalmente, o isolamento multi-tenant (RLS): consultando com
-- o JWT de um usuário da Empresa A, nada da Empresa B deve aparecer.
--
-- Convenção do Supabase CLI: `supabase db reset` roda todas as migrations e
-- depois este arquivo automaticamente. Rodar manualmente no SQL Editor
-- também funciona.

insert into empresas (id, nome, slug, segmento, telefone_whatsapp, status) values
  ('00000000-0000-0000-0000-000000000001', 'Burger House', 'burger-house', 'hamburgueria', '+5511999990001', 'ativo'),
  ('00000000-0000-0000-0000-000000000002', 'Pizzaria Napoli', 'pizzaria-napoli', 'pizzaria', '+5511999990002', 'ativo')
on conflict (id) do nothing;

insert into ia_configuracoes (empresa_id, tom_de_voz, usa_emoji) values
  ('00000000-0000-0000-0000-000000000001', 'amigavel', true),
  ('00000000-0000-0000-0000-000000000002', 'amigavel', true)
on conflict (empresa_id) do nothing;

insert into clientes (id, empresa_id, nome, telefone, primeiro_contato_em, ultima_interacao_em, tags) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Fernanda Lima', '+5511984321190', now() - interval '5 months', now() - interval '2 minutes', array['cliente_frequente','pedido_grande']),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Rafael Souza', '+5511987654321', now() - interval '2 months', now() - interval '2 minutes', array[]::text[]),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000002', 'Marina Alves', '+5511911112222', now() - interval '1 month', now() - interval '10 minutes', array[]::text[])
on conflict (id) do nothing;

insert into conhecimento_itens (empresa_id, categoria, titulo, conteudo) values
  ('00000000-0000-0000-0000-000000000001', 'pagamento', 'Formas de pagamento aceitas', 'Aceitamos cartão de crédito, débito e Pix. Não é possível dividir o pagamento entre dois métodos no momento.'),
  ('00000000-0000-0000-0000-000000000001', 'entrega', 'Área de entrega', 'Entregamos em um raio de 5km da loja. Taxa de entrega calculada por distância.'),
  ('00000000-0000-0000-0000-000000000002', 'horario', 'Horário de funcionamento', 'Terça a domingo, das 18h às 23h30.')
on conflict do nothing;

insert into atendimentos (id, empresa_id, cliente_id, status, intencao, prioridade, ultima_mensagem_em) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'solicitou_humano', 'Pagamento', 'alta', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'ia_atendendo', 'Compra', 'normal', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000201', 'ia_atendendo', 'Dúvida', 'normal', now() - interval '10 minutes')
on conflict (id) do nothing;

insert into mensagens (empresa_id, atendimento_id, remetente, conteudo, criado_em) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'cliente', 'Oi! Quero pedir um Combo Duplo Bacon pra entrega', now() - interval '6 minutes'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'ia', 'Claro! O Combo Duplo Bacon inclui X-Bacon duplo, batata média e refrigerante 350ml por R$ 68,50. Posso confirmar o pedido?', now() - interval '6 minutes'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'cliente', 'Pode ser! Mas posso pagar metade no cartão e metade no pix?', now() - interval '4 minutes'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'ia', 'Vou verificar essa possibilidade com a equipe e já te retorno, só um instante.', now() - interval '3 minutes');

insert into handoffs (empresa_id, atendimento_id, origem, motivo, resumo, acao_sugerida, prioridade) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'ia_solicitou', 'Pagamento dividido entre dois métodos', 'Cliente quer pagar metade no cartão e metade no pix. Não existe regra configurada para pagamento fracionado.', 'Confirmar com o cliente se é possível dividir e registrar manualmente o pagamento.', 'alta');

-- Pedidos de exemplo — cobrem as 5 colunas do Kanban operacional: um pedido
-- `aberto` (card fica na coluna de conversa, com a ação "Confirmar"), um
-- `em_preparacao` (🍳 Na cozinha) e um `pronto` (🟢 Pronto). Sem isso as duas
-- últimas colunas nascem vazias e não dá pra avaliar o board.
--
-- `responsavel_usuario_id` fica nulo porque `usuarios` referencia
-- `auth.users` e o seed não cria contas de autenticação — o card mostra
-- "👤 Humano" nesse caso. Para ver o nome real, assuma um atendimento pelo
-- painel com um usuário de verdade.
insert into atendimentos (id, empresa_id, cliente_id, status, intencao, prioridade, ultima_mensagem_em, assumido_em) values
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'humano_atendendo', 'Compra', 'normal', now() - interval '4 minutes', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'humano_atendendo', 'Compra', 'normal', now() - interval '14 minutes', now() - interval '13 minutes'),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'ia_atendendo', 'Compra', 'normal', now() - interval '25 minutes', null)
on conflict (id) do nothing;

insert into pedidos (id, empresa_id, cliente_id, atendimento_id, status, origem, tipo_entrega, forma_pagamento, subtotal, total, criado_em, atualizado_em) values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000303', 'aberto', 'ia', 'entrega', 'pix', 62.40, 68.40, now() - interval '5 minutes', now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000304', 'em_preparacao', 'ia', 'entrega', 'cartao_credito', 47.90, 53.90, now() - interval '16 minutes', now() - interval '12 minutes'),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000305', 'pronto', 'ia', 'retirada', 'dinheiro', 34.00, 34.00, now() - interval '28 minutes', now() - interval '2 minutes')
on conflict (id) do nothing;

insert into itens_pedido (empresa_id, pedido_id, nome_produto, quantidade, preco_unitario, ordem) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', 'X-Burger', 2, 24.90, 0),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', 'Batata frita média', 1, 12.60, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000502', 'Combo Duplo Bacon', 1, 39.90, 0),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000502', 'Coca-Cola 350ml', 2, 4.00, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000503', 'X-Salada', 1, 22.00, 0),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000503', 'Milkshake', 1, 12.00, 1)
on conflict do nothing;
