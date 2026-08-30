-- =========================================================================
-- Redesenho do Kanban operacional (5 colunas)
--
-- Duas colunas aditivas que a nova UI precisa e que não existiam:
--
-- 1. `atendimentos.assumido_em` — instante em que um humano assumiu. Sem
--    isso não dá pra mostrar "tempo de atendimento" no card: `atualizado_em`
--    muda a cada mensagem e `ultima_mensagem_em` mede outra coisa.
--
-- 2. `pedidos.numero` — número sequencial POR EMPRESA. É o número que a
--    cozinha e o cliente usam falando ("pedido 42"); UUID não serve pra isso.
--    Deliberadamente NÃO é uma sequence global: numeração compartilhada entre
--    tenants vaza volume de negócio de uma empresa pra outra e faria o
--    primeiro pedido de um cliente novo nascer como "#4187".
-- =========================================================================

alter table atendimentos add column if not exists assumido_em timestamptz;

alter table pedidos add column if not exists numero int;

-- Backfill dos pedidos já existentes, respeitando a ordem cronológica dentro
-- de cada empresa.
update pedidos p
set numero = ordenados.posicao
from (
  select id, row_number() over (partition by empresa_id order by criado_em, id) as posicao
  from pedidos
  where numero is null
) as ordenados
where p.id = ordenados.id and p.numero is null;

-- O advisory lock é por empresa (não global): dois pedidos simultâneos da
-- mesma empresa não podem receber o mesmo número, mas empresas diferentes
-- continuam inserindo em paralelo sem se serializar (CLAUDE.md regra 5).
create or replace function atribuir_numero_pedido()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext(new.empresa_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero
    from pedidos
    where empresa_id = new.empresa_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pedidos_numero on pedidos;
create trigger trg_pedidos_numero
  before insert on pedidos
  for each row execute function atribuir_numero_pedido();

create unique index if not exists uq_pedidos_empresa_numero on pedidos(empresa_id, numero);
