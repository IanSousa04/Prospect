# Perguntar tipo de entrega (retirada vs. entrega) antes de endereço

**Status:** pendente
**Prioridade:** P1
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Decisão determinística de fluxo — só faz sentido pedir endereço se o tipo escolhido for "entrega" (`pedidos.tipo_entrega` já existe no schema: `entrega`/`retirada`, migration `0008_fase3_pedidos.sql`). Precisa virar uma pergunta natural no fluxo do Atendente antes de avançar pro endereço.
