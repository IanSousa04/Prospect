# `IA_ENVIO_REAL` continua `false` (modo sombra)

**Status:** concluído
**Prioridade:** P0
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

## Implementação

O modo sombra está completamente implementado e ativo. Nenhuma resposta de IA chega de verdade ao cliente. Ligar isso é uma decisão separada, **só depois de validação completa**.

### O que foi implementado

1. **Controle via variável de ambiente (`IA_ENVIO_REAL`)** — `apps/whatsapp-worker/src/lib/env.ts`
   - Padrão: `false` (fail-safe, seguro por omissão)
   - Qualquer valor diferente de `"true"` (string exata) mantém modo sombra ativo

2. **Lógica de simulação** — `apps/whatsapp-worker/src/poller.ts`
   - Quando `remetente === "ia" && !env.iaEnvioReal`:
     - NÃO chama `client.sendMessage()` (WhatsApp real)
     - Marca `metadata_json.simulado_em` com timestamp
     - Loga resposta simulada com contexto completo
   - Mensagens de humano SEMPRE são enviadas (independente da flag)

3. **Armazenamento diferenciado** — campo `metadata_json` em `mensagens`
   - `simulado_em`: timestamp de quando foi simulada (modo sombra)
   - `enviado_em`: timestamp de quando foi enviada de verdade (envio real)
   - Permite auditoria SQL precisa do que foi simulado vs enviado

4. **Logs e observabilidade**
   - Boot do `whatsapp-worker`: avisa claramente qual modo está ativo
   - Boot do `ai-orchestrator`: lembra que envio real depende da flag
   - Cada resposta simulada: log estruturado com atendimento, cliente, conteúdo
   - Logs diferentes para modo sombra vs envio real (fácil de distinguir)

5. **Script de verificação** — `npm run -w apps/ai-orchestrator verificar-modo-sombra`
   - Detecta status atual (modo sombra vs envio real ativo)
   - Estatísticas de mensagens simuladas vs enviadas (últimos 7 dias)
   - Taxa de handoff e distribuição de confiança
   - Últimas 5 respostas simuladas para auditoria manual
   - Checklist de próximos passos (validação ou rollback)

6. **Documentação completa** — `docs/MODO_SOMBRA.md`
   - O que é e como funciona
   - Observabilidade (logs, queries SQL)
   - Critérios detalhados para desligar o modo sombra (pré-requisitos P0 + P1)
   - Procedimento de ativação do envio real (quando chegar a hora)
   - Procedimento de rollback de emergência
   - FAQ completo

### Relação com outros sistemas

- **Gabarito/eval** (tarefa 0001): Pré-requisito para ligar envio real, mas não depende do modo sombra para rodar
- **Modo teste com whitelist** (tarefa 0028): Ortogonal ao modo sombra — podem (e devem) ser usados juntos no início
- **Handoffs**: Funcionam igual em modo sombra e envio real (sempre estruturados, sempre gravados)

### Como usar

**Enquanto em modo sombra (padrão atual):**

```bash
# Ver status e estatísticas
npm run -w apps/ai-orchestrator verificar-modo-sombra

# Auditar respostas simuladas no banco
# Ver queries SQL em docs/MODO_SOMBRA.md
```

**Quando validação completa estiver pronta:**

Seguir rigorosamente o procedimento em `docs/MODO_SOMBRA.md` — **nunca** pular etapas.

### Arquivos modificados/criados

- ✅ `apps/whatsapp-worker/src/lib/env.ts` — flag `iaEnvioReal`
- ✅ `apps/whatsapp-worker/src/poller.ts` — lógica de simulação + logs melhorados
- ✅ `apps/whatsapp-worker/src/index.ts` — aviso no boot
- ✅ `apps/ai-orchestrator/src/index.ts` — lembrete no boot
- ✅ `apps/ai-orchestrator/src/poller.ts` — exclusão de mensagens simuladas
- ✅ `apps/ai-orchestrator/src/scripts/verificar-modo-sombra.ts` — script de auditoria (novo)
- ✅ `apps/ai-orchestrator/package.json` — comando `verificar-modo-sombra`
- ✅ `docs/MODO_SOMBRA.md` — documentação completa (novo)
- ✅ `apps/whatsapp-worker/.env.example` — comentário explicativo
- ✅ `apps/ai-orchestrator/.env.example` — comentário sobre onde mora a flag

### Validação

- [x] Flag `IA_ENVIO_REAL` default `false` (fail-safe)
- [x] Mensagens de IA nunca chamam `client.sendMessage()` quando flag `false`
- [x] Mensagens de IA são marcadas com `simulado_em` em vez de `enviado_em`
- [x] Mensagens de humano sempre são enviadas (não afetadas pela flag)
- [x] Logs claros e estruturados em modo sombra
- [x] Script de verificação funcional
- [x] Documentação completa e referenciada nos logs
- [x] `.env.example` de ambos os apps documentam a flag
