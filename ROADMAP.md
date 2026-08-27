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

- [x] **[P0] Gabarito/eval da camada de IA (rede de segurança de regressão).** ([detalhes](tasks/0001-gabarito_eval.md))
- [x] **[P0] A IA deve ter acesso ao histórico completo de mensagens do atendimento (memória da conversa).** ([detalhes](tasks/0002-memoria_historico.md))
- [x] **[P0] Ampliar a verificação anti-alucinação além de `R$`/PDF/código de pedido.** ([detalhes](tasks/0003-anti_alucinacao.md))
- [x] **[P0] Vetar tipos sem fonte real + não passar afirmação não-verificada ao Atendente.** ([detalhes](tasks/0004-vetar_tipos_sem_fonte.md))
- [ ] **[P0] `IA_ENVIO_REAL` continua `false` (modo sombra)** ([detalhes](tasks/0005-envio_real_sombra.md))

### P1 — alta

- [x] **[P1] Fazer valer `ia_configuracoes.comportamento_json`.** ([detalhes](tasks/0006-comportamento_json.md))
- [x] **[P1] Alinhar a matriz de decisão com a spec: "confiança média → investigar mais".** ([detalhes](tasks/0007-matriz_decisao.md))
- [x] **[P1] Identidade da IA.** ([detalhes](tasks/0008-identidade_ia.md))
- [x] **[P1] Cliente manda imagem/áudio → handoff em vez de silêncio.** ([detalhes](tasks/0009-midia_handoff.md))
- [ ] **[P1] Guard determinístico contra prompt injection via conhecimento/resultados de ferramenta.** ([detalhes](tasks/0010-guard_prompt_injection.md))
- [ ] **[P1] `ia_sessoes` em uso (memória derivada da conversa).** ([detalhes](tasks/0011-ia_sessoes.md))
- [ ] **[P1] Simulador da IA.** ([detalhes](tasks/0012-simulador_ia.md))

---

## 2. Atendimento (Kanban / conversa) — P2

- [ ] **[P2] Finalizar atendimento.** ([detalhes](tasks/0013-finalizar_atendimento.md))
- [ ] **[P2] Devolver atendimento pra IA.** ([detalhes](tasks/0014-devolver_atendimento.md))
- [ ] **[P2] `POST /atendimentos/:id/status` não valida transição nenhuma.** ([detalhes](tasks/0015-validar_transicao_status.md))
- [ ] **[P2] Cliente (CRM simplificado) — campos de personalização ainda não confirmados em uso.** ([detalhes](tasks/0016-crm_personalizacao.md))

## 3. Camada de IA — MVP 2 e além (P2)

### Fechar o ciclo comercial da IA (realizar pedido) — pedido do usuário, ainda não desenhado em código

Hoje a IA só **consulta** (catálogo, pedido, cliente) — nunca **executa** uma venda. Nenhum destes itens tem fluxo conversacional implementado ainda. Ordem de dependência: item 1 é pré-requisito de todos os outros.

- [ ] **[P1] `criar_pedido` — tool de escrita com fluxo conversacional guiado, orientado a estado estruturado (não histórico de chat).** ([detalhes](tasks/0017-tool_escrita.md))
- [ ] **[P1] Perguntar tipo de entrega (retirada vs. entrega) antes de endereço.** ([detalhes](tasks/0018-tipo_entrega.md))
- [ ] **[P1] Perguntar/confirmar forma de pagamento.** ([detalhes](tasks/0019-forma_pagamento.md))
- [ ] **[P1] Salvar endereço do cliente e confirmar reuso no próximo pedido.** ([detalhes](tasks/0020-endereco_cliente.md))
- [ ] **[P2] Tools de escrita restantes: `adicionar_item`, `alterar_item`, `cancelar_pedido`, `atualizar_cliente`.** ([detalhes](tasks/0021-tools_escrita_restantes.md))
- [ ] **[P2] Fluxo de confirmação humana fora do texto livre** ([detalhes](tasks/0022-confirmacao_humana.md))
- [ ] **[P2] Risco real na matriz de decisão + enforcement das permissões de escrita.** ([detalhes](tasks/0023-risco_matriz_decisao.md))
- [ ] **[P2] Topologia de processos do `ai-orchestrator` — migrar de "1 processo por empresa" para "1 processo compartilhado".** ([detalhes](tasks/0024-topologia_orchestrator.md))
- [ ] **[P2] Cache.** ([detalhes](tasks/0025-cache.md))
- [ ] **[P2] Embeddings/versionamento de conhecimento** ([detalhes](tasks/0026-embeddings_versionamento.md))
- [ ] **[P2] `whatsapp-web.js` não é a API oficial do WhatsApp Business.** ([detalhes](tasks/0027-whatsapp_nao_oficial.md))
- [x] **Modo teste com whitelist de números.** ([detalhes](tasks/0028-modo_teste_whitelist.md))
- [ ] **[P2] Princípio explícito do usuário: `.env` deve conter só dados de conexão com o Supabase — todo o resto vira configuração no banco, por empresa, com gestão via UI.** ([detalhes](tasks/0029-env_so_supabase.md))
- [x] **Agrupar mensagens rápidas do cliente antes de responder.** ([detalhes](tasks/0030-agrupar_mensagens.md))
- [x] **Formatação das respostas deve usar a sintaxe real do WhatsApp, não Markdown genérico.** ([detalhes](tasks/0031-formatacao_whatsapp.md))
- [ ] **[P2] Ferramentas de operação — confirmar cobertura completa.** ([detalhes](tasks/0032-ferramentas_operacao.md))

## 4. Design — P2

- [ ] **[P2] Evoluir o design system com base nos padrões de UX do portal de parceiros do iFood.** ([detalhes](tasks/0033-design_system_ifood.md))
- [ ] **[P2] Nenhuma tela foi testada em mobile/tablet** ([detalhes](tasks/0034-telas_mobile.md))
- [x] **[P2] Contraste ruim em botões e outros elementos.** ([detalhes](tasks/0035-contraste_botoes.md))
- [x] **[P2] Tema — trocado de dark-only pra light-only (decisão do usuário, não os dois com toggle).** ([detalhes](tasks/0036-tema_light.md))
- [x] **Cores de status — regra permanente de uso consistente em toda a plataforma.** ([detalhes](tasks/0037-cores_status.md))

## 5. Catálogo (Fase 2) — P2

- [ ] **[P2] Upload de imagem de produto.** ([detalhes](tasks/0038-upload_imagem.md))
- [ ] **[P2] Templates por segmento** ([detalhes](tasks/0039-templates_segmento.md))
- [ ] **[P2] Promoções como conceito próprio** ([detalhes](tasks/0040-promocoes_proprias.md))

## 6. Pedidos (Fase 3) — P2

- [ ] **[P2] Não dá pra editar itens de um pedido já criado** ([detalhes](tasks/0041-editar_itens_pedido.md))
- [ ] **[P2] Gateway de pagamento real** ([detalhes](tasks/0042-gateway_pagamento.md))
- [ ] **[P2] Página pública de cardápio/pedido (link direto, sem WhatsApp).** ([detalhes](tasks/0043-pagina_publica_pedido.md))

## 7. Inteligência Comercial (Fase 4) — P2

- [ ] **[P2] Campanhas de reengajamento** ([detalhes](tasks/0044-campanhas_reengajamento.md))

## 8. Telas do produto original ainda não implementadas — P2

- [ ] **[P2] Dashboard operacional.** ([detalhes](tasks/0045-dashboard_operacional.md))

## 9. Multi-tenant / onboarding — P2

- [ ] **[P2] Nenhum fluxo de cadastro de empresa nova** ([detalhes](tasks/0046-cadastro_empresa.md))
- [ ] **[P2] Nenhuma tela de convite/gestão de usuários do painel** ([detalhes](tasks/0047-gestao_usuarios.md))

## 10. Infraestrutura / produção — P2

- [ ] **[P2] Testes automatizados gerais + CI/CD.** ([detalhes](tasks/0048-testes_cicd.md))
- [ ] **[P2] Nenhum rate limiting nas rotas HTTP de `apps/api`** ([detalhes](tasks/0049-rate_limiting.md))
- [ ] **[P2] Autenticação de service account pra IA** ([detalhes](tasks/0050-service_account_ia.md))
- [ ] **[P2] Nenhuma política de retenção/expurgo de dados pessoais de cliente** ([detalhes](tasks/0051-retencao_dados.md))
- [x] **[P2] Multi-tenancy — banco compartilhado com RLS.** ([detalhes](tasks/0052-multi_tenancy_rls.md))
