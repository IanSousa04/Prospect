# Identidade da IA

**Status:** concluído
**Prioridade:** P1
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

Implementado no mesmo padrão de `clientePediuHumano`/`pedeTempoReal`: nova coluna `ia_configuracoes.nome_assistente` (migration `0012_identidade_ia.sql`, nullable — sem nome configurado usa texto genérico honesto, nunca inventa um nome). `deteccao.ts` ganhou `pedeIdentidade`/`mensagemDeIdentidade`: pergunta de identidade ("quem é você?", "qual seu nome?", "você é um robô/pessoa/de verdade?", "quem te criou?") é detectada por regex, DETERMINÍSTICA, e responde com texto fixo que sempre admite ser IA — nunca deixa essa resposta (confirmar ou negar) na mão livre do LLM. Reaproveita o caminho `sem_investigacao` já existente (`RelatorioInvestigacao.sem_investigacao` + `computeConfianca`), mesmo padrão do bloco de hora/data. O padrão antigo `/você é um robô/i` foi **removido** de `clientePediuHumano` (estava ali por engano — perguntar se é um robô é pergunta de identidade, não pedido automático de handoff; agora responde a verdade e deixa a porta aberta pra pedir humano se quiser). Coberto por 4 novos casos determinísticos no gabarito (sem custo de LLM) + build limpo, 21/21 passando.
