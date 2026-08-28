# Simulação de atendimentos completos com personas variadas

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 10. Infraestrutura / produção

Complementa o gabarito (`tasks/0001-gabarito_eval.md`, casos de um único
turno) com um script separado que roda **conversas inteiras** de vários
turnos contra a pipeline real (`processarMensagem`), simulando o lado do
cliente com o mesmo LLM (DeepSeek) sob diferentes personalidades — nervoso,
confuso, indeciso, simpático, apressado — mais um cenário de controle
negativo (cliente insiste em desconto fora de política) que deve terminar em
handoff. O objetivo é garantir, com uma conversa real e não um caso isolado,
que a IA só escala pra humano quando a situação realmente exige (CLAUDE.md
regra 6), nunca por causa do tom ou da indecisão do cliente.

Implementado em `apps/ai-orchestrator/src/eval/personas/`:
- `simulador-cliente.ts` — gera a próxima fala do "cliente" via LLM, invertendo a perspectiva do histórico real; a persona sinaliza o fim da conversa com o marcador `[[FIM]]`.
- `definicoes.ts` — as personas e o objetivo de cada uma, incluindo o cenário de controle (`handoffEsperado: true`).
- `cenarios.ts` — loop do turno (cliente simulado → `processarMensagem` real → acumula histórico), reaproveitando `criarAtendimentoDeTeste`/`limparAtendimentoDeTeste`/`montarConfigDeProcessamentoDeTeste` (extraídos de `eval/casos-e2e.ts` pra esse fim). Avaliação híbrida: checagem determinística de handoff indevido/esperado e de valor monetário citado fora do catálogo real da empresa, seguida de um LLM-juiz (`juiz.ts`) que avalia só o que é qualitativo (tom apropriado à personalidade, continuidade da conversa, progresso rumo ao objetivo do cliente) — o juiz nunca decide sobre handoff ou dado inventado, isso já é coberto pelo código.
- `index.ts` — runner, `npm run -w apps/ai-orchestrator simular-conversas`.

Roda separado do `npm run eval` (não entra nele nem em CI automática): cada
cenário é uma conversa real de vários turnos com LLM dos dois lados mais um
LLM-juiz, então é mais caro e mais lento que os casos de um turno do
gabarito — pensado pra rodar manualmente antes/depois de mudanças
relevantes de prompt ou de regras de handoff/confiança, complementar ao
simulador de UI (`tasks/0012-simulador_ia.md`, que é uma ferramenta de
debug manual de um turno, não uma simulação automática de conversa
completa) e à tarefa geral de CI (`tasks/0048-testes_cicd.md`).
