# `criar_pedido` — tool de escrita com fluxo conversacional guiado, orientado a estado estruturado (não histórico de chat)

**Status:** desmembrada em subtarefas (ver abaixo) — este arquivo é a referência de desenho, não é mais item avulso do ROADMAP
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

**Desmembrada em (2026-08-27, épico de 13 SP quebrado em subtarefas menores):**
1. [Order Context — estado estruturado do pedido (0053)](0053-order_context.md) — `SP: 5`
2. [Tools de carrinho (0054)](0054-tools_carrinho.md) — `SP: 5`
3. [Confirmação explícita + criação real do pedido (0055)](0055-confirmacao_criacao_pedido.md) — `SP: 3`
4. [Motor genérico de etapas configurável (0056)](0056-motor_generico_etapas.md) — `SP: 5`, stretch opcional além do escopo mínimo acima

O desenho de arquitetura abaixo continua sendo a referência completa consultada pelas 4 subtarefas — não duplicado nelas.

Desenho de arquitetura já discutido e aprovado para servir de base à implementação:

- A IA não deve "lembrar" em que etapa do pedido está apenas pelo histórico da conversa — isso deve ser dado estruturado, um **Order Context** por atendimento (equivalente ao que `ia_sessoes.estado_json` já reserva espaço para guardar, ver tarefa `ia_sessoes em uso`): status do pedido (`NOVO` → `MONTANDO` → `REVISANDO` → `DEFININDO_ENTREGA` → `DEFININDO_ENDERECO` → `DEFININDO_PAGAMENTO` → `CONFIRMANDO` → `FINALIZADO`), carrinho (itens/quantidades/subtotal), entrega (tipo/endereço), pagamento (forma), confirmação (booleano). Esses estados **não são lineares**: o cliente pode fornecer várias informações de uma vez ("quero 2 pizzas, no Pix, entrega na minha casa") e o orquestrador deve extrair tudo de uma vez, sem perguntar de novo o que já foi dito.
- Em vez de modelar como "próxima pergunta fixa", modelar como **conjunto de informações obrigatórias pendentes** (`nextRequiredInformation()`): produtos, quantidades, confirmação do carrinho, tipo de entrega, endereço (se aplicável), forma de pagamento, confirmação final. O agente calcula o que falta e conversa naturalmente para obter só isso.
- O LLM não deve gerar/mexer diretamente no JSON do pedido — deve chamar ferramentas (`add_to_cart`, `remove_from_cart`, `update_cart_item`, `get_cart`, `calculate_cart`, `set_delivery_type`, `set_delivery_address`, `set_payment_method`, `confirm_order`), no mesmo padrão de ferramenta-com-fonte-real já usado no restante da camada de IA (nunca confiar cegamente em JSON gerado livremente pelo modelo).
- Sugestões de upsell/cross-sell são uma **política de venda opcional aplicada sobre o carrinho**, não uma etapa obrigatória do fluxo — recusar uma sugestão não muda o estado do pedido.
- **Regra crítica de segurança, já alinhada com CLAUDE.md regra 6:** nunca finalizar automaticamente só porque aparentemente todas as informações foram coletadas. Deve existir uma etapa explícita de confirmação (`CONFIRMANDO_PEDIDO`) — "quero 2 X-Bacon" ou "pode adicionar uma Coca" nunca significam "finalize o pedido"; só uma confirmação explícita do cliente após o resumo apresentado ("pode finalizar", "é isso") deve gerar `ORDER_CONFIRMED`. Ação irreversível com impacto financeiro real — exige confiança alta + baixo risco + permissão explícita (CLAUDE.md regra 6), nunca só "confiança alta" sozinha.
- Depende de `ia_permissoes.criar_pedido` (já existe como linha na tabela; campos `exige_confirmacao_humana`/`valor_maximo_sem_handoff` já existem no schema mas nenhum é lido em código — ver tarefa `Risco real na matriz de decisão`) e do estado de risco real (`agent/decisao.ts` hoje sempre assume risco "baixo" porque não há tool de escrita nenhuma).
- Vale considerar, ao desenhar a implementação, um motor genérico de etapas + requisitos + ferramentas (configurável por empresa como uma sequência de módulos: carrinho → upsell → entrega → endereço → pagamento → confirmação) em vez de uma máquina de estados hard-coded só para "pedido de comida" — mais alinhado com a proposta multi-segmento da Fase 2 (hamburgueria/pizzaria/açaíteria/restaurante/sushi têm fluxos de personalização diferentes, mas a mesma máquina de requisitos pendentes serve para todos).

**Nota da tarefa `ia_sessoes em uso` (0011):** ao implementar esta tarefa, o "carrinho em construção" e a "confirmação pendente com hash" (ambos citados na 0011 como uso pretendido de `ia_sessoes.estado_json`) foram deliberadamente deixados de fora daquela implementação e ficam por conta desta tarefa — não faria sentido modelar esse estado sem o desenho de Order Context acima já definido. A 0011 implementou só `estado_json.ultimo_produto_mencionado` (ver `apps/ai-orchestrator/src/agent/sessao.ts`); ao desenhar o Order Context, é natural que ele passe a conviver no mesmo `estado_json` dessa sessão (mesma linha, mesma tabela, unique em `atendimento_id`).
