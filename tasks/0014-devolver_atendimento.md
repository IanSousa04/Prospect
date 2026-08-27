# Devolver atendimento pra IA

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

Mesma situação: a rota aceitaria `status: 'ia_atendendo'`, mas não há botão nem lógica de negócio. Precisa decidir: encerrar automaticamente qualquer handoff `aberto`/`assumido` associado ao devolver? Resetar `ia_sessoes.estado_json` (quando essa tabela passar a ser usada, ver tarefa `ia_sessoes em uso`)? Isso não foi desenhado ainda, só a necessidade foi identificada.
