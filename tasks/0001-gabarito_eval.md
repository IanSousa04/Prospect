# Gabarito/eval da camada de IA (rede de segurança de regressão)

**Status:** concluído
**Prioridade:** P0
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

Implementado: `apps/ai-orchestrator/src/eval/deterministicos.ts` (11 casos de código — sanitização + as 4 checagens de `verificacao.ts` — sem LLM, grátis, instantâneo) + `apps/ai-orchestrator/src/eval/casos-e2e.ts` (5 casos de ponta a ponta contra `processarMensagem` real, com API de verdade, criando/limpando seu próprio cliente+atendimento descartável a cada caso) + runner `apps/ai-orchestrator/src/eval/gabarito.ts` (`npm run -w apps/ai-orchestrator eval`). Cobre os episódios reais já corrigidos nesta sessão (PDF, código de pedido, "o que eu já pedi" sem handoff, saudação, cliente pede humano, preço real contra catálogo de verdade). 16/16 passando. Ainda não plugado em CI (fica [P2] "Testes automatizados gerais + CI/CD", seção 10) — por ora é rodado manualmente antes/depois de mudanças de prompt.
