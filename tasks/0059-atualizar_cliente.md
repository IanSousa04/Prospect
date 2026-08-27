# Tool `atualizar_cliente`

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [Tools de escrita restantes (0021)](0021-tools_escrita_restantes.md)

Sem executor registrado hoje, só existe como nome no enum `NOMES_FERRAMENTAS`. Escopo: a IA gravar dado declarado explicitamente pelo cliente sobre si mesmo (nome, uma preferência dita em texto livre — ex.: "não gosto de cebola") em `clientes.nome`/`clientes.preferencias_json`. É o mecanismo de escrita que faltava para `preferencias_json` ter uso real (ver nota deixada na tarefa 0016 — produto favorito é inferido de `itens_pedido`, mas uma preferência *declarada* precisa dessa tool). Risco baixo (não é ação financeira), mas ainda exige a permissão `ia_permissoes.atualizar_cliente` explícita (CLAUDE.md regra 2) e nunca deve sobrescrever `telefone`/`whatsapp_id` (identidade do cliente, imutável por essa via).

**CLAUDE.md regra 8 — gap real, ainda sem tarefa própria:** diferente de `cancelar_pedido`/`adicionar_item` (que reaproveitam UI de pedido já existente ou planejada), `clientes.preferencias_json` **não tem nenhuma UI de edição hoje** — a tela de Clientes (`apps/web/src/pages/Clientes.tsx`) só lista, não edita (ver nota já deixada em `tasks/0016-crm_personalizacao.md` sobre `tags` também não ter edição manual). Antes de implementar esta tool, criar/confirmar uma tarefa de UI companheira pra editar nome/preferências/tags do cliente na tela de Clientes ou de Atendimento — sem isso, um humano não consegue corrigir uma preferência que a IA gravou errado.

**Atualização (tarefa 0020):** o mesmo gap agora também vale pra `clientes.endereco_json` (endereço salvo, gravado pela tool `definir_endereco_entrega`) — mais um campo gerenciado pela IA sem UI de edição humana. Quando a tarefa de UI companheira for desenhada, cobrir os três campos juntos (`tags`, `preferencias_json`, `endereco_json`) na mesma tela em vez de três esforços separados.
