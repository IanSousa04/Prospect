# Salvar endereço do cliente e confirmar reuso no próximo pedido

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Requer schema novo — hoje `clientes` não tem campo de endereço nenhum, só `pedidos.endereco_json` (por pedido, nunca reaproveitado). Precisa decidir na implementação: campo único (`clientes.endereco_json`, um endereço padrão) ou suporte a múltiplos endereços salvos (tabela própria, ex. `enderecos_cliente`) — e o fluxo de confirmação quando já existe endereço salvo ("entregar no mesmo endereço de sempre, [endereço]?" em vez de pedir tudo de novo).

**CLAUDE.md regra 8:** `endereco` (do pedido em construção) é campo do mesmo Order Context que a tarefa 0063 expõe pra edição humana via UI (`PUT /atendimentos/:id/carrinho/entrega`, junto com `tipo_entrega`) — os dois caminhos (IA perguntando, humano editando) escrevem no mesmo estado. O endereço SALVO do cliente (`clientes.endereco_json` ou tabela própria, escopo desta tarefa) é um dado separado — se essa parte também ganhar UI de gerenciamento (ex. editar endereço salvo do cliente na tela de Clientes), aplicar o mesmo princípio.

## Resolução

**Decisão de escopo (a que o texto original deixou em aberto):** campo único `clientes.endereco_json` (não tabela de múltiplos endereços) — nenhuma tarefa do ROADMAP pediu múltiplos endereços salvos por cliente, resolver essa complexidade só quando a necessidade aparecer de verdade.

- `supabase/migrations/0015_endereco_cliente.sql` — coluna `clientes.endereco_json jsonb` + check constraint de `ia_permissoes.ferramenta` reescrito pra incluir `definir_endereco_entrega`.
- `packages/shared/src/types.ts` — `Cliente.endereco_json: EnderecoEntrega | null`.
- `apps/ai-orchestrator/src/tools/cliente.ts` — `consultar_cliente` agora também retorna `endereco_json`, pra a IA saber se já existe um endereço salvo antes de pedir de novo.
- `apps/ai-orchestrator/src/tools/carrinho.ts` — nova tool `definir_endereco_entrega`: grava o endereço no Order Context (`OrderContext.endereco`, força `tipo_entrega: "entrega"`) **e** salva como endereço padrão do cliente (`clientes.endereco_json`) pra reuso na próxima conversa — é isso que implementa "confirmar reuso no próximo pedido" (da próxima vez, `consultar_cliente` já mostra o endereço salvo).
- Regra 10 do Investigador reforçada: quando `pendencias` incluir `endereco`, checar `consultar_cliente` primeiro e oferecer "entregar no mesmo endereço de sempre, [endereço]?" em vez de pedir tudo de novo; só chamar a tool depois de confirmação real (reuso ou endereço novo completo).
- Proteção contra loop de ambiguidade (0054) estendida pra esta tool também.
- Nome novo exigiu reescrever o check constraint — migration **precisa ser rodada manualmente**. Toggle adicionado ao grupo "Carrinho" em Configurações → IA. Gabarito: 1 caso novo — 49/49 casos determinísticos passando.
- Gap de UI (CLAUDE.md regra 8) registrado em `tasks/0059-atualizar_cliente.md` — endereço salvo do cliente ainda não tem tela de edição humana (mesmo gap já existente pra `tags`/`preferencias_json`).
