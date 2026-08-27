# Motor genérico de etapas configurável por empresa (em vez de máquina de estados hard-coded)

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), stretch opcional além do escopo mínimo
**Depende de:** [Order Context (0053)](0053-order_context.md), [Confirmação/criação (0055)](0055-confirmacao_criacao_pedido.md) já em produção

Vale considerar um motor genérico de etapas + requisitos + ferramentas (configurável por empresa como uma sequência de módulos: carrinho → upsell → entrega → endereço → pagamento → confirmação) em vez de uma máquina de estados hard-coded só para "pedido de comida" — mais alinhado com a proposta multi-segmento da Fase 2 (hamburgueria/pizzaria/açaíteria/restaurante/sushi têm fluxos de personalização diferentes, mas a mesma máquina de requisitos pendentes serve para todos). Deliberadamente separado do escopo mínimo de `criar_pedido` (0053-0055): só vale a pena generalizar depois que a máquina de estados concreta estiver validada em produção com pelo menos um segmento real — generalizar prematuramente arrisca abstrair errado.
