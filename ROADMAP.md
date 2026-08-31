# Roadmap — produto e engenharia

Documento único de roadmap do repositório (consolidação de 2026-08-26: `docs/product/*`, `docs/architecture/*` e `docs/arquitetura_em_etapas.md` foram incorporados aqui como tarefas e removidos, para eliminar conteúdo duplicado). Mesmo padrão de documento que o Eddy mantém (`C:\Dev\Claude\Eddy\docs\ROADMAP.md`): itens marcáveis, organizados por prioridade e área, com referência a arquivo quando aplicável.

A partir de 2026-08-26, cada tarefa das seções 1 a 9 tem só o título aqui — a descrição completa (implementação, decisões, trade-offs) vive num arquivo próprio em [`tasks/`](tasks/), nomeado por ordem sequencial + resumo curto (ex. `tasks/0001-gabarito_eval.md`). Clique no link "detalhes" de cada item para ver o conteúdo completo.

As regras invioláveis do produto (IA nunca inventa dado comercial, nunca infere permissão, separação orquestrador/atendente, handoff estruturado, isolamento multi-tenant, ações irreversíveis exigem confiança alta + baixo risco + permissão explícita, custo real de mensageria) vivem em [`CLAUDE.md`](CLAUDE.md) na raiz do repositório e não são repetidas aqui — são princípios permanentes, não tarefas.

**Mudança de arquitetura (2026-08-30):** o link público virou o núcleo do pedido e a IA virou camada de assistência **somente leitura**. Toda a trilha de checkout/carrinho/escrita da IA (ferramentas de criação/cancelamento/alteração de pedido, Order Context mantido pela IA, workflow determinístico transacional) foi removida — as tarefas correspondentes saíram deste roadmap e de `tasks/`.

Só documentação — nada aqui foi implementado ainda, a menos que marcado `[x]`.

---

## Legenda de prioridade

- **[P0] Crítico** — sem isso a IA não pode "responder de verdade" com segurança (não alucinar / responder corretamente). É pré-requisito para ligar `IA_ENVIO_REAL`.
- **[P1] Alta** — confiabilidade/segurança de alto valor; resolve logo após os P0.
- **[P2] Backlog** — hardening e melhorias que podem esperar.

## Legenda de story points

Escala Fibonacci (1, 2, 3, 5, 8, 13), estimativa relativa de esforço/complexidade — não é previsão de tempo. Estimativa inicial feita a partir do título/escopo de cada tarefa (sem análise linha a linha do arquivo de detalhes); revisar ao iniciar cada uma.

- **1–2** — mudança pontual, escopo bem contido, baixo risco (ex.: ajuste de UI, config).
- **3–5** — feature de tamanho médio, toca uma camada (API, IA ou schema) com alguma lógica nova.
- **8** — feature que atravessa múltiplas camadas (IA + API + banco) ou tem ambiguidade de design a resolver.
- **13** — épico que deveria ser quebrado em subtarefas antes de ser implementado; mantido como 13 até ser desmembrado.

---

## 0. Visão de produto e fases do MVP

Plataforma SaaS de atendimento e vendas via WhatsApp para negócios de alimentação (hamburguerias, pizzarias, restaurantes, açaíterias, sushi bars, marmitarias, lanchonetes, delivery em geral). Proposta de valor: o cliente faz e acompanha o pedido pelo **link público** (cardápio online) e a IA atua como **assistente de conversa** — tira dúvidas sobre cardápio, preços, prazos e políticas, e direciona pro link quando o cliente quer montar/alterar/cancelar um pedido.

**Arquitetura (refatoração 2026-08-30):** o link público é o núcleo do pedido (criação + acompanhamento). A IA é uma camada de assistência **somente leitura** — responde perguntas sobre produtos/preços/prazos, direciona o cliente ao cardápio online (link público, onde ele mesmo vê o cardápio e monta o pedido) e informa prazo de entrega; nunca lista itens por conta própria, nunca cria pedido, nunca monta carrinho, nunca adiciona/remove/altera item, nunca cancela, nunca executa ação operacional.

Fases do MVP (escopo de cada uma, para referência de onde cada tarefa das seções abaixo se encaixa):

- **[x] Fase 1 — Atendimento IA.** Empresa, usuários, WhatsApp, clientes, conversas, IA, conhecimento, Kanban, handoff, histórico. Implementada — pendências residuais nas seções 1 e 2.
- **[ ] Fase 2 — Catálogo Inteligente.** Categorias, produtos, ingredientes, modificadores, grupos de opções, adicionais, molhos, acompanhamentos, combos, recomendações, regras. Estrutura relacional validada contra o padrão iFood/Rappi — ver seção 5.
- **[x] Fase 3 — Pedidos pelo link público.** Criação e acompanhamento de pedido pelo link direto (sem WhatsApp), com o mesmo Order Context visível/editável pelo painel humano. Implementada via task 0043; pendências operacionais (board unificado, impressão, pagamento, edição de pedido criado) na seção 6.

A **operação do pedido é humana** (Kanban/board, cozinha, entrega, pagamento) — a IA não executa nenhuma ação operacional. Não há mais trajetória de "autonomia" da IA (venda/cancelamento automático): isso saiu do escopo do produto.

Referência de arquitetura de IA: **projeto Eddy** (`C:\Dev\Claude\Eddy`) já implementa em produção, no mesmo domínio conceitual, a separação investigador/redator, cálculo de confiança com verificação de citação, ingestão versionada e sistema de gabaritos/eval — consultar `apps/query-api/src/agent.ts` e `docs/ROADMAP.md` do Eddy antes de reinventar qualquer padrão de orquestração/avaliação de IA.

---

## 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

### P0 — crítico

- [x] **[P0] Gabarito/eval da camada de IA (rede de segurança de regressão).** `SP: 8` ([detalhes](tasks/0001-gabarito_eval.md))
- [x] **[P0] A IA deve ter acesso ao histórico completo de mensagens do atendimento (memória da conversa).** `SP: 5` ([detalhes](tasks/0002-memoria_historico.md))
- [x] **[P0] Ampliar a verificação anti-alucinação além de `R$`/PDF/código de pedido.** `SP: 5` ([detalhes](tasks/0003-anti_alucinacao.md))
- [x] **[P0] Vetar tipos sem fonte real + não passar afirmação não-verificada ao Atendente.** `SP: 5` ([detalhes](tasks/0004-vetar_tipos_sem_fonte.md))
- [x] **[P0] `IA_ENVIO_REAL` continua `false` (modo sombra)** `SP: 3` ([detalhes](tasks/0005-envio_real_sombra.md))

### P1 — alta

- [x] **[P1] Fazer valer `ia_configuracoes.comportamento_json`.** `SP: 5` ([detalhes](tasks/0006-comportamento_json.md))
- [x] **[P1] Alinhar a matriz de decisão com a spec: "confiança média → investigar mais".** `SP: 3` ([detalhes](tasks/0007-matriz_decisao.md))
- [x] **[P1] Identidade da IA.** `SP: 2` ([detalhes](tasks/0008-identidade_ia.md))
- [x] **[P1] Cliente manda imagem/áudio → handoff em vez de silêncio.** `SP: 3` ([detalhes](tasks/0009-midia_handoff.md))
- [x] **[P1] Guard determinístico contra prompt injection via conhecimento/resultados de ferramenta.** `SP: 8` ([detalhes](tasks/0010-guard_prompt_injection.md))
- [x] **[P1] `ia_sessoes` em uso (memória derivada da conversa).** `SP: 5` ([detalhes](tasks/0011-ia_sessoes.md))

---

## 2. Atendimento (Kanban / conversa) — P2

O Kanban de atendimento (`apps/web/src/pages/Kanban.tsx`) está sendo unificado com o status do pedido num board operacional único — ver seção 6 (tarefas 0064-0068, 0072).

- [x] **[P2] Finalizar atendimento.** `SP: 2` ([detalhes](tasks/0013-finalizar_atendimento.md))
- [x] **[P2] Devolver atendimento pra IA.** `SP: 2` ([detalhes](tasks/0014-devolver_atendimento.md))
- [x] **[P2] `POST /atendimentos/:id/status` não valida transição nenhuma.** `SP: 3` ([detalhes](tasks/0015-validar_transicao_status.md))
- [x] **[P2] Cliente (CRM simplificado) — campos de personalização ainda não confirmados em uso.** `SP: 3` ([detalhes](tasks/0016-crm_personalizacao.md))

## 3. Camada de IA — assistente somente leitura (P2)

A IA responde perguntas sobre produtos/preços/prazos, direciona o cliente ao cardápio online (link público — onde ele mesmo vê o cardápio e monta o pedido) e informa prazo de entrega (range fixo). Ela **não tem nenhuma ferramenta de escrita**: não cria pedido, não monta carrinho, não adiciona/remove/altera item, não cancela. O pedido é feito e acompanhado pelo link público (task 0043, seção 6) e operado por humanos no board.

### 3.1 Qualidade, cobertura e performance — P2

- [x] **[P2] Ferramentas de operação — confirmar cobertura completa.** `SP: 3` ([detalhes](tasks/0032-ferramentas_operacao.md))
- [x] **[P2] Prazo de entrega como range fixo (fonte única IA + link público).** `SP: 3` ([detalhes](tasks/0084-prazo_entrega_range.md))
- [x] **[P2] Opções de entrega (retirada/entrega) configuráveis por empresa.** `SP: 3` ([detalhes](tasks/0077-opcoes_entrega_configuraveis.md))
- [x] **[P2] Formas de pagamento configuráveis por empresa (consumidas pelo link público e pela tool `consultar_opcoes_atendimento`).** `SP: 5` ([detalhes](tasks/0078-formas_pagamento_configuraveis.md))
- [x] **Agrupar mensagens rápidas do cliente antes de responder.** `SP: 3` ([detalhes](tasks/0030-agrupar_mensagens.md))
- [x] **Formatação das respostas deve usar a sintaxe real do WhatsApp, não Markdown genérico.** `SP: 2` ([detalhes](tasks/0031-formatacao_whatsapp.md))
- [ ] **[P2] Cache.** `SP: 5` ([detalhes](tasks/0025-cache.md))

### 3.2 Infraestrutura, configuração e canal WhatsApp — P2

**Nota do usuário (2026-08-28):** a migração de verdade para a API oficial (tarefa 0062) é deliberadamente a ÚLTIMA tarefa do roadmap inteiro — não só desta seção. Monitorar risco (0060) e avaliar provedores (0061) podem avançar normalmente, mas não execute 0062 antes de esgotar todo o resto do roadmap.

- [x] **Modo teste com whitelist de números.** `SP: 2` ([detalhes](tasks/0028-modo_teste_whitelist.md))
- [ ] **[P2] Topologia de processos do `ai-orchestrator` — migrar de "1 processo por empresa" para "1 processo compartilhado".** `SP: 8` ([detalhes](tasks/0024-topologia_orchestrator.md))
- [ ] **[P2] Princípio explícito do usuário: `.env` deve conter só dados de conexão com o Supabase — todo o resto vira configuração no banco, por empresa, com gestão via UI.** `SP: 5` ([detalhes](tasks/0029-env_so_supabase.md))
- [ ] **[P2] Monitorar risco atual de `whatsapp-web.js` + critério de decisão de migração.** `SP: 2` ([detalhes](tasks/0060-whatsapp_monitorar_risco.md))
- [ ] **[P2] Avaliar provedores oficiais de WhatsApp Business API.** `SP: 3` ([detalhes](tasks/0061-whatsapp_avaliar_provedores.md))
- [ ] **[P2] Migrar `whatsapp-worker` para API oficial.** `SP: 8` ([detalhes](tasks/0062-whatsapp_migrar_api_oficial.md))

## 4. Design — P2

- [ ] **[P2] Evoluir o design system com base nos padrões de UX do portal de parceiros do iFood.** `SP: 8` ([detalhes](tasks/0033-design_system_ifood.md))
- [ ] **[P2] Nenhuma tela foi testada em mobile/tablet** `SP: 5` ([detalhes](tasks/0034-telas_mobile.md))
- [x] **[P2] Contraste ruim em botões e outros elementos.** `SP: 2` ([detalhes](tasks/0035-contraste_botoes.md))
- [x] **[P2] Tema — trocado de dark-only pra light-only (decisão do usuário, não os dois com toggle).** `SP: 3` ([detalhes](tasks/0036-tema_light.md))
- [x] **Cores de status — regra permanente de uso consistente em toda a plataforma.** `SP: 2` ([detalhes](tasks/0037-cores_status.md))
- [ ] **[P2] Botão "Devolver pra IA" — cor própria com bom contraste (ex.: azul).** `SP: 2` ([detalhes](tasks/0071-cor_botao_devolver_ia.md))

## 5. Catálogo (Fase 2) — P2

- [ ] **[P2] Upload de imagem de produto.** `SP: 5` ([detalhes](tasks/0038-upload_imagem.md))
- [ ] **[P2] Templates por segmento** `SP: 5` ([detalhes](tasks/0039-templates_segmento.md))
- [ ] **[P2] Promoções como conceito próprio** `SP: 8` ([detalhes](tasks/0040-promocoes_proprias.md))

## 6. Pedidos (Fase 3 — link público + operação humana) — P2

Board operacional unificado (pedido do usuário): hoje o Kanban de atendimento e o status do pedido são conceitos separados, e um pedido some do radar operacional assim que o atendimento é marcado resolvido. Ordem de dependência: 0064/0065 (simplificação dos status, em paralelo) → 0066 (derivação do estágio unificado + arquivamento) → 0067 (Kanban reconstruído) → 0068 (drag-and-drop) / 0072 (teste de carga).

- [ ] **[P2] Mesclar "IA solicitou humano"/"Cliente solicitou humano" num único status "Solicitou humano".** `SP: 3` ([detalhes](tasks/0064-mesclar_solicitou_humano.md))
- [ ] **[P2] Simplificar `StatusPedido` (aberto/confirmado/em_preparo → `em_preparacao`; pronto/saiu_para_entrega → `pronto`).** `SP: 3` ([detalhes](tasks/0065-simplificar_status_pedido.md))
- [ ] **[P2] Estágio operacional unificado (deriva o estágio do board a partir de atendimento + pedido) + arquivamento.** `SP: 8` ([detalhes](tasks/0066-estagio_operacional_unificado.md))
- [ ] **[P2] Reconstruir o Kanban com as colunas unificadas (conversa + pedido).** `SP: 8` ([detalhes](tasks/0067-kanban_unificado.md))
- [ ] **[P2] Mover cards entre colunas no Kanban via drag-and-drop, alterando o status real.** `SP: 8` ([detalhes](tasks/0068-kanban_drag_and_drop.md))
- [ ] **[P2] Página com filtros pra listar todos os pedidos.** `SP: 5` ([detalhes](tasks/0069-pagina_listagem_pedidos.md))
- [ ] **[P2] Impressão do pedido em modo bobina (cozinha/entregador), só frontend.** `SP: 5` ([detalhes](tasks/0070-impressao_pedido_bobina.md))
- [ ] **[P2] Teste de performance do Kanban com muitas conversas.** `SP: 3` ([detalhes](tasks/0072-teste_performance_kanban.md))
- [ ] **[P2] Não dá pra editar itens de um pedido já criado** `SP: 5` ([detalhes](tasks/0041-editar_itens_pedido.md))
- [ ] **[P2] Gateway de pagamento real** `SP: 13` ([detalhes](tasks/0042-gateway_pagamento.md))
- [x] **[P2] Página pública de cardápio/pedido (link direto, sem WhatsApp).** `SP: 8` ([detalhes](tasks/0043-pagina_publica_pedido.md))

## 7. Telas do produto original ainda não implementadas — P2

- [ ] **[P2] Dashboard operacional.** `SP: 8` ([detalhes](tasks/0045-dashboard_operacional.md))

## 8. Multi-tenant / onboarding — P2

- [ ] **[P2] Nenhum fluxo de cadastro de empresa nova** `SP: 8` ([detalhes](tasks/0046-cadastro_empresa.md))
- [ ] **[P2] Nenhuma tela de convite/gestão de usuários do painel** `SP: 5` ([detalhes](tasks/0047-gestao_usuarios.md))

## 9. Infraestrutura / produção — P2

- [ ] **[P2] Testes automatizados gerais + CI/CD.** `SP: 13` ([detalhes](tasks/0048-testes_cicd.md))
- [ ] **[P2] Nenhum rate limiting nas rotas HTTP de `apps/api`** `SP: 3` ([detalhes](tasks/0049-rate_limiting.md))
- [ ] **[P2] Autenticação de service account pra IA** `SP: 5` ([detalhes](tasks/0050-service_account_ia.md))
- [ ] **[P2] Nenhuma política de retenção/expurgo de dados pessoais de cliente** `SP: 5` ([detalhes](tasks/0051-retencao_dados.md))
- [x] **[P2] Multi-tenancy — banco compartilhado com RLS.** `SP: 8` ([detalhes](tasks/0052-multi_tenancy_rls.md))
- [ ] **[P2] Simulador da IA.** `SP: 8` ([detalhes](tasks/0012-simulador_ia.md))
- [x] **[P2] Simulação de atendimentos completos com personas variadas.** `SP: 5` ([detalhes](tasks/0073-simulacao_personas_atendimento.md))
