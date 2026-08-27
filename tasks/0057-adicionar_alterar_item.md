# Tools `adicionar_item` / `alterar_item` (mudar um pedido já em andamento)

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [Tools de escrita restantes (0021)](0021-tools_escrita_restantes.md)
**Depende de:** `criar_pedido` validado em produção (0053-0055)

Diferente das tools de carrinho da 0054 (que mutam o Order Context **antes** de o pedido existir), estas mudam um pedido **já criado** em `pedidos`/`itens_pedido` — cenário "quero adicionar uma Coca no pedido que acabei de fazer" ou "troca o refrigerante por outro". Nenhuma tem executor registrado hoje, só existem como nome no enum `NOMES_FERRAMENTAS`. Considerar reaproveitar a mesma lógica de edição de itens que a tarefa 0041 (painel humano) vai precisar implementar — dois consumidores (IA e humano) da mesma capacidade de negócio, evitar duas implementações divergentes de "editar itens de um pedido". Sujeito às mesmas regras de transição de `pedidos.status` já existentes (`TRANSICOES` em `apps/api/src/routes/pedidos.ts`) — não editar item de pedido `entregue`/`cancelado`.

**CLAUDE.md regra 8:** a referência a 0041 acima já é exatamente essa garantia — não implementar esta tool sem a UI companheira (0041) também existir, cobrindo o mesmo estado (`itens_pedido`).
