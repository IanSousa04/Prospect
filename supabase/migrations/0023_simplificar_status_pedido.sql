-- Tarefa 0065 — simplifica StatusPedido: `confirmado`/`em_preparo` viram
-- `em_preparacao`, `saiu_para_entrega` vira `pronto`. `aberto` é mantido
-- separado (decisão do usuário: cozinha precisa distinguir "pedido acabou
-- de entrar, ninguém aceitou" de "já está sendo preparado").

-- Precisa dropar o constraint antigo ANTES do UPDATE: o check atual não
-- aceita 'em_preparacao'/'pronto' como valor válido de status, então
-- atualizar os dados primeiro (com o constraint velho ainda de pé) falha.
alter table pedidos drop constraint if exists pedidos_status_check;

update pedidos set status = 'em_preparacao' where status in ('confirmado', 'em_preparo');
update pedidos set status = 'pronto' where status = 'saiu_para_entrega';

alter table pedidos add constraint pedidos_status_check
  check (status in ('aberto', 'em_preparacao', 'pronto', 'entregue', 'cancelado'));
