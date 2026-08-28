# Mover cards entre colunas no Kanban via drag-and-drop, alterando o status real

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)
**Depende de:** [Kanban unificado (0067)](0067-kanban_unificado.md)

Hoje o Kanban (`apps/web/src/pages/Kanban.tsx`) não move card nenhum — status só muda pelos botões dentro da tela de Atendimento (Assumir/Devolver/Finalizar) ou pelo select de status do pedido. Pedido do usuário: arrastar um card de uma coluna pra outra no board já muda o status de verdade.

## Decisões de implementação

- Cada coluna do board unificado (0067) mapeia pra uma mutação real diferente dependendo se o card está no lado "atendimento" ou "pedido" da jornada (ver derivação em 0066):
  - Arrastar entre `IA atendendo` / `Solicitou humano` / `Humano atendendo` → `POST /atendimentos/:id/status` (transições já validadas server-side, ver `TRANSICOES` em `apps/api/src/routes/atendimentos.ts`).
  - Arrastar entre `Em preparação` / `Pronto` / `Entregue` → `POST /pedidos/:id/status` (transições já validadas em `apps/api/src/routes/pedidos.ts`).
  - Arrastar PRA `Cancelado` → mesma rota de pedido, status `cancelado`.
  - Arrastar de um lado pro outro da jornada (ex.: de "Humano atendendo" direto pra "Pronto") não faz sentido nenhuma transição validada aceitar — a UI deve simplesmente rejeitar o drop (nunca permitir soltar numa coluna que a API recusaria, evita um "some e volta" feio).
- **Nenhuma biblioteca de drag-and-drop está no projeto ainda** — decidir na implementação entre HTML5 Drag and Drop API nativa (sem dependência nova, mas UX mais crua) ou uma lib leve (ex. `@dnd-kit/core`, mais trabalho de acessibilidade/touch já resolvido). Dado que o board já lida com toque em mobile (ver tarefa 0034, "nenhuma tela testada em mobile/tablet", ainda pendente), uma lib com suporte a touch nativo é a escolha mais segura.
- Se a transição for recusada pela API (ex.: usuário arrasta pra uma coluna sem transição válida), reverter a posição do card visualmente e mostrar um toast/erro — nunca deixar o card "preso" numa posição que não reflete o servidor.
- Otimista ou não: dado que múltiplos atendentes podem estar olhando o mesmo board (realtime já existe via Supabase, ver `Kanban.tsx`), mover o card só depois da confirmação do servidor evita um card "pulando" de volta quando dois usuários movem ao mesmo tempo — não fazer update otimista aqui.
