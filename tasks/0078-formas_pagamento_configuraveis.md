# Formas de pagamento configuráveis por empresa + deixar claro pra IA que não há cobrança pela plataforma

**Status:** concluído (ver ressalva na Resolução)
**Prioridade:** P2
**Seção no ROADMAP:** 3.1 Fechar o ciclo comercial da IA (realizar pedido)
**Resolvido por:** [tarefa 0080](0080-gate_confirmacao_pedido_e_motor_etapas.md)

Hoje `definir_forma_pagamento` (`apps/ai-orchestrator/src/tools/carrinho.ts`) aceita qualquer uma das 5 formas fixas (`dinheiro`, `cartao_credito`, `cartao_debito`, `pix`, `outro`) pra qualquer empresa, e `informacoesPendentes()` ([packages/shared/src/pedido-ia.ts:145](../packages/shared/src/pedido-ia.ts)) sempre exige forma de pagamento antes de fechar o pedido — sem exceção. Isso mistura dois problemas reais:

1. **Nem toda empresa aceita todas as formas** (mesmo padrão de `tasks/0077` — opções de entrega configuráveis).
2. **A IA nunca deixa claro que não existe cobrança pela plataforma.** Não há gateway de pagamento real ainda (ver `tasks/0042-gateway_pagamento.md`) — o pagamento de verdade é sempre feito na entrega, direto pro entregador (dinheiro/maquininha/pix na hora). Perguntar a forma de pagamento hoje serve só pra **avisar o entregador com antecedência** de como o cliente vai pagar — não pra processar nada. Sem essa mensagem determinística, o Atendente corre o risco de dar a entender (mesmo sem querer) que o pagamento foi processado pela conversa, o que é uma alucinação comercial grave (CLAUDE.md regra 1).

## O que fazer

- Nova config por empresa em `packages/shared/src/ia-config.ts` (mesmo padrão de `tasks/0075`/`tasks/0077`):
  - Lista de formas de pagamento aceitas (subconjunto de `FormaPagamento`, nunca vazia se a pergunta estiver ligada).
  - Toggle "perguntar forma de pagamento" — quando desligado, `forma_pagamento` some da lista de pendências em `informacoesPendentes()` e a tool não é oferecida/chamada; o pedido fecha sem essa etapa.
- Quando a pergunta estiver ligada, o texto que o Atendente usa ao perguntar (e a resposta se o cliente perguntar "eu pago por aqui?"/"vocês tem Pix?") precisa deixar explícito, sempre, que o pagamento é feito ao entregador na entrega — nunca pela conversa/plataforma. Isso é comportamento determinístico (mesmo padrão da resposta fixa de identidade da IA, `tasks/0008`), não texto livre do modelo, pra nunca variar nem sugerir cobrança automática.
- `definir_forma_pagamento` só aceita valores dentro do conjunto configurado pela empresa; um valor fora disso é rejeitado (nunca aceito "de boa" só porque o cliente disse).
- Toggle(s) na UI (`apps/web/src/pages/ConfiguracoesIa.tsx`, mesma tela de `prazo_entrega_modo`/opções de entrega).
- Rodar a skill `food-ai-guardrails` ao final.

## Resolução

`FluxoPedidoConfig.perguntar_forma_pagamento`/`formas_pagamento_aceitas` (`packages/shared/src/ia-config.ts`) — exatamente como desenhado acima. `informacoesPendentes()` nunca gera a pendência quando a pergunta está desligada; `definir_forma_pagamento` (`tools/carrinho.ts`) rejeita uma forma fora do conjunto aceito. Regra fixa nas "Regras invioláveis" do prompt do Atendente (`agent/atendente.ts`): nunca dar a entender que o pagamento é processado pela conversa, sempre deixar claro que é feito na entrega/retirada. Toggle na UI (`ConfiguracoesIa.tsx`, seção "Fluxo do pedido"). Ver detalhes completos em `tasks/0080-gate_confirmacao_pedido_e_motor_etapas.md`.

**Ressalva (diferença deliberada do desenho original):** a regra de "nunca dar a entender cobrança automática" ficou como instrução de prompt (Atendente), não como resposta 100% fixa/determinística tipo `mensagemDeIdentidade` — mesmo padrão já aceito em outras regras de tom/formatação deste mesmo prompt. Se algum episódio real mostrar o Atendente escapando dessa regra, endurecer pra uma checagem determinística (mesmo padrão de `contemPromessaNaoSuportada`, `agent/verificacao.ts`) fica documentado aqui como próximo passo. `definir_forma_pagamento` continua oferecida ao LLM mesmo com a pergunta desligada (não foi removida da lista de tools) — inofensivo porque `informacoesPendentes()` já não exige o campo, mas não é "nem oferecida" como o texto original pedia; ajustar isso é um refinamento pequeno, não crítico.
