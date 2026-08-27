# Página pública de cardápio/pedido (link direto, sem WhatsApp)

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)

Canal alternativo de venda: uma página web pública por empresa (ex. `pedido.dominio.com/nome-da-empresa` ou subdomínio próprio) onde o cliente monta o pedido sozinho — navega o catálogo, escolhe produtos/personalizações/adicionais respeitando os grupos de opções já modelados na Fase 2, monta o carrinho, escolhe entrega/retirada, endereço e forma de pagamento, e confirma. Mesmo domínio de regras de `criar_pedido` (ver tarefa `0017-tool_escrita`) — a diferença é a interface (web autoatendimento em vez de conversa por IA), então deve reusar o mesmo `OrderContext`/tools de carrinho quando essas existirem, nunca duplicar a lógica de preço/disponibilidade/regra de negócio num caminho paralelo (senão vira uma segunda fonte de verdade, contrariando a regra inviolável de CLAUDE.md sobre dado comercial). Ainda não desenhado — nem em `docs/`, nem em código.

**Antes de implementar, pesquisar referências reais de mercado de páginas de cardápio/pedido para pequenos negócios de delivery** (ex.: Anota AI, CardápioWeb, Goomer, Linktree de cardápio de iFood/WhatsApp) para validar padrões de UX já consolidados (estrutura por categoria, carrinho flutuante, resumo de pedido, tela de checkout em etapas, indicação de aberto/fechado) antes de desenhar a tela do zero — mesmo princípio já aplicado à pesquisa do portal de parceiros iFood (ver tarefa `0033-design_system_ifood`).

Também é uma expansão de canal (hoje o MVP é "WhatsApp exclusivo", ver seção 0 do ROADMAP) — confirmar com o usuário se isso deve ser tratado como extensão da Fase 3 ou como fase própria antes de iniciar o desenho.
