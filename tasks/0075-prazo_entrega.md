# Tool `consultar_prazo_entrega` + config de prazo padrão vs. calculado

**Status:** não iniciado
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Hoje a IA não tem nenhuma forma confiável de responder "quanto tempo demora meu pedido?" — não existe conceito de tempo de preparo no catálogo nem qualquer cálculo de prazo de entrega na camada de IA. Sem fonte real, qualquer resposta de prazo seria um número inventado pelo modelo (CLAUDE.md regra 1).

## Config por empresa

Nova configuração em `packages/shared/src/ia-config.ts` (mesmo padrão de `comportamento_json`, `tasks/0006-comportamento_json.md`), com dois modos:

- **`padrao`**: a empresa cadastra manualmente um prazo fixo (texto livre, ex. "30-45 minutos"), e a IA sempre responde com esse valor quando perguntada — nunca calcula.
- **`calculado`**: a IA usa a tool `consultar_prazo_entrega` (abaixo) pra calcular o prazo real a cada pergunta.

Precisa de toggle na UI (`apps/web/src/pages/ConfiguracoesIa.tsx`, mesma tela que já gerencia `comportamento_json` e permissões de ferramenta) — ao selecionar `padrao`, a UI deve pedir o texto do prazo; ao selecionar `calculado`, a UI ativa a tool nas permissões de ferramenta da empresa.

## Tool `consultar_prazo_entrega`

Só relevante quando o modo é `calculado`. Fluxo:

1. Busca todos os pedidos pendentes (fila ativa) da empresa (mesmo escopo de tenant de qualquer outra tool — CLAUDE.md regra 5).
2. Para cada pedido, soma o tempo de preparo de cada produto — **novo campo no catálogo** (não existe hoje nenhum campo de tempo de preparo por produto; precisa ser adicionado ao schema de produtos, seção 5 do ROADMAP — Catálogo/Fase 2 — nesta tarefa ou numa tarefa companheira explícita).
3. Calcula o prazo estimado (fila + preparo) e devolve como resultado de ferramenta com fonte real, nunca um número estimado "de memória" pelo modelo.

Registrar a nova ferramenta em `NOMES_FERRAMENTAS` (`packages/shared/src/ia-config.ts`) e no check constraint de `ia_permissoes.ferramenta` (mesmo padrão de migration usado em `tasks/0054-tools_carrinho.md`) — permissão explícita por empresa antes de a IA poder chamá-la (CLAUDE.md regra 2). Sem permissão configurada, a tool fica indisponível, nunca disponível por padrão.

## Notas

- O campo de tempo de preparo por produto é estado gerenciado pelo catálogo (não pela IA), mas afeta diretamente o que a IA responde — a tela de produto (Fase 2 — Catálogo Inteligente) precisa permitir editar esse campo antes da tool `calculado` fazer sentido em produção.
- Ao implementar de fato (toca ferramenta de IA + permissões + comportamento configurável), rodar a skill `food-ai-guardrails` antes de considerar concluído.
