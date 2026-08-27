# Risco real na matriz de decisão + enforcement das permissões de escrita

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Hoje `agent/decisao.ts` sempre assume risco "baixo" e `registrarDecisao` grava `risco: 'baixo'` fixo (não há tool de escrita). Quando o MVP 2 chegar, a matriz precisa considerar risco E consumir os campos de permissão que já existem em `ia_permissoes` (migration `0010_ia_permissoes.sql`) mas hoje só validam `permitido`: `exige_confirmacao_humana`, `valor_maximo_sem_handoff`, `condicoes_json.status_permitidos`, `campos_permitidos` — nenhum deles é lido em código.
