# Devolver atendimento pra IA

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

Mesma situação: a rota aceitaria `status: 'ia_atendendo'`, mas não há botão nem lógica de negócio. Precisa decidir: encerrar automaticamente qualquer handoff `aberto`/`assumido` associado ao devolver? Resetar `ia_sessoes.estado_json` (quando essa tabela passar a ser usada, ver tarefa `ia_sessoes em uso`)? Isso não foi desenhado ainda, só a necessidade foi identificada.

**Resolução:** rota dedicada `POST /atendimentos/:id/devolver-ia` (`apps/api/src/routes/atendimentos.ts`) e botão "Devolver pra IA" em `apps/web/src/pages/Atendimento.tsx`. Decisão tomada: resolve automaticamente qualquer handoff `aberto`/`assumido` do atendimento ao devolver (diferente de "finalizar", que bloqueia — ver tarefa 0013), pois com a IA de volta ativa um handoff pendente ficaria com banner obsoleto na tela. Reset de `ia_sessoes.estado_json` ainda não se aplica, pois essa tabela não está em uso.
