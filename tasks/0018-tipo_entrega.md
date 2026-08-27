# Perguntar tipo de entrega (retirada vs. entrega) antes de endereço

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Decisão determinística de fluxo — só faz sentido pedir endereço se o tipo escolhido for "entrega" (`pedidos.tipo_entrega` já existe no schema: `entrega`/`retirada`, migration `0008_fase3_pedidos.sql`). Precisa virar uma pergunta natural no fluxo do Atendente antes de avançar pro endereço.

**CLAUDE.md regra 8:** `tipo_entrega` é um campo do mesmo Order Context (`OrderContext.tipo_entrega`, `packages/shared/src/pedido-ia.ts`) que a tarefa 0063 já expõe pra edição humana via UI — o endpoint de escrita (`PUT /atendimentos/:id/carrinho/entrega`) e o controle na UI cobrem esse campo independente de quando o fluxo conversacional da IA (esta tarefa) for implementado. Confirmar que os dois caminhos (IA perguntando, humano editando na UI) escrevem no mesmo lugar sem conflito.

## Resolução

Nova tool `definir_tipo_entrega` (`apps/ai-orchestrator/src/tools/carrinho.ts`) — recebe `entrega`/`retirada`, grava em `OrderContext.tipo_entrega`, e limpa `endereco` automaticamente quando `retirada` (mesma regra do endpoint humano `PUT /carrinho/entrega`, confirmando que os dois caminhos escrevem no mesmo estado sem conflito). Regra 10 do Investigador reforçada: perguntar entrega/retirada quando `pendencias` incluir `tipo_entrega` e o carrinho já tiver item, só chamar a tool depois da resposta real do cliente — nunca escolher sozinho nem perguntar de novo o que já foi respondido. A rede de segurança contra loop de ambiguidade (`sintetizarAfirmacaoDeMutacaoCarrinho`, ver tarefa 0054) foi estendida pra cobrir esta tool também.

Nome novo exigiu reescrever o check constraint de `ia_permissoes.ferramenta` — `supabase/migrations/0014_definir_tipo_entrega.sql` (**precisa ser rodada manualmente no SQL Editor do Supabase**) e `NOMES_FERRAMENTAS` (`packages/shared/src/ia-config.ts`). Toggle adicionado ao grupo "Carrinho" na tela Configurações → IA. Gabarito: 1 caso novo confirmando a proteção contra loop também pra esta tool — 48/48 casos determinísticos passando.

Fora de escopo (pertence à 0020): salvar o endereço em si quando `tipo_entrega === "entrega"` — a IA ainda não tem tool pra registrar endereço, só o humano via UI (0063).
