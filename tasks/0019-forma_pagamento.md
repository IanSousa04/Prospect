# Perguntar/confirmar forma de pagamento

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

`pedidos.forma_pagamento` já existe no schema (`dinheiro`/`cartao_credito`/`cartao_debito`/`pix`/`outro`) — falta o fluxo conversacional que pergunta e confirma antes de fechar o pedido. Sem gateway de pagamento real ainda (ver tarefa `Gateway de pagamento real`) — é só registrar a forma escolhida, não cobrar de verdade.

**CLAUDE.md regra 8:** `forma_pagamento` é campo do mesmo Order Context (`packages/shared/src/pedido-ia.ts`) que a tarefa 0063 expõe pra edição humana via UI (`PUT /atendimentos/:id/carrinho/pagamento`) — os dois caminhos (IA perguntando, humano editando) escrevem no mesmo estado.
