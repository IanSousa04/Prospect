# Página pública de cardápio/pedido (link direto, sem WhatsApp)

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)

Canal alternativo de venda: uma página web pública por empresa (ex. `pedido.dominio.com/nome-da-empresa` ou subdomínio próprio) onde o cliente monta o pedido sozinho — navega o catálogo, escolhe produtos/personalizações/adicionais respeitando os grupos de opções já modelados na Fase 2, monta o carrinho, escolhe entrega/retirada, endereço e forma de pagamento, e confirma. Mesmo domínio de regras de `criar_pedido` (ver tarefa `0017-tool_escrita`) — a diferença é a interface (web autoatendimento em vez de conversa por IA), então deve reusar o mesmo `OrderContext`/tools de carrinho quando essas existirem, nunca duplicar a lógica de preço/disponibilidade/regra de negócio num caminho paralelo (senão vira uma segunda fonte de verdade, contrariando a regra inviolável de CLAUDE.md sobre dado comercial). Ainda não desenhado — nem em `docs/`, nem em código.

**Antes de implementar, pesquisar referências reais de mercado de páginas de cardápio/pedido para pequenos negócios de delivery** (ex.: Anota AI, CardápioWeb, Goomer, Linktree de cardápio de iFood/WhatsApp) para validar padrões de UX já consolidados (estrutura por categoria, carrinho flutuante, resumo de pedido, tela de checkout em etapas, indicação de aberto/fechado) antes de desenhar a tela do zero — mesmo princípio já aplicado à pesquisa do portal de parceiros iFood (ver tarefa `0033-design_system_ifood`).

Também é uma expansão de canal (hoje o MVP é "WhatsApp exclusivo", ver seção 0 do ROADMAP) — confirmar com o usuário se isso deve ser tratado como extensão da Fase 3 ou como fase própria antes de iniciar o desenho.

## Como ficou implementado

Canal confirmado com o usuário como extensão da Fase 3 (não fase própria), com duas decisões dele:

1. **O código de verificação vai pelo WhatsApp, mas nunca entra em `mensagens`.** `mensagens` é o histórico que a IA lê a cada turno — um código de acesso ali seria credencial exposta ao modelo, além de poluir a conversa no painel. O código vive em `verificacoes_telefone` e tem um poller próprio no whatsapp-worker (`poller-verificacao.ts`).
2. **O pedido nasce `aberto`, não `em_preparacao`.** A confirmação do cliente na página cria o pedido; quem manda pra cozinha continua sendo o humano, pelo botão "Confirmar" do Kanban, que move o card pra "Na cozinha". A loja aceita o pedido antes de começar a produzir.

### Nada de lógica paralela

- O carrinho da página pública é o MESMO `ia_sessoes.estado_json.pedido` da conversa. As mutações que antes viviam inline em `routes/atendimentos.ts` foram extraídas pra `apps/api/src/services/carrinho.ts`, agora com três consumidores (IA, painel humano, cliente final) e uma implementação só.
- `validarPreRequisitosDeCriacao` saiu de `apps/ai-orchestrator/src/agent/checkout/` pra `packages/shared` (o caminho antigo virou reexport): o gate de idempotência/completude/confirmação vale igual pra IA e pro cliente clicando num botão. Os 157 gabaritos determinísticos continuam exercitando a mesma função.
- Preço e disponibilidade sempre por `montarItensComSnapshot`; a vitrine computa `disponivel` com a mesma regra de janela de horário que o backend usa pra aceitar o item.

### Pedido duplicado

Três camadas, porque duplicar pedido é comida e dinheiro de verdade: pedido ativo na conversa bloqueia um segundo (409), o hash do resumo revisado precisa bater com o carrinho atual na hora de confirmar, e `ultimo_pedido_criado` devolve o pedido existente se a mesma confirmação chegar duas vezes.

### `ia_permissoes` não gateia este canal

A matriz de risco existe pra limitar o que a IA faz SOZINHA. Aqui o cliente monta e confirma o próprio pedido, e ele espera aceitação humana independentemente do valor — aplicar `valor_maximo_sem_handoff` bloquearia um pedido caro que já vai passar por um humano de qualquer forma. Registrado como decisão, não como omissão.

### Pendente

Taxa de entrega continua `0` (mesma decisão da tool `criar_pedido`): nenhum canal calcula taxa ainda, e cobrar um valor que o catálogo não define seria inventar dado comercial.
