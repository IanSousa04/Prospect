# Cores de status — regra permanente de uso consistente em toda a plataforma

**Status:** concluído
**Prioridade:** P2 (seção 4, sem tag explícita no item original)
**Seção no ROADMAP:** 4. Design

Roxo discreto = IA atendendo sozinha (calma, não deve chamar atenção); âmbar = IA solicitou humano (atenção); vermelho sólido = cliente solicitou humano (máxima — o único estado que deve "gritar" na tela); azul = humano atendendo (neutra); cinza apagado = resolvido (neutra/baixa). Implementado em `apps/web/src/components/statusMeta.tsx`. A intenção de design é que a IA apareça como *dado discreto*, não como personagem — por isso ela não usa uma cor "chamativa" como verde ou vermelho; o vermelho é reservado exclusivamente para quando o cliente pede humano, o caso mais urgente.
