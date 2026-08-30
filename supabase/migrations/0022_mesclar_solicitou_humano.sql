-- Tarefa 0064 — mescla `ia_solicitou_humano`/`cliente_solicitou_humano` num
-- único status `solicitou_humano`. Quem pediu (IA ou cliente) não se perde
-- — continua rastreado em handoffs.origem, sem mudança de schema aqui.

-- Precisa dropar o constraint antigo ANTES do UPDATE: o check atual não
-- aceita 'solicitou_humano' como valor válido de status, então atualizar
-- os dados primeiro (com o constraint velho ainda de pé) falha.
alter table atendimentos drop constraint if exists atendimentos_status_check;

update atendimentos set status = 'solicitou_humano'
  where status in ('ia_solicitou_humano', 'cliente_solicitou_humano');

alter table atendimentos add constraint atendimentos_status_check
  check (status in ('ia_atendendo', 'solicitou_humano', 'humano_atendendo', 'resolvido'));
