# Tema — trocado de dark-only pra light-only (decisão do usuário, não os dois com toggle)

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 4. Design

Pesquisa feita a pedido do usuário (dark mode é dominante em ferramentas técnicas; light mode é preferido em contexto de trabalho diurno por público não-técnico — o perfil real deste painel, dono/atendente de hamburgueria/pizzaria) embasou a escolha. Paleta nova em `apps/web/src/index.css`: base neutra quente (tendência "oatmeal/stone" 2025-2026, evita branco frio/puro), nova cor de marca `--primary`/`--primary-hover` (terracota/laranja, usada em `.btn-primary`/`.pb-btn-primary` — antes só invertiam `--text-1`/`--bg`, preto sobre branco, "claro" mas não "colorido"). Paleta de status (`--ia`/`--amber`/`--red`/`--blue`/`--gray` + `-bg`) redesenhada pro claro preservando a mesma hierarquia semântica — ver tarefa `Cores de status`. Scrim de modal (`PedidoBuilder.css`, antes `rgba(0,0,0,0.55)` hardcoded) tokenizado em `--overlay`. Sem toggle/seletor de tema — light-only por decisão explícita, sem `prefers-color-scheme`/`data-theme` (nenhum scaffolding de tema existia antes, greenfield).
