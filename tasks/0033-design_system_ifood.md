# Evoluir o design system com base nos padrões de UX do portal de parceiros do iFood

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 4. Design

Pesquisa concluída: o painel interno do portal de parceiros não é acessível publicamente sem conta de parceiro (só a tela de marketing/cadastro é pública), e o design system oficial do iFood (Pomodoro DS) é fechado/privado, sem kit público. O que deu pra documentar com razoável confiança veio de um blog post oficial sobre a tela financeira: padrão de **cards de resumo → blocos por categoria → tabela detalhada expansível → filtros por data/status/forma de pagamento/canal** (progressive disclosure). Recomendação: **não trocar a paleta/tipografia atual** (a identidade do iFood é de app de consumidor — vermelho vibrante, cards de restaurante com foto — o oposto do painel operacional B2B já decidido na Fase 1); aproveitar só os padrões de organização de informação financeira/operacional (resumo → categoria → detalhe, sistema de filtro reutilizável), aplicados na linguagem visual já estabelecida (Manrope + JetBrains Mono). Se o usuário conseguir acesso a uma conta real de parceiro iFood, capturas de tela reais do painel valeriam mais que qualquer coisa encontrada publicamente — vale pedir isso antes de desenhar as telas de verdade.
