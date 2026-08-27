# Contraste ruim em botões e outros elementos

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 4. Design

Corrigido em duas rodadas — primeiro no dark mode (`--text-3`/`--red`/`--gray` elevados + borda dedicada no toggle desligado), depois substituído de novo junto com a troca pra light-only (ver tarefa `Tema — light-only`). Todos os pares texto/fundo e status/status-bg verificados via WCAG real (canvas no navegador, luminância relativa — não "no olho"), ≥4.5:1 pra texto normal/pequeno e margem segura nos botões primários (branco sobre `--primary`: 4.94:1).
