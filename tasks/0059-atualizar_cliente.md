# Tool `atualizar_cliente`

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [Tools de escrita restantes (0021)](0021-tools_escrita_restantes.md)

Sem executor registrado hoje, só existe como nome no enum `NOMES_FERRAMENTAS`. Escopo: a IA gravar dado declarado explicitamente pelo cliente sobre si mesmo (nome, uma preferência dita em texto livre — ex.: "não gosto de cebola") em `clientes.nome`/`clientes.preferencias_json`. É o mecanismo de escrita que faltava para `preferencias_json` ter uso real (ver nota deixada na tarefa 0016 — produto favorito é inferido de `itens_pedido`, mas uma preferência *declarada* precisa dessa tool). Risco baixo (não é ação financeira), mas ainda exige a permissão `ia_permissoes.atualizar_cliente` explícita (CLAUDE.md regra 2) e nunca deve sobrescrever `telefone`/`whatsapp_id` (identidade do cliente, imutável por essa via).
