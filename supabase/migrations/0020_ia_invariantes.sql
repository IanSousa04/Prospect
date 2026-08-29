-- Log de invariantes do workflow transacional (tarefa 0081).
--
-- Cada linha aqui é uma situação que, POR DESENHO, não deveria acontecer:
-- confirmação reconhecida que não virou pedido, ferramenta que deveria ter
-- rodado e não rodou, mutação de estado sem execução correspondente,
-- afirmação transacional sem evidência persistida. Não é log de erro de
-- operação — é detector de bug de arquitetura.
--
-- Append-only, mesmo padrão de `ia_decisoes`/`ia_execucoes` (migration
-- 0009): nenhuma policy de update/delete é criada para nenhuma role de
-- aplicação. Auditoria que pode ser editada não é auditoria.
--
-- Rodar no SQL Editor do projeto Supabase, depois de
-- 0019_fluxo_pedido_config.sql.

create table if not exists ia_invariantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  mensagem_id uuid references mensagens(id) on delete set null,
  evento text not null check (
    evento in (
      'confirmation_without_order',
      'order_without_confirmation',
      'handoff_without_order',
      'handoff_without_handoff_id',
      'state_mutation_without_tool',
      'tool_expected_but_not_called',
      'tool_success_without_state_change',
      'transactional_claim_without_evidence'
    )
  ),
  detalhe_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_ia_invariantes_empresa_id on ia_invariantes(empresa_id);
create index if not exists idx_ia_invariantes_atendimento_id on ia_invariantes(atendimento_id);
-- Consulta mais comum na prática: "quais invariantes dispararam nas últimas
-- 24h, por tipo" — evento + data juntos evitam varrer a tabela inteira.
create index if not exists idx_ia_invariantes_evento_criado_em on ia_invariantes(evento, criado_em desc);

alter table ia_invariantes enable row level security;

create policy ia_invariantes_select on ia_invariantes for select using (empresa_id = auth_empresa_id());
create policy ia_invariantes_insert on ia_invariantes for insert with check (empresa_id = auth_empresa_id());
