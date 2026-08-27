# Order Context — estado estruturado do pedido em construção

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), passo 1 de 3

Primeiro passo do ciclo comercial da IA: modelar o **Order Context** por atendimento — status do pedido (`NOVO` → `MONTANDO` → `REVISANDO` → `DEFININDO_ENTREGA` → `DEFININDO_ENDERECO` → `DEFININDO_PAGAMENTO` → `CONFIRMANDO` → `FINALIZADO`), carrinho (itens/quantidades/subtotal), entrega (tipo/endereço), pagamento (forma), confirmação (booleano). Vive em `ia_sessoes.estado_json` (mesma linha/tabela usada por `estado_json.ultimo_produto_mencionado`, ver `apps/ai-orchestrator/src/agent/sessao.ts` e a nota deixada na tarefa 0011).

Os estados **não são lineares**: o cliente pode fornecer várias informações de uma vez ("quero 2 pizzas, no Pix, entrega na minha casa") e o orquestrador precisa extrair tudo de uma vez, sem perguntar de novo o que já foi dito. Em vez de "próxima pergunta fixa", modelar como **conjunto de informações obrigatórias pendentes** (`nextRequiredInformation()`): produtos, quantidades, confirmação do carrinho, tipo de entrega, endereço (se aplicável), forma de pagamento, confirmação final — o agente calcula o que falta e conversa naturalmente para obter só isso.

Este passo entrega só a estrutura de dados + função de "o que falta" — as tools que efetivamente mutam esse estado (carrinho) são a tarefa 0054; a etapa de confirmação/criação real do pedido é a 0055.

**Resolução:** `apps/ai-orchestrator/src/agent/pedido-contexto.ts` define `OrderContext` (status, `itens: ItemCarrinho[]` — mesmo shape de `ItemMontado` de `@prospect/pedidos-core`, `carrinho_confirmado`, `tipo_entrega`, `endereco`, `forma_pagamento`, `confirmado`), `pedidoVazio()` (estado inicial), `calcularSubtotal()` (derivado dos itens, nunca persistido separadamente — evita ficar desatualizado) e `informacoesPendentes()` (retorna o **conjunto** de pendências, não uma pergunta fixa — `produtos` > `confirmar_carrinho` > `tipo_entrega` > `endereco` (só se `tipo_entrega === "entrega"`) > `forma_pagamento` > `confirmacao_final`, essa última só quando mais nenhuma pendência resta, nunca em paralelo — CLAUDE.md regra 6).

Persistência em `apps/ai-orchestrator/src/agent/sessao.ts`: `EstadoSessao` ganhou o campo `pedido?: OrderContext`, e o load/save foi refatorado pra mesclar (`lerEstadoBruto` + `mesclarEstado`) em vez de sobrescrever `estado_json` inteiro — bug real que existia desde a tarefa 0011 (o `upsert` de `atualizarSessaoComEvidencias` substituía a linha inteira; sem o fix, salvar `pedido` mais tarde apagaria `ultimo_produto_mencionado` e vice-versa). `carregarPedidoEmConstrucao(ctx)` retorna sempre um `OrderContext` válido (nunca `null` — `pedidoVazio()` como default), pronto pra tarefa 0054 usar como ponto de partida das tools de carrinho.

Deliberadamente **não** wired ao Investigador/prompt ainda — sem tools de carrinho (0054), o Order Context nunca sai do estado vazio, então expor isso ao LLM agora não teria efeito nenhum.

**Gabarito (`apps/ai-orchestrator/src/eval/deterministicos.ts`):** 6 casos novos cobrindo `informacoesPendentes()`/`calcularSubtotal()` — pedido vazio só pede `produtos`; carrinho com item pede confirmar carrinho + tipo de entrega + pagamento, nunca endereço antes de saber o tipo; `retirada` nunca exige endereço; `entrega` sem endereço bloqueia a confirmação final; `confirmacao_final` só aparece quando mais nenhuma pendência resta (CLAUDE.md regra 6); soma de subtotal com adicionais de opção. 33/33 casos determinísticos do gabarito passando (`npm run -w apps/ai-orchestrator eval`, seção determinística).
