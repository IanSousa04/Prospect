# Confirmação explícita do pedido + criação real em `pedidos`/`itens_pedido`

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`criar_pedido` — tool de escrita (0017)](0017-tool_escrita.md), passo 3 de 3
**Depende de:** [Order Context (0053)](0053-order_context.md), [Tools de carrinho (0054)](0054-tools_carrinho.md), [Tipo de entrega (0018)](0018-tipo_entrega.md), [Forma de pagamento (0019)](0019-forma_pagamento.md)

**Regra crítica de segurança, já alinhada com CLAUDE.md regra 6:** nunca finalizar automaticamente só porque aparentemente todas as informações foram coletadas. Precisa existir uma etapa explícita de confirmação (`CONFIRMANDO_PEDIDO`) — "quero 2 X-Bacon" ou "pode adicionar uma Coca" nunca significam "finalize o pedido"; só uma confirmação explícita do cliente após o resumo apresentado ("pode finalizar", "é isso") gera `ORDER_CONFIRMED`. Ação irreversível com impacto financeiro real — exige confiança alta + baixo risco + permissão explícita (CLAUDE.md regra 6), nunca só "confiança alta" sozinha.

Ao confirmar, a tool `confirm_order` cria de fato o pedido (reaproveitando a mesma lógica de `POST /pedidos` em `apps/api/src/routes/pedidos.ts` — idealmente extraída pra uma função compartilhada chamável tanto pela rota HTTP quanto pela tool, em vez de duplicar a lógica de montagem/total). Depende de `ia_permissoes.criar_pedido` (já existe como linha na tabela) e do estado de risco real (ver tarefa 0023, hoje `agent/decisao.ts` sempre assume risco "baixo" porque não havia tool de escrita nenhuma) — sem 0023 implementada primeiro (ou em paralelo), esta tool roda com risco subestimado.
