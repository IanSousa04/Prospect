# Impressão do pedido em modo bobina (cozinha/entregador), só frontend

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)

Botão "Imprimir" no pedido (tela de Atendimento e/ou página de listagem, 0069) gera uma via em formato de bobina térmica (largura estreita, tipografia monoespaçada/grande, sem elementos de UI) pra levar pra cozinha e pro entregador. **Decisão confirmada com o usuário: um ticket só**, com tudo (itens + personalizações/observações + endereço + telefone + forma de pagamento) — não dois formatos separados.

## Decisões de implementação

- **Só frontend, sem backend novo** — usa os dados que a tela de Atendimento/Pedidos já tem carregado (`PedidoDetalhado`, já inclui itens/opções). Nenhuma rota nova necessária.
- Layout responsivo simulando bobina: largura fixa pequena (ex. `58mm`/`80mm`, os dois tamanhos reais mais comuns de impressora térmica — decidir um padrão, ex. 80mm, ou deixar configurável depois), fonte monoespaçada, sem cores (impressora térmica é P&B), sem imagens.
- Implementação via `window.print()` + CSS `@media print` numa view dedicada (ex. um componente `ReciboPedido` renderizado numa rota separada tipo `/pedidos/:id/imprimir`, ou um modal que já nasce com o layout de impressão e só aparece quando `window.print()` é chamado) — `@media screen` esconde o resto da UI (Topbar, sidebar) nessa view, `@media print` define a largura da bobina e remove qualquer coisa que não seja o recibo em si.
- Conteúdo do ticket: nome do cliente + telefone, itens com quantidade/observação/opções escolhidas, subtotal/taxa de entrega/total, tipo de entrega (+ endereço se `entrega`), forma de pagamento, data/hora, e um identificador curto do pedido (não o UUID inteiro — ver padrão já usado de nunca vazar ID técnico pro cliente; aqui é pro operacional interno, então pode ser um código curto derivado, ex. os primeiros 8 caracteres do UUID, ou um número sequencial se existir).
- Testar em pelo menos um navegador via impressão real ou "Salvar como PDF" pra conferir que a largura/quebra de linha ficam corretas — impressoras térmicas não têm preview fácil de simular, then confirmar visualmente que o layout não estoura a largura configurada.
