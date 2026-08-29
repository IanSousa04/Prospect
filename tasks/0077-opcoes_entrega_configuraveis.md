# Opções de entrega (retirada/entrega) configuráveis por empresa

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 3.1 Fechar o ciclo comercial da IA (realizar pedido)
**Resolvido por:** [tarefa 0080](0080-gate_confirmacao_pedido_e_motor_etapas.md)

Hoje `definir_tipo_entrega` (`apps/ai-orchestrator/src/tools/carrinho.ts`) sempre oferece as duas opções, `entrega` e `retirada`, pra qualquer empresa — não existe conceito de uma empresa que só atende balcão (não faz entrega) ou que só trabalha por delivery (não tem local pra retirada). A pergunta "quanto tempo demora meu pedido" já tem esse padrão configurável por empresa (tarefa 0075); esta tarefa é o equivalente pra "como você quer receber o pedido".

## O que já funciona (não é o gap)

A lógica de só pedir endereço quando o tipo for `entrega` já existe e está correta — ver `informacoesPendentes()` em [packages/shared/src/pedido-ia.ts:144](../packages/shared/src/pedido-ia.ts): `if (pedido.tipo_entrega === "entrega" && !pedido.endereco) pendentes.push("endereco")`. Retirada nunca gera pendência de endereço.

## O que fazer

- Nova config por empresa (mesmo padrão de `packages/shared/src/ia-config.ts` — ver `prazo_entrega_modo`/tasks/0075 como referência mais recente): quais tipos de entrega a empresa oferece — `["entrega"]`, `["retirada"]`, ou `["entrega", "retirada"]` (nunca lista vazia; validar no schema).
- A tool `definir_tipo_entrega` deve recusar (ou nem oferecer como opção pro modelo) um tipo que a empresa não configurou — o Investigador nunca pode propor "retirada" pra uma empresa que só faz delivery, e vice-versa.
- Quando só existe uma opção configurada, a IA não deveria nem perguntar — já assume o único tipo disponível automaticamente ao montar o carrinho (mesmo espírito da regra 1 do CLAUDE.md: comportamento determinístico a partir de configuração real, nunca "perguntar por perguntar").
- Toggle na UI (`apps/web/src/pages/ConfiguracoesIa.tsx`, mesma tela de `prazo_entrega_modo`).
- Rodar a skill `food-ai-guardrails` ao final (toca ferramenta de IA/comportamento configurável).

## Resolução

`FluxoPedidoConfig.tipos_entrega_oferecidos` (`packages/shared/src/ia-config.ts`) — exatamente como desenhado acima. `informacoesPendentes()`/`aplicarMutacaoCarrinho()` (`packages/shared/src/pedido-ia.ts`) nunca perguntam quando só há 1 opção (auto-atribuída ao primeiro item do carrinho); `definir_tipo_entrega` (`tools/carrinho.ts`) rejeita um tipo fora do configurado. Toggle na UI (`ConfiguracoesIa.tsx`, seção "Fluxo do pedido"). Ver detalhes completos em `tasks/0080-gate_confirmacao_pedido_e_motor_etapas.md` (implementada junto com o motor de etapas, motivada por um bug real de produção).
