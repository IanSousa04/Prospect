# `ia_sessoes` em uso (memória derivada da conversa)

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

`ia_sessoes` existe no schema (migration `0009_ia_fundacao.sql`) mas nunca é lida nem escrita em código. O "carrinho em construção", "último produto mencionado", "confirmação pendente com hash" (ver seção 3, desenho de fluxo de pedido) não existem de fato ainda. Item P1 porque habilita o P0 de memória completa quando o histórico cru não couber no prompt.
