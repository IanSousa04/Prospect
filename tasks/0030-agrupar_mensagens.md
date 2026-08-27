# Agrupar mensagens rápidas do cliente antes de responder

**Status:** concluído
**Prioridade:** P2 (seção 3, sem tag explícita no item original)
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Implementado em `apps/ai-orchestrator/src/poller.ts`: `DEBOUNCE_RAJADA_MS` (8s) — um atendimento só é processado quando já passou esse tempo desde a última mensagem de cliente recebida nele; mensagem nova reseta o timer naturalmente porque o poller reavalia `silencioMs` a cada ciclo. As mensagens acumuladas na janela são agrupadas por `atendimento_id` e viram uma única `pergunta` (join por quebra de linha) processada num só turno pelo Investigador/Atendente, com o histórico cortado a partir da mais antiga da rajada (evita duplicar as próprias mensagens da rajada no histórico). Como só a mensagem mais recente da rajada (o "gatilho") ganha linha em `ia_decisoes`, as demais são marcadas com `metadata_json.agrupada_em` pra não ficarem sendo recandidatadas a cada ciclo do poller.
