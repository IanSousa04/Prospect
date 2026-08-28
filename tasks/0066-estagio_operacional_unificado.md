# Estágio operacional unificado (deriva o "estágio do board" a partir de atendimento + pedido) + arquivamento

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)
**Depende de:** [Mesclar solicitou humano (0064)](0064-mesclar_solicitou_humano.md), [Simplificar StatusPedido (0065)](0065-simplificar_status_pedido.md)

Núcleo do pedido do usuário (item 2): hoje `atendimentos.status` e `pedidos.status` são conceitos completamente separados — um atendimento marcado `resolvido` "some" do radar operacional mesmo que o pedido ainda esteja sendo preparado, e não existe nenhum lugar que mostre a jornada completa (conversa → pedido) como uma coisa só. **Decisão confirmada com o usuário:** o Kanban vira um board único, com o card passando de estágios de conversa pros estágios de pedido, sem duplicar/misturar `atendimentos.status` e `pedidos.status` como fontes de verdade — cada tabela mantém seu próprio status (motivos: `pedidos.status` já é consumido por outras telas/rotas isoladamente, ex. `POST /pedidos/:id/status`; misturar os dois numa coluna só quebraria isso). Em vez disso, o **estágio do board é um valor DERIVADO**, calculado a partir dos dois, nunca uma terceira fonte de verdade gravada em disco.

## Regra de derivação (`EstagioOperacional`)

```
"ia_atendendo" | "solicitou_humano" | "humano_atendendo" | "em_preparacao" | "pronto" | "entregue" | "cancelado"
```

1. Se existe um `pedido_aberto` (não cancelado) neste atendimento → o estágio é o `pedidos.status` dele, direto (`em_preparacao` | `pronto` | `entregue`).
2. Se existe um pedido cancelado mais recente que qualquer pedido ativo (ou é o único) → `cancelado`.
3. Se não existe nenhum pedido → o estágio é o `atendimentos.status` (já reduzido pela 0064: `ia_atendendo` | `solicitou_humano` | `humano_atendendo` | `resolvido`).
4. `resolvido` **não é um estágio do board** — ver arquivamento abaixo.

## Arquivamento (decisão confirmada com o usuário)

- Uma conversa que a IA/um humano finaliza (`status = resolvido`) **sem nunca ter gerado pedido** desaparece do board automaticamente — não precisa de ação manual nem coluna própria.
- Uma conversa em `humano_atendendo` **fica na coluna até alguém clicar "Finalizar" manualmente** — nunca some sozinha (o humano precisa confirmar que encerrou de verdade).
- Um pedido `cancelado` **fica visível no board**, com estilo visual distinto (ex.: opacidade reduzida, riscado, badge "Cancelado" — ver tarefa 0067 pro visual exato), com uma ação explícita "Arquivar" pra sair da visão ativa.
- Por consistência com `cancelado`, pedidos `entregue` também merecem a mesma opção de "Arquivar" (não foi pedido explicitamente pelo usuário, mas seguir o mesmo padrão evita que a coluna "Entregue" cresça pra sempre sem limpeza — confirmar com o usuário se aceita estender ou se prefere outro critério, ex. auto-arquivar depois de X horas).

## Escopo de implementação

- Campo novo `arquivado_em timestamptz` (nullable) em `pedidos` (e, se uma conversa sem pedido puder ser "arquivada" manualmente também — hoje não pode, só desaparece sozinha ao resolver — não precisa em `atendimentos`).
- `GET /atendimentos` (`apps/api/src/routes/atendimentos.ts`) — computa e retorna `estagio_operacional` por linha, e filtra fora (por padrão) atendimentos `resolvido` sem pedido, e pedidos com `arquivado_em` preenchido.
- Endpoint novo `POST /pedidos/:id/arquivar` (só permitido em `entregue`/`cancelado` — nunca em pedido ativo).
- Tipos em `packages/shared` — novo `EstagioOperacional` export.

Esta tarefa entrega só a lógica de derivação + arquivamento (backend); a reconstrução visual do Kanban com as 7 colunas é a tarefa [0067](0067-kanban_unificado.md).
