# Alinhar a matriz de decisão com a spec: "confiança média → investigar mais"

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

Implementado dentro de `investigar()` (`agent/investigador.ts`), não em `decisao.ts` — o loop de chamada de ferramenta foi extraído pra `rodarFerramentas()` (reutilizável) e, quando a primeira passagem termina com `computeConfianca === "media"`, o Investigador recebe um empurrão explícito ("tente confirmar com mais uma ferramenta relacionada, se fizer sentido") e roda até `MAX_ITERACOES_CONFIRMACAO = 2` rodadas extras antes de gerar o relatório final de novo. Se achar uma segunda fonte real, a cobertura sobe e a confiança recalculada em `orquestrador.ts` pode virar "alta"; se genuinamente não houver outra fonte, mantém "media" sem forçar uma chamada inútil só por chamar. Testado manualmente (produto real): a segunda rodada de fato chamou uma ferramenta adicional antes de concluir. Custo: ~2x a latência nos casos que caem em "media" (~13s vs ~7s observado) — aceito como trade-off do próprio pedido da spec. `decisao.ts` continua igual (média/alta ainda respondem direto) — decisão deliberada: com a rodada extra, "media" que persiste já é o melhor esforço possível, não faz sentido tratar diferente de "alta" depois disso.
