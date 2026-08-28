# Mesclar "IA solicitou humano" e "Cliente solicitou humano" num único status "Solicitou humano"

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)
**Depende de:** nada — pode ser feita isoladamente, mas é pré-requisito de [0066](0066-estagio_operacional_unificado.md)/[0067](0067-kanban_unificado.md)

Pedido do usuário: os dois status hoje distintos em `StatusAtendimento` (`ia_solicitou_humano`, `cliente_solicitou_humano` — `supabase/migrations/0005_fase1_atendimento.sql:145-146`) viram um só, `solicitou_humano`, pra simplificar o Kanban. Quem pediu (IA ou cliente) **não se perde** — isso já é rastreado separadamente em `handoffs.origem` (`cliente_solicitou` | `ia_solicitou`, ver `supabase/migrations/0005_fase1_atendimento.sql:187-197`), que continua existindo sem mudança; o card do Kanban e o painel de atendimento podem continuar mostrando essa origem lendo do handoff, só o status do atendimento em si que deixa de ter as duas variantes.

## Escopo

- Migration: reescrever o check constraint de `atendimentos.status` trocando `'ia_solicitou_humano','cliente_solicitou_humano'` por `'solicitou_humano'`, com `UPDATE atendimentos SET status = 'solicitou_humano' WHERE status IN ('ia_solicitou_humano', 'cliente_solicitou_humano')` migrando linhas existentes ANTES de reescrever o constraint (senão a migration falha com dados antigos violando o novo check).
- `packages/shared/src/types.ts` — `StatusAtendimento` perde as duas variantes, ganha `solicitou_humano`.
- `apps/api/src/routes/atendimentos.ts` — `TRANSICOES`/`STATUS_VALIDOS` atualizados; `handoffs.ts` (`criarHandoff`, `apps/ai-orchestrator/src/handoffs.ts:49`) que hoje decide `ia_solicitou_humano` vs `cliente_solicitou_humano` a partir de `origem` passa a sempre gravar `solicitou_humano`.
- `apps/web/src/components/statusMeta.tsx` — `STATUS_META`/`KANBAN_COLUNAS` perdem uma entrada; decidir cor/ícone da coluna única (sugestão: manter âmbar de "IA solicitou", já que vermelho fica reservado — ver tarefa 0037 — pro caso mais urgente de verdade, e com handoff.origem ainda visível no card não se perde a urgência real de "cliente pediu").
- Conferir todo lugar que hoje distingue os dois status (`apps/web/src/pages/Atendimento.tsx`, `Kanban.tsx`) e trocar pela variante única.

Nenhuma migration de dado é destrutiva (é um `UPDATE` de valor de enum, não perda de linha), mas envolve tabela em produção — confirmar com o usuário antes de rodar, mesmo sendo reversível.
