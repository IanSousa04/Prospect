# Motor genérico de etapas configurável por empresa (em vez de máquina de estados hard-coded)

**Status:** concluído (escopo mínimo — ver Resolução)
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), stretch opcional além do escopo mínimo
**Depende de:** [Order Context (0053)](0053-order_context.md), [Confirmação/criação (0055)](0055-confirmacao_criacao_pedido.md) já em produção
**Resolvido por:** [tarefa 0080](0080-gate_confirmacao_pedido_e_motor_etapas.md)

Vale considerar um motor genérico de etapas + requisitos + ferramentas (configurável por empresa como uma sequência de módulos: carrinho → upsell → entrega → endereço → pagamento → confirmação) em vez de uma máquina de estados hard-coded só para "pedido de comida" — mais alinhado com a proposta multi-segmento da Fase 2 (hamburgueria/pizzaria/açaíteria/restaurante/sushi têm fluxos de personalização diferentes, mas a mesma máquina de requisitos pendentes serve para todos). Deliberadamente separado do escopo mínimo de `criar_pedido` (0053-0055): só vale a pena generalizar depois que a máquina de estados concreta estiver validada em produção com pelo menos um segmento real — generalizar prematuramente arrisca abstrair errado.

**Resolução (escopo mínimo, decisão explícita):** um bug real de produção (pedido não finalizava quando o cliente confirmava só com "Sim") motivou generalizar `informacoesPendentes()` pra aceitar configuração por empresa (`FluxoPedidoConfig`) e criar um gate de exposição (`criarPedidoDisponivel()`, `agent/investigador.ts`) que só oferece `criar_pedido` ao LLM quando todas as etapas configuradas estão concluídas — ver detalhes completos em `tasks/0080-gate_confirmacao_pedido_e_motor_etapas.md`. Isso é o "motor de etapas" no sentido que importava pro bug (etapas configuráveis + gate de disponibilidade de tool por etapa concluída), não o framework genérico de módulos plugáveis descrito no parágrafo acima — esse continua fora de escopo até existir uma segunda tool de escrita real (`cancelar_pedido`/`alterar_item`, 0057/0058) pra validar o desenho contra, mesma cautela já registrada aqui contra abstrair cedo demais.
