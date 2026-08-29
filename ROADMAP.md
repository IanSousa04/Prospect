# Roadmap — produto e engenharia

Documento único de roadmap do repositório (consolidação de 2026-08-26: `docs/product/*`, `docs/architecture/*` e `docs/arquitetura_em_etapas.md` foram incorporados aqui como tarefas e removidos, para eliminar conteúdo duplicado). Mesmo padrão de documento que o Eddy mantém (`C:\Dev\Claude\Eddy\docs\ROADMAP.md`): itens marcáveis, organizados por prioridade e área, com referência a arquivo quando aplicável.

A partir de 2026-08-26, cada tarefa das seções 1 a 10 tem só o título aqui — a descrição completa (implementação, decisões, trade-offs) vive num arquivo próprio em [`tasks/`](tasks/), nomeado por ordem sequencial + resumo curto (ex. `tasks/0001-gabarito_eval.md`). Clique no link "detalhes" de cada item para ver o conteúdo completo.

As regras invioláveis do produto (IA nunca inventa dado comercial, nunca infere permissão, separação orquestrador/atendente, handoff estruturado, isolamento multi-tenant, ações irreversíveis exigem confiança alta + baixo risco + permissão explícita, custo real de mensageria) vivem em [`CLAUDE.md`](CLAUDE.md) na raiz do repositório e não são repetidas aqui — são princípios permanentes, não tarefas.

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

Plataforma SaaS de atendimento e vendas conversacionais via WhatsApp para negócios de alimentação (hamburguerias, pizzarias, restaurantes, açaíterias, sushi bars, marmitarias, lanchonetes, delivery em geral). Proposta de valor: automatizar o atendimento e transformar conversas do WhatsApp em vendas, mantendo uma operação humana preparada para assumir os casos que realmente precisam de intervenção.

Fases do MVP (escopo de cada uma, para referência de onde cada tarefa das seções abaixo se encaixa):

- **[x] Fase 1 — Atendimento IA.** Empresa, usuários, WhatsApp, clientes, conversas, IA, conhecimento, Kanban, handoff, histórico. Maior parte implementada — pendências residuais na seção 1 e 2 abaixo.
- **[ ] Fase 2 — Catálogo Inteligente.** Categorias, produtos, ingredientes, modificadores, grupos de opções, adicionais, molhos, acompanhamentos, combos, recomendações, regras, indexação do catálogo. Estrutura relacional (produtos + grupos de opções + opções, combos referenciando grupos obrigatórios) validada contra o padrão de mercado iFood/Rappi — ver pendências na seção 5.
- **[ ] Fase 3 — Pedidos.** Criação de pedido, itens, personalizações, consulta, status, alterações, integração com sistema externo, pagamento — ver pendências na seção 3 (fechar o ciclo comercial da IA) e seção 6.
- **[ ] Fase 4 — Inteligência Comercial.** Upsell, cross-sell, reativação, recuperação de abandono, clientes recorrentes, campanhas, analytics comercial — ver seção 7.
- **[ ] Fase 5 — Operação Autônoma.** Execução de ações, alterações automáticas, cancelamentos conforme regras, pagamentos, ocorrências, pós-venda, automação operacional — ainda não iniciada, depende de todas as fases anteriores.

Visão de longo prazo (V1 a V5, não são tarefas de uma fase específica — descrevem a trajetória de autonomia da IA ao longo de todas as fases acima):

```
V1 — Atendente:              Cliente → IA → Resposta
V2 — Vendedor:                Cliente → IA → Produto → Personalização → Upsell → Pedido
V3 — Atendimento Híbrido:     Cliente → IA → Resolve / Humano
V4 — Copiloto:                Cliente → Humano (apoiado por IA)
V5 — Operador Autônomo:       Cliente → IA → Entende → Consulta → Decide → Executa → Acompanha → Resolve
```

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
- [x] **[P1] Filtrar afirmação comercial especulativa sem fonte + verificação aritmética de valor somado (handoff silencioso).** `SP: 3` ([detalhes](tasks/0074-verificacao_aritmetica_resumo_carrinho.md))

---

## 2. Atendimento (Kanban / conversa) — P2

O Kanban de atendimento (`apps/web/src/pages/Kanban.tsx`) está sendo unificado com o status do pedido num board operacional único — ver seção 6 (tarefas 0064-0068, 0072).

- [x] **[P2] Finalizar atendimento.** `SP: 2` ([detalhes](tasks/0013-finalizar_atendimento.md))
- [x] **[P2] Devolver atendimento pra IA.** `SP: 2` ([detalhes](tasks/0014-devolver_atendimento.md))
- [x] **[P2] `POST /atendimentos/:id/status` não valida transição nenhuma.** `SP: 3` ([detalhes](tasks/0015-validar_transicao_status.md))
- [x] **[P2] Cliente (CRM simplificado) — campos de personalização ainda não confirmados em uso.** `SP: 3` ([detalhes](tasks/0016-crm_personalizacao.md))

## 3. Camada de IA — MVP 2 e além (P2)

Reorganizada em 2026-08-27 por ordem de dependência lógica dentro de cada prioridade (não só por número); os 3 épicos de 13 SP (`criar_pedido`, tools de escrita restantes, migração do WhatsApp) foram quebrados em subtarefas menores — os itens originais continuam em `tasks/` como referência de desenho/contexto, mas saem da lista marcável abaixo (ver nota "Desmembrada em" em cada um).

**CLAUDE.md regra 8** (adicionada 2026-08-27): todo item nesta seção que introduz um novo campo/estrutura de estado gerenciado pela IA precisa de uma contraparte de gerenciamento humano na UI, sobre o MESMO estado — nunca um estado paralelo. Ver a tarefa [0063](tasks/0063-gerenciar_carrinho_ia_ui.md) (UI do carrinho/Order Context) e as notas cruzadas já deixadas em 0018/0019/0020/0055/0057/0058/0059.

### 3.1 Fechar o ciclo comercial da IA (realizar pedido) — P1

Hoje a IA só **consulta** (catálogo, pedido, cliente) — nunca **executa** uma venda. Ordem de dependência: Order Context → tools de carrinho → confirmação/criação é o caminho mínimo pra IA fechar uma venda de ponta a ponta; tipo de entrega, endereço e forma de pagamento entram entre o carrinho e a confirmação; o motor genérico de etapas é stretch opcional, só depois do resto validado em produção.

- [x] **[P1] Order Context — estado estruturado do pedido em construção.** `SP: 5` ([detalhes](tasks/0053-order_context.md))
- [x] **[P1] Tools de carrinho (`add_to_cart`, `remove_from_cart`, `update_cart_item`, `get_cart`, `calculate_cart`).** `SP: 5` ([detalhes](tasks/0054-tools_carrinho.md))
- [x] **[P1] Gerenciar o carrinho da IA (Order Context) direto da UI — humano edita o mesmo estado.** `SP: 8` ([detalhes](tasks/0063-gerenciar_carrinho_ia_ui.md))
- [x] **[P1] Perguntar tipo de entrega (retirada vs. entrega) antes de endereço.** `SP: 3` ([detalhes](tasks/0018-tipo_entrega.md))
- [x] **[P1] Salvar endereço do cliente e confirmar reuso no próximo pedido.** `SP: 5` ([detalhes](tasks/0020-endereco_cliente.md))
- [x] **[P1] Perguntar/confirmar forma de pagamento.** `SP: 3` ([detalhes](tasks/0019-forma_pagamento.md))
- [x] **[P1] Confirmação explícita do pedido + criação real em `pedidos`/`itens_pedido`.** `SP: 3` ([detalhes](tasks/0055-confirmacao_criacao_pedido.md))
- [x] **[P1] Bug: endereço não atualiza na UI quando o cliente informa/corrige pelo WhatsApp.** `SP: 2` ([detalhes](tasks/0076-endereco_nao_atualiza_ui.md))
- [x] **[P1] Bug: IA não finalizava pedido simples (cliente confirmando só com "Sim" virava handoff mudo) + motor de etapas configurável (escopo mínimo) + opções de entrega/formas de pagamento configuráveis por empresa.** `SP: 8` ([detalhes](tasks/0080-gate_confirmacao_pedido_e_motor_etapas.md))
- [x] **[P0] Workflow transacional determinístico — a LLM perde autoridade sobre estado, ferramentas e confirmação (corrige o bug estrutural que travava o checkout inteiro).** `SP: 13` ([detalhes](tasks/0081-workflow_deterministico_checkout.md))
- [x] **[P0] Pipeline "nada sai sem lastro" — montagem determinística do carrinho, roteamento obrigatório de perguntas e gate de lastro por afirmação.** `SP: 13` ([detalhes](tasks/0082-pipeline_lastro.md))
- [x] **[P2] Motor genérico de etapas configurável por empresa (escopo mínimo entregue via 0080 — framework de módulos genérico continua stretch futuro).** `SP: 5` ([detalhes](tasks/0056-motor_generico_etapas.md))
- [x] **[P2] Opções de entrega (retirada/entrega) configuráveis por empresa.** `SP: 3` ([detalhes](tasks/0077-opcoes_entrega_configuraveis.md))
- [x] **[P2] Formas de pagamento configuráveis por empresa + deixar claro pra IA que o pagamento é feito ao entregador, nunca pela plataforma.** `SP: 5` ([detalhes](tasks/0078-formas_pagamento_configuraveis.md))
- [ ] **[P2] Verificar endereço informado via API simples e gratuita, questionando o cliente se não encontrar.** `SP: 3` ([detalhes](tasks/0079-verificacao_endereco_api.md))

### 3.2 Hardening da camada de escrita — P2

Depende do ciclo comercial mínimo (3.1) estar rodando: risco real na matriz de decisão precisa existir antes/junto das próximas tools de escrita ligarem em produção real (é o que decide se uma ação irreversível vira handoff); confirmação humana e as tools `adicionar_item`/`alterar_item`/`cancelar_pedido`/`atualizar_cliente` expandem a superfície de escrita depois que o padrão estiver validado por `criar_pedido`.

- [x] **[P2] Risco real na matriz de decisão + enforcement das permissões de escrita.** `SP: 8` ([detalhes](tasks/0023-risco_matriz_decisao.md))
- [x] **[P2] Fluxo de confirmação humana fora do texto livre.** `SP: 8` ([detalhes](tasks/0022-confirmacao_humana.md))
- [ ] **[P2] Tools `adicionar_item` / `alterar_item`.** `SP: 8` ([detalhes](tasks/0057-adicionar_alterar_item.md))
- [ ] **[P2] Tool `cancelar_pedido`.** `SP: 3` ([detalhes](tasks/0058-cancelar_pedido.md))
- [ ] **[P2] Tool `atualizar_cliente`.** `SP: 2` ([detalhes](tasks/0059-atualizar_cliente.md))

### 3.3 Qualidade, cobertura e performance — P2

Sem dependência forte do ciclo comercial — podem entrar em paralelo a qualquer momento. Itens já concluídos ficam registrados aqui por serem da mesma família (qualidade da resposta da IA).

- [x] **[P2] Ferramentas de operação — confirmar cobertura completa.** `SP: 3` ([detalhes](tasks/0032-ferramentas_operacao.md))
- [x] **[P2] Tool `consultar_prazo_entrega` + config de prazo padrão vs. calculado (toggle na UI).** `SP: 5` ([detalhes](tasks/0075-prazo_entrega.md))
- [x] **Agrupar mensagens rápidas do cliente antes de responder.** `SP: 3` ([detalhes](tasks/0030-agrupar_mensagens.md))
- [x] **Formatação das respostas deve usar a sintaxe real do WhatsApp, não Markdown genérico.** `SP: 2` ([detalhes](tasks/0031-formatacao_whatsapp.md))
- [ ] **[P2] Cache.** `SP: 5` ([detalhes](tasks/0025-cache.md))
- [ ] **[P2] Embeddings/versionamento de conhecimento.** `SP: 8` ([detalhes](tasks/0026-embeddings_versionamento.md))

### 3.4 Infraestrutura, configuração e canal WhatsApp — P2

Independente do ciclo comercial. Ordem sugerida: topologia do orchestrator antes do `.env` porque `EMPRESA_ID` só some de vez quando a topologia muda; a trilha do WhatsApp oficial (monitorar → avaliar provedores → migrar) é sequencial por natureza e pode rodar em paralelo às outras duas.

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

## 6. Pedidos (Fase 3) — P2

Board operacional unificado adicionado em 2026-08-27 (pedido do usuário): hoje o Kanban de atendimento e o status do pedido são conceitos separados, e um pedido some do radar operacional assim que o atendimento é marcado resolvido. Ordem de dependência: 0064/0065 (simplificação dos status, podem ser feitas em paralelo) → 0066 (derivação do estágio unificado + arquivamento) → 0067 (Kanban reconstruído) → 0068 (drag-and-drop) / 0072 (teste de carga, testar a versão final).

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
- [ ] **[P2] Página pública de cardápio/pedido (link direto, sem WhatsApp).** `SP: 8` ([detalhes](tasks/0043-pagina_publica_pedido.md))

## 7. Inteligência Comercial (Fase 4) — P2

- [ ] **[P2] Campanhas de reengajamento** `SP: 13` ([detalhes](tasks/0044-campanhas_reengajamento.md))

## 8. Telas do produto original ainda não implementadas — P2

- [ ] **[P2] Dashboard operacional.** `SP: 8` ([detalhes](tasks/0045-dashboard_operacional.md))

## 9. Multi-tenant / onboarding — P2

- [ ] **[P2] Nenhum fluxo de cadastro de empresa nova** `SP: 8` ([detalhes](tasks/0046-cadastro_empresa.md))
- [ ] **[P2] Nenhuma tela de convite/gestão de usuários do painel** `SP: 5` ([detalhes](tasks/0047-gestao_usuarios.md))

## 10. Infraestrutura / produção — P2

- [ ] **[P2] Testes automatizados gerais + CI/CD.** `SP: 13` ([detalhes](tasks/0048-testes_cicd.md))
- [ ] **[P2] Nenhum rate limiting nas rotas HTTP de `apps/api`** `SP: 3` ([detalhes](tasks/0049-rate_limiting.md))
- [ ] **[P2] Autenticação de service account pra IA** `SP: 5` ([detalhes](tasks/0050-service_account_ia.md))
- [ ] **[P2] Nenhuma política de retenção/expurgo de dados pessoais de cliente** `SP: 5` ([detalhes](tasks/0051-retencao_dados.md))
- [x] **[P2] Multi-tenancy — banco compartilhado com RLS.** `SP: 8` ([detalhes](tasks/0052-multi_tenancy_rls.md))
- [ ] **[P2] Simulador da IA.** `SP: 8` ([detalhes](tasks/0012-simulador_ia.md))
- [x] **[P2] Simulação de atendimentos completos com personas variadas.** `SP: 5` ([detalhes](tasks/0073-simulacao_personas_atendimento.md))
