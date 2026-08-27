# Tools de carrinho (`add_to_cart`, `remove_from_cart`, `update_cart_item`, `get_cart`, `calculate_cart`)

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), passo 2 de 3
**Depende de:** [Order Context (0053)](0053-order_context.md)

O LLM não deve gerar/mexer diretamente no JSON do pedido — deve chamar ferramentas de carrinho, no mesmo padrão de ferramenta-com-fonte-real já usado no restante da camada de IA (nunca confiar cegamente em JSON gerado livremente pelo modelo). Cada tool muta o carrinho dentro do Order Context (0053) e reaproveita a montagem de item com snapshot de preço já existente em `montarItensComSnapshot` (`packages/pedidos-core`, hoje usada só por `POST /pedidos` em `apps/api/src/routes/pedidos.ts`) — o preço/nome do produto no carrinho nunca é digitado livremente pela IA, sempre vem de uma consulta real ao catálogo (CLAUDE.md regra 1).

Tools: `add_to_cart`, `remove_from_cart`, `update_cart_item` (mudar quantidade/observação), `get_cart` (resumo pro cliente), `calculate_cart` (subtotal, sem taxa de entrega ainda — isso entra quando tipo de entrega/endereço forem definidos, ver tarefas 0018/0020). Sugestões de upsell/cross-sell são uma **política de venda opcional aplicada sobre o carrinho**, não uma etapa obrigatória — recusar uma sugestão nunca muda o estado do pedido.
