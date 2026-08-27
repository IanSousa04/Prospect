# Risco real na matriz de decisão + enforcement das permissões de escrita

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Hoje `agent/decisao.ts` sempre assume risco "baixo" e `registrarDecisao` grava `risco: 'baixo'` fixo (não há tool de escrita). Quando o MVP 2 chegar, a matriz precisa considerar risco E consumir os campos de permissão que já existem em `ia_permissoes` (migration `0010_ia_permissoes.sql`) mas hoje só validam `permitido`: `exige_confirmacao_humana`, `valor_maximo_sem_handoff`, `condicoes_json.status_permitidos`, `campos_permitidos` — nenhum deles é lido em código.

**Atualização (tarefa 0055):** `exige_confirmacao_humana`/`valor_maximo_sem_handoff` já deixaram de ser letra morta — a tool `criar_pedido` (`apps/ai-orchestrator/src/tools/pedido.ts`) já lê os dois via `avaliarRiscoCriarPedido` (`packages/shared/src/pedido-criacao.ts`) e o orquestrador já força handoff quando o gate bloqueia (veto determinístico em `agent/orquestrador.ts`, mesmo padrão do guard de prompt injection). Essa é uma implementação **pontual, só pra `criar_pedido`** — não é a matriz de decisão genérica que esta tarefa (0023) ainda precisa entregar pras próximas tools de escrita (`adicionar_item`, `alterar_item`, `cancelar_pedido` — tarefas 0057/0058, ainda pendentes) e pra `condicoes_json.status_permitidos`/`campos_permitidos`, que continuam sem nenhum código lendo. Quando 0023 for implementada de verdade, considerar generalizar `avaliarRiscoCriarPedido` em vez de reimplementar o gate por tool.

**Lacuna real, documentada conscientemente:** sem `exige_confirmacao_humana`/`valor_maximo_sem_handoff` configurados pela empresa, `criar_pedido` roda de forma permissiva (sem limite de valor) — mesmo padrão de "ausência = permissivo" já usado em `comportamento_json`. Isso é aceitável enquanto o volume é baixo (empresas piloto), mas é exatamente a lacuna que uma matriz de risco real (esta tarefa) deveria fechar de forma mais robusta antes de qualquer empresa real depender disso em produção com volume alto.
