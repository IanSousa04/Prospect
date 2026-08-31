# Prazo de entrega como range fixo (fonte única IA + link público)

**Status:** concluído — substitui a tarefa 0075 (que tinha dois modos: texto fixo `padrao` e cálculo por fila `calculado`).

## O que mudou

A IA nunca calcula prazo. O prazo é um **range fixo configurável por empresa** (default 60–90 min) e é a **única fonte de verdade**, consumida tanto pela IA quanto pela página pública.

## Implementação

- `supabase/migrations/0028_ia_assistente_puro.sql` — em `ia_configuracoes`, dropa `prazo_entrega_modo`/`prazo_entrega_texto` e adiciona `prazo_entrega_min_minutos` (default 60) e `prazo_entrega_max_minutos` (default 90).
- `packages/shared/src/ia-config.ts` — `PRAZO_ENTREGA_MIN_PADRAO`/`PRAZO_ENTREGA_MAX_PADRAO` + `formatarPrazoEntrega(min, max)` ("60 a 90 min"); `AtualizarIaConfiguracaoSchema` passa a exigir os dois campos.
- `apps/ai-orchestrator/src/tools/prazo.ts` — `consultar_prazo_entrega` devolve `{ min_minutos, max_minutos, texto }`, lendo o range do banco (nunca calcula fila).
- `apps/api/src/routes/publico.ts` — `GET /publico/:slug` expõe o range em `LojaPublica` (via `formatarPrazoEntrega` na página).
- `packages/shared/src/pedido-publico.ts` — `LojaPublica` passa de `prazo_entrega_texto` para `prazo_entrega_min_minutos`/`prazo_entrega_max_minutos`.
- `apps/api/src/routes/ia-configuracoes.ts` + `apps/web/src/pages/ConfiguracoesIa.tsx` — UI gerencia o range (min/max), em vez do toggle modo padrão/calculado.
- `apps/web/src/publico/PedidoPublico.tsx` — exibe "Entrega em 60 a 90 min" no topo.

## Decisão

Drop de `prazo_entrega_texto` (texto livre) junto com `prazo_entrega_modo`: um texto solto seria uma segunda fonte que pode divergir do range. O range + `formatarPrazoEntrega` é a fonte única, e a UI gerencia o mesmo estado que a IA lê (CLAUDE.md regra 8).
