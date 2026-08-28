# Reconstruir o Kanban com as colunas unificadas (conversa + pedido)

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)
**Depende de:** [Estágio operacional unificado (0066)](0066-estagio_operacional_unificado.md)

Reescreve `apps/web/src/pages/Kanban.tsx`/`Kanban.css` e `apps/web/src/components/statusMeta.tsx` pra usar `estagio_operacional` (0066) em vez de `atendimentos.status` puro. Colunas, na ordem:

1. **IA atendendo**
2. **Solicitou humano** (já mesclado, ver 0064)
3. **Humano atendendo**
4. **Em preparação**
5. **Pronto**
6. **Entregue**
7. **Cancelado** — visualmente distinto (ex.: cards com opacidade reduzida e/ou borda tracejada, badge "Cancelado"), com botão "Arquivar" direto no card (chama `POST /pedidos/:id/arquivar`, ver 0066).

Card mostra a mesma info de hoje (nome do cliente, valor do pedido se houver, tempo decorrido, preview de handoff), mas a origem do handoff (`handoffs.origem`, ver 0064) continua aparecendo na coluna "Solicitou humano" pra não perder a distinção "IA pediu" vs "cliente pediu" que a fusão de status removeu do nome da coluna.

**Fora de escopo aqui** (tarefas próprias): mover card entre colunas via drag-and-drop (0068); teste de carga com muitas conversas (0072).
