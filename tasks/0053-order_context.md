# Order Context — estado estruturado do pedido em construção

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), passo 1 de 3

Primeiro passo do ciclo comercial da IA: modelar o **Order Context** por atendimento — status do pedido (`NOVO` → `MONTANDO` → `REVISANDO` → `DEFININDO_ENTREGA` → `DEFININDO_ENDERECO` → `DEFININDO_PAGAMENTO` → `CONFIRMANDO` → `FINALIZADO`), carrinho (itens/quantidades/subtotal), entrega (tipo/endereço), pagamento (forma), confirmação (booleano). Vive em `ia_sessoes.estado_json` (mesma linha/tabela usada por `estado_json.ultimo_produto_mencionado`, ver `apps/ai-orchestrator/src/agent/sessao.ts` e a nota deixada na tarefa 0011).

Os estados **não são lineares**: o cliente pode fornecer várias informações de uma vez ("quero 2 pizzas, no Pix, entrega na minha casa") e o orquestrador precisa extrair tudo de uma vez, sem perguntar de novo o que já foi dito. Em vez de "próxima pergunta fixa", modelar como **conjunto de informações obrigatórias pendentes** (`nextRequiredInformation()`): produtos, quantidades, confirmação do carrinho, tipo de entrega, endereço (se aplicável), forma de pagamento, confirmação final — o agente calcula o que falta e conversa naturalmente para obter só isso.

Este passo entrega só a estrutura de dados + função de "o que falta" — as tools que efetivamente mutam esse estado (carrinho) são a tarefa 0054; a etapa de confirmação/criação real do pedido é a 0055.
