# Tools de carrinho (`add_to_cart`, `remove_from_cart`, `update_cart_item`, `get_cart`, `calculate_cart`)

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), passo 2 de 3
**Depende de:** [Order Context (0053)](0053-order_context.md)

O LLM não deve gerar/mexer diretamente no JSON do pedido — deve chamar ferramentas de carrinho, no mesmo padrão de ferramenta-com-fonte-real já usado no restante da camada de IA (nunca confiar cegamente em JSON gerado livremente pelo modelo). Cada tool muta o carrinho dentro do Order Context (0053) e reaproveita a montagem de item com snapshot de preço já existente em `montarItensComSnapshot` (`packages/pedidos-core`, hoje usada só por `POST /pedidos` em `apps/api/src/routes/pedidos.ts`) — o preço/nome do produto no carrinho nunca é digitado livremente pela IA, sempre vem de uma consulta real ao catálogo (CLAUDE.md regra 1).

Tools: `add_to_cart`, `remove_from_cart`, `update_cart_item` (mudar quantidade/observação), `get_cart` (resumo pro cliente), `calculate_cart` (subtotal, sem taxa de entrega ainda — isso entra quando tipo de entrega/endereço forem definidos, ver tarefas 0018/0020). Sugestões de upsell/cross-sell são uma **política de venda opcional aplicada sobre o carrinho**, não uma etapa obrigatória — recusar uma sugestão nunca muda o estado do pedido.

**Resolução:** implementadas em `apps/ai-orchestrator/src/tools/carrinho.ts`, com nomes em português (convenção do resto das ~19 ferramentas do domínio) e **4 tools, não 5**: `adicionar_ao_carrinho`, `remover_do_carrinho`, `atualizar_item_carrinho`, `consultar_carrinho` — esta última já devolve o subtotal calculado, então não existe uma tool separada equivalente a "calculate_cart" (nunca faria sentido o LLM pedir "calcule o carrinho" sem também querer ver os itens).

- Toda adição/atualização passa por `montarItensComSnapshot` (`@prospect/pedidos-core`, mesma função de `POST /pedidos`) — preço, nome e disponibilidade sempre revalidados no catálogo real no momento da chamada, nunca herdados de uma busca anterior do LLM.
- `ItemCarrinho` (0053) ganhou o campo `linha_id` (gerado com `randomUUID()`, nunca pelo LLM) — necessário pra remover/atualizar uma linha sem ambiguidade quando o mesmo produto aparece mais de uma vez no carrinho com personalizações diferentes. É um detalhe técnico confinado ao Investigador/tools, nunca chega ao Atendente nem ao cliente (CLAUDE.md regra 3).
- Qualquer mutação invalida `carrinho_confirmado` e ajusta `status` (`aplicarMutacaoCarrinho`, movida pra `pedido-contexto.ts` como função pura testável sem banco) — CLAUDE.md regra 6: nunca herdar confirmação de um carrinho que já mudou.
- Persistência via `salvarPedidoEmConstrucao`/`carregarPedidoEmConstrucao` (`agent/sessao.ts`).
- **Schema**: os 4 nomes novos exigiram reescrever o check constraint de `ia_permissoes.ferramenta` — `supabase/migrations/0013_carrinho_ferramentas.sql` (**precisa ser rodada manualmente no SQL Editor do Supabase**, mesmo padrão das migrations anteriores) e `NOMES_FERRAMENTAS` (`packages/shared/src/ia-config.ts`). Sem a migration aplicada, as tools ficam registradas em código mas indisponíveis pra qualquer empresa (nenhuma linha em `ia_permissoes` bate com o check constraint antigo).
- Prompt do Investigador (`agent/investigador.ts`) ganhou a regra 10 (uso das tools de carrinho, nunca calcular de memória, sempre citar `pendencias` do resultado como afirmação `generico` pro Atendente saber o que perguntar em seguida) — a regra de `comportamento_json` (antes "10") virou "11".
- Gabarito: 9 casos novos em `apps/ai-orchestrator/src/eval/deterministicos.ts` (Order Context + `aplicarMutacaoCarrinho`), 36/36 casos determinísticos passando.
