-- "Cancelar atendimento" (pedido do usuário) — novo status terminal
-- `cancelado` para atendimentos, distinto de `resolvido` (finalizar).
-- Cancelar = conversa abortada (spam, número errado, cliente desistiu,
-- duplicada): sai do board e fica rastreável como cancelada, sem se misturar
-- com "resolvido" nas futuras métricas/histórico. As regras de quando é
-- permitido (sem pedido ativo, resolve handoffs) ficam na API
-- (POST /atendimentos/:id/cancelar), não no schema.

-- Precisa dropar o constraint antigo ANTES de recriar com o novo valor — a
-- extensão direta do check só aceita valores novos se recriado por completo.
alter table atendimentos drop constraint if exists atendimentos_status_check;

alter table atendimentos add constraint atendimentos_status_check
  check (status in ('ia_atendendo', 'solicitou_humano', 'humano_atendendo', 'resolvido', 'cancelado'));
