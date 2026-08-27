# Salvar endereço do cliente e confirmar reuso no próximo pedido

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Requer schema novo — hoje `clientes` não tem campo de endereço nenhum, só `pedidos.endereco_json` (por pedido, nunca reaproveitado). Precisa decidir na implementação: campo único (`clientes.endereco_json`, um endereço padrão) ou suporte a múltiplos endereços salvos (tabela própria, ex. `enderecos_cliente`) — e o fluxo de confirmação quando já existe endereço salvo ("entregar no mesmo endereço de sempre, [endereço]?" em vez de pedir tudo de novo).
