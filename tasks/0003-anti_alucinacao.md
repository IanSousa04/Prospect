# Ampliar a verificação anti-alucinação além de `R$`/PDF/código de pedido

**Status:** concluído
**Prioridade:** P0
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

Implementado em duas frentes: (1) `contemValorNaoVerificado` (`agent/verificacao.ts`) agora valida contra a **evidência bruta real** das ferramentas (`investigar()` passou a retornar `{ relatorio, evidencias }`, não só o relatório parseado) em vez de `relatorio.afirmacoes[].texto` — fecha o buraco de alucinação dupla (Investigador resume errado + Atendente cita o resumo errado, e nada pegava porque as duas paráfrases "combinavam"). (2) Nova `contemProdutoNaoVerificado`: todo nome de produto que o Atendente escreve em *negrito* precisa bater com um nome real retornado por `buscar_produtos`/`buscar_combos`/`buscar_recomendacoes` nesta investigação — só roda quando houve busca de catálogo real (evita falso positivo em negrito de ênfase comum). Também nova rede determinística em `investigador.ts` (`sintetizarAfirmacoesDeResultadoVazio`): resultado vazio de qualquer ferramenta (array vazio ou `erro: "..._nao_encontrado"`, inventariado em todas as tools) vira fato automaticamente em código, não depende mais só do modelo lembrar — fechou o bug que voltou a acontecer ("o que eu já pedi?" escalando pra handoff mesmo sem pedido nenhum, mesmo já tendo uma regra de prompt pra isso).
