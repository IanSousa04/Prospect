# Botão "Devolver pra IA" — cor própria com bom contraste (ex.: azul)

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 4. Design

Hoje o botão "Devolver pra IA" (`apps/web/src/pages/Atendimento.tsx`) usa `.btn-ghost` — fundo `var(--bg-card)`, mesma família de cor neutra do fundo da plataforma, contraste baixo comparado aos outros dois botões do cabeçalho (laranja "Assumir", verde "Finalizar", ver tarefa 0054 pra contexto de quando o verde foi adicionado). Pedido do usuário: dar uma cor própria de bom contraste, ex. azul.

## Nota de consistência (a considerar na implementação, não decidida ainda)

`--blue`/`--blue-bg` já existem na paleta (`apps/web/src/index.css`) e já têm significado semântico reservado: são a cor de status "Humano atendendo" (`STATUS_META.humano_atendendo`, `apps/web/src/components/statusMeta.tsx`) — regra permanente da tarefa 0037. Usar o mesmo azul aqui não conflita tecnicamente (botão de ação é uma categoria visual diferente de pílula de status, mesmo raciocínio já usado pra aceitar verde em "Finalizar" sem contrariar a paleta de status), mas vale decidir explicitamente: reaproveitar `--blue` existente, ou criar um tom de azul distinto só pra botões de ação (mesmo padrão de `--success` verde criado especificamente pra botão, separado da paleta de status). Recomendação: reaproveitar `--blue` — evita inflar a paleta com mais uma variável só de botão, e o significado ("ação relacionada a atendimento humano/IA") não é conflitante o suficiente pra justificar uma cor nova.
