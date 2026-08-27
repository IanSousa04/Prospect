# Perguntar/confirmar forma de pagamento

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

`pedidos.forma_pagamento` já existe no schema (`dinheiro`/`cartao_credito`/`cartao_debito`/`pix`/`outro`) — falta o fluxo conversacional que pergunta e confirma antes de fechar o pedido. Sem gateway de pagamento real ainda (ver tarefa `Gateway de pagamento real`) — é só registrar a forma escolhida, não cobrar de verdade.

**CLAUDE.md regra 8:** `forma_pagamento` é campo do mesmo Order Context (`packages/shared/src/pedido-ia.ts`) que a tarefa 0063 expõe pra edição humana via UI (`PUT /atendimentos/:id/carrinho/pagamento`) — os dois caminhos (IA perguntando, humano editando) escrevem no mesmo estado.

## Resolução

Nova tool `definir_forma_pagamento` (`apps/ai-orchestrator/src/tools/carrinho.ts`) — mesmo padrão de `definir_tipo_entrega`/`definir_endereco_entrega`: grava `OrderContext.forma_pagamento` só depois de pergunta+resposta real (nunca assume/infere), sem cobrança nenhuma. Regra 10 do Investigador reforçada; proteção contra loop de ambiguidade (0054) estendida; nome novo exigiu `supabase/migrations/0016_definir_forma_pagamento.sql` (**rodar manualmente**) + toggle em Configurações → IA. Gabarito: 1 caso novo — 50/50 casos determinísticos passando.

Com isso, as três tarefas P1 da seção "Fechar o ciclo comercial da IA" que faltavam antes da confirmação (0018, 0019, 0020) estão completas — falta só a 0055 (confirmação explícita + criação real do pedido) pra fechar o ciclo de ponta a ponta.
