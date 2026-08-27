# Checklist de Guardrails — Tarefa "IA_ENVIO_REAL continua false (modo sombra)"

**Data:** 2026-08-26
**Tarefa:** `tasks/0005-envio_real_sombra.md`
**Status:** ✅ Concluída e validada

---

## Resumo da Implementação

O modo sombra garante que **nenhuma resposta de IA chega ao WhatsApp do cliente** até validação completa estar pronta. A IA processa tudo normalmente (investiga, decide, redige), mas o envio final é bloqueado de forma segura e auditável.

---

## Checklist de Guardrails da IA de Atendimento

### 1. Fundamentação em dados
- **Status:** ✅ N/A
- **Justificativa:** Esta tarefa não altera como a IA fundamenta respostas em dados. O modo sombra apenas controla SE a resposta é enviada ao WhatsApp, não COMO ela é gerada. A lógica de consulta ao catálogo/conhecimento permanece inalterada.

### 2. Permissões
- **Status:** ✅ N/A
- **Justificativa:** Esta tarefa não altera o sistema de permissões (`ia_permissoes`). O modo sombra é uma trava de envio no `whatsapp-worker`, ortogonal ao sistema de permissões do `ai-orchestrator`. A checagem de permissões continua acontecendo normalmente antes da decisão de responder.

### 3. Separação orquestrador / atendente
- **Status:** ✅ ATENDIDO
- **Evidência:**
  - Logs técnicos do modo sombra (`apps/whatsapp-worker/src/poller.ts` linha 51-57) vão para stdout do servidor, nunca para o WhatsApp do cliente
  - A mensagem final continua sendo a resposta redatada pelo Atendente (`apps/ai-orchestrator/src/agent/atendente.ts`) — o modo sombra não gera texto novo
  - Termos técnicos ("modo sombra", "simulado_em", "metadata_json") ficam no backend/logs, invisíveis ao cliente
- **Teste:** Ler o log de modo sombra — contém `atendimento_id`, `destino`, `timestamp simulação` — nenhum desses vazaria pro cliente mesmo se o envio fosse real.

### 4. Handoff
- **Status:** ✅ ATENDIDO
- **Evidência:**
  - Handoffs continuam sendo criados via `criarHandoff()` com contexto estruturado (origem, motivo, resumo, ação sugerida, prioridade) — ver `apps/ai-orchestrator/src/agent/orquestrador.ts` linhas 103-111, 191-198, 242-249
  - Mensagens de confirmação de transferência (quando existem, ex.: cliente pediu humano) são texto fixo/determinístico (`apps/ai-orchestrator/src/agent/deteccao.ts` função `mensagemDeTransferencia`)
  - Se um handoff gera mensagem ao cliente, essa mensagem TAMBÉM é simulada em modo sombra (não há caminho especial que pule a flag)
- **Teste:** Handoff por "quero falar com atendente" gera `respostaTexto` não-null — essa resposta passa pelo mesmo `if (msg.remetente === "ia" && !env.iaEnvioReal)` do poller, garantindo consistência.

### 5. Multi-tenant
- **Status:** ✅ ATENDIDO
- **Evidência:**
  - `apps/whatsapp-worker/src/poller.ts` linha 27: `.eq("empresa_id", env.empresaId)` — só busca mensagens da empresa atual
  - `apps/ai-orchestrator/src/scripts/verificar-modo-sombra.ts`: todas as queries (mensagens, decisões, handoffs, atendimentos) filtram por `empresa_id`
  - Nenhuma query nova foi introduzida sem esse filtro
  - Todas as tabelas envolvidas (`mensagens`, `ia_decisoes`, `ia_handoffs`, `atendimentos`, `clientes`) já têm RLS configurado (migration `0009_ia_fundacao.sql`) + filtro explícito nas queries
- **Teste:** Duas empresas diferentes rodando em modo sombra — cada uma só enxerga/atualiza suas próprias mensagens, sem risco de vazamento de `simulado_em` cruzado.

### 6. Mensageria WhatsApp
- **Status:** ✅ ATENDIDO — **Este é o CORE da tarefa**
- **Evidência:**
  - **Sucesso só após confirmação real:** `apps/whatsapp-worker/src/poller.ts` linhas 60-68 — `metadata_json.enviado_em` só é marcado DEPOIS de `await client.sendMessage()` bem-sucedido, dentro do `try/catch` (se falhar, não marca)
  - **Modo sombra nunca chama a API real:** linhas 49-65 — quando `!env.iaEnvioReal`, pula completamente o bloco que contém `client.sendMessage()`, marcando `simulado_em` em vez disso
  - **Marcação diferenciada:** `simulado_em` vs `enviado_em` permite auditoria SQL precisa (ver queries em `docs/MODO_SOMBRA.md`)
  - **Sem risco de loop:** a query de busca de pendentes (linha 29-30) usa `.is("metadata_json->>enviado_em", null).is("metadata_json->>simulado_em", null)` — mensagem com qualquer uma dessas marcadas não é recandidatada
  - **Sem envio duplicado:** cada mensagem passa pelo check de modo sombra UMA vez — ou `simulado_em` é marcado, ou `enviado_em`, ou falha e fica pendente pra retry (sem risco de enviar duas vezes)
- **Teste:** Simular falha de `client.sendMessage()` (ex.: número inválido) — mensagem NÃO deve ser marcada como enviada, deve ficar pendente para retry, e nunca deve marcar ambos os campos ao mesmo tempo.

### 7. UX operacional (painel admin)
- **Status:** ✅ ATENDIDO
- **Evidência:**
  - **Logs técnicos no lugar certo:** Console do servidor (`[poller] (MODO SOMBRA) resposta de IA NÃO enviada de verdade`), não exposto em UI de cliente
  - **Campo técnico não exposto:** `metadata_json.simulado_em` é um detalhe de implementação backend, não há (e não deve haver) coluna "Simulado" visível no painel de Conversas do cliente — a mensagem aparece normalmente na thread, mas nunca foi pro WhatsApp
  - **Ferramenta de auditoria para admin:** `npm run -w apps/ai-orchestrator verificar-modo-sombra` é voltada para desenvolvedor/operador, não usuário final
  - **Documentação operacional:** `docs/MODO_SOMBRA.md` tem linguagem técnica adequada para quem toma decisão de ligar envio real (operador/CTO), não para atendente ou cliente final
  - **Aviso visual no boot:** `apps/whatsapp-worker/src/index.ts` linhas 25-36 — console do servidor mostra claramente qual modo está ativo (sombra ou real), com emoji de status
- **Teste:** Olhar o painel de Conversas no `apps/web` — mensagens simuladas devem aparecer como mensagens normais da IA na thread (para auditoria do admin), mas nenhum badge especial "SIMULADO" ou aviso técnico deve vazar pra lá (isso fica nos logs do servidor).

---

## Resumo da Validação

| Item | Status | Comentário |
|------|--------|------------|
| 1. Fundamentação em dados | ✅ N/A | Não altera lógica de busca de dados |
| 2. Permissões | ✅ N/A | Não altera sistema de permissões |
| 3. Separação orquestrador/atendente | ✅ ATENDIDO | Logs técnicos no servidor, resposta ao cliente intacta |
| 4. Handoff | ✅ ATENDIDO | Estruturado, texto fixo, preservado em modo sombra |
| 5. Multi-tenant | ✅ ATENDIDO | Todas as queries filtram por `empresa_id` |
| 6. Mensageria WhatsApp | ✅ ATENDIDO | **CORE:** envio só após confirmação, simulação segura, sem loop |
| 7. UX operacional | ✅ ATENDIDO | Ferramentas de debug/auditoria no lugar certo |

**Conclusão:** ✅ Tarefa concluída com todos os guardrails atendidos ou explicitamente não-aplicáveis (com justificativa).

---

## Próximos Passos (quando relevante)

Esta tarefa **mantém** o modo sombra ativo — ela NÃO é sobre desligar o modo sombra, é sobre garantir que ele está implementado corretamente e auditável.

**Para ligar o envio real (decisão futura, separada):**

1. Validar todos os critérios em `docs/MODO_SOMBRA.md` seção "Critérios para desligar o modo sombra"
2. Rodar `npm run -w apps/ai-orchestrator verificar-modo-sombra` e auditar as últimas 50+ respostas
3. Rodar `npm run -w apps/ai-orchestrator eval` (gabarito) — deve passar 100%
4. Escolher empresa piloto e alinhar expectativas
5. Mudar `IA_ENVIO_REAL=true` no `.env` de `apps/whatsapp-worker`
6. Reiniciar o processo e monitorar ativamente

**NÃO faça isso ainda** — todos os P0 do ROADMAP estão concluídos, mas ainda faltam validações de P1 e auditoria de volume real antes de envio verdadeiro.
