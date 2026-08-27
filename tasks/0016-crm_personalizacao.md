# Cliente (CRM simplificado) — campos de personalização ainda não confirmados em uso

**Status:** concluído (escopo reduzido — ver Resolução)
**Prioridade:** P2
**Seção no ROADMAP:** 2. Atendimento (Kanban / conversa)

A especificação de cliente prevê `tags` e `preferências identificadas` além de nome/telefone/histórico/totais já existentes, para permitir personalização como *"Vi que você costuma pedir o X-Bacon. Quer repetir ou experimentar o novo X-Tudo?"*. Verificar se esses campos existem no schema atual de `clientes` e, se não, desenhar e implementar — sempre respeitando a configuração de privacidade da empresa.

**Resolução:** `tags` e `preferencias_json` já existiam no schema (`clientes`, migration 0005) e no tipo `Cliente` desde a Fase 1. `tags` já estava totalmente em uso (API, `Clientes.tsx`, `consultar_cliente`); o gap real era "preferências identificadas".

- **Produto favorito é calculado on-the-fly** a partir de `itens_pedido` (fonte real, mesmo padrão de agregação de `apps/api/src/routes/analytics.ts`), exposto pela tool `consultar_cliente` (`apps/ai-orchestrator/src/tools/cliente.ts`) como `produto_favorito`. Deliberadamente **não persiste** em `clientes.preferencias_json` — evita inventar mecanismo de escrita/job e evita a IA citar dado desatualizado (CLAUDE.md regra 1). `preferencias_json` continua reservado, sem uso, para uma preferência *declarada* manualmente no futuro (tool de escrita, tarefa 0021).
- **Configuração de privacidade da empresa**: novo campo `personalizar_com_historico` (opcional, booleano) em `ComportamentoJsonSchema` (`packages/shared/src/ia-config.ts`), mesmo padrão dos campos irmãos (`fazer_recomendacoes` etc.) — ausência/`true` = permissivo, só `false` desliga. Controle exposto em `apps/web/src/pages/ConfiguracoesIa.tsx`. Checado dentro da tool (campo simplesmente omitido do retorno quando desligado) em vez de regra textual no prompt — dado ausente na fonte é mais seguro contra alucinação do que dado presente com instrução pra ignorar.
- `ToolContext` (`apps/ai-orchestrator/src/tools/registry.ts`) ganhou o campo `comportamento`, necessário pra tool checar o toggle — antes só o Investigador tinha acesso a `comportamento_json`.
- **Fora do escopo, deliberadamente**: edição manual de `tags` (não existe `PATCH /clientes/:id` nem UI de edição — `tags` já estava "em uso" end-to-end, CRUD de edição é escopo de produto novo não citado no texto original desta tarefa).
