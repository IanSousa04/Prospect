# Página com filtros pra listar todos os pedidos

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)

Hoje não existe nenhuma tela dedicada a listar pedidos — só dá pra ver o pedido de um atendimento específico (painel na tela de Atendimento) ou criar um novo (`PedidoBuilder`). `GET /pedidos` (`apps/api/src/routes/pedidos.ts`) já existe e já aceita filtro por `cliente_id`/`atendimento_id`, mas nenhuma UI usa isso pra uma listagem geral.

## Escopo

- Nova página `apps/web/src/pages/Pedidos.tsx` (+ rota/link na `Topbar`), tabela com: cliente, itens (resumo), status (com a mesma paleta de cor já usada no Kanban unificado — ver 0067), total, forma de pagamento, tipo de entrega, data.
- Filtros: status (`em_preparacao`/`pronto`/`entregue`/`cancelado`, pós-0065), intervalo de data (`criado_em`), tipo de entrega, forma de pagamento, busca por cliente (nome/telefone).
- `GET /pedidos` precisa ganhar esses filtros novos (hoje só tem `cliente_id`/`atendimento_id`) — adicionar `status`, `data_inicio`/`data_fim`, `tipo_entrega`, `forma_pagamento`, `busca` como query params, sempre escopados por `empresa_id` (isolamento multi-tenant já garantido pelo `requireAuth`, manter).
- Paginação — decidir na implementação se cursor-based ou offset simples (`limit`/`offset`); dado o volume esperado (empresas piloto, não milhões de pedidos), offset simples é suficiente por ora.
- Clicar num pedido leva pro atendimento relacionado (`atendimento_id`) se existir, ou mostra detalhe inline se o pedido não tiver atendimento (ex.: criado direto pelo painel sem conversa).
