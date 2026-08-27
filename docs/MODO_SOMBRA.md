# Modo Sombra — Operação segura da IA antes da validação completa

## O que é

O **modo sombra** (shadow mode) é a trava de segurança do MVP 1 da camada de IA. Enquanto ativo, a IA:

- ✅ **Processa** todas as mensagens de clientes normalmente
- ✅ **Investiga** usando todas as ferramentas disponíveis (catálogo, conhecimento, pedidos)
- ✅ **Decide** qual ação tomar (responder, handoff, pedir esclarecimento)
- ✅ **Redige** respostas completas como se fossem ser enviadas
- ✅ **Grava** tudo no banco (decisões, confiança, respostas)
- ❌ **NÃO ENVIA** nenhuma resposta de verdade ao WhatsApp do cliente

Essa separação permite:

1. **Validar a qualidade das respostas** em produção sem risco de cliente real receber algo errado
2. **Auditar decisões** (confiança, handoffs, verificações anti-alucinação) antes de liberar envio real
3. **Rodar o gabarito/eval** contra dados reais de produção
4. **Iterar prompts** e comportamento sem impactar clientes

## Como funciona

### Controle via variável de ambiente

O modo sombra é controlado pela variável `IA_ENVIO_REAL` no `.env` de `apps/whatsapp-worker`:

```bash
# Modo sombra (padrão, seguro)
IA_ENVIO_REAL=false

# Envio real (só depois de validação completa)
IA_ENVIO_REAL=true
```

**IMPORTANTE:** A ausência da variável ou qualquer valor diferente de `"true"` (string exata) mantém o modo sombra ativo. Isso garante segurança por padrão (fail-safe).

### Fluxo de uma mensagem em modo sombra

```
Cliente envia mensagem
  ↓
whatsapp-worker grava em `mensagens` (remetente: "cliente")
  ↓
ai-orchestrator poller detecta mensagem nova
  ↓
Investigador busca dados, redator escreve resposta
  ↓
Resposta gravada em `mensagens` (remetente: "ia")
  ↓
whatsapp-worker poller busca mensagens pendentes
  ↓
if (remetente === "ia" && !env.iaEnvioReal) {
  // NÃO chama client.sendMessage()
  // Apenas loga e marca como simulada
  metadata_json.simulado_em = now()
}
  ↓
Resposta fica visível no painel mas nunca foi enviada ao WhatsApp
```

### Armazenamento no banco

Mensagens da IA em modo sombra têm `metadata_json.simulado_em` preenchido em vez de `metadata_json.enviado_em`:

```sql
-- Respostas simuladas (modo sombra)
SELECT * FROM mensagens
WHERE remetente = 'ia'
  AND metadata_json->>'simulado_em' IS NOT NULL
  AND metadata_json->>'enviado_em' IS NULL;

-- Respostas enviadas de verdade
SELECT * FROM mensagens
WHERE remetente = 'ia'
  AND metadata_json->>'enviado_em' IS NOT NULL;
```

## Observabilidade

### Logs

O `whatsapp-worker` loga cada resposta simulada:

```
[poller] (modo sombra) resposta de IA NÃO enviada de verdade — atendimento abc123: "Olá! Como posso ajudar?"
```

O `ai-orchestrator` avisa no boot:

```
[ai-orchestrator] lembrete: a entrega real ao WhatsApp depende de IA_ENVIO_REAL no whatsapp-worker —
enquanto false, respostas ficam em modo sombra (geradas e auditadas, nunca enviadas de verdade).
```

### Auditoria via SQL

Ver todas as respostas geradas pela IA nas últimas 24h (simuladas ou não):

```sql
SELECT
  a.id AS atendimento_id,
  c.nome AS cliente,
  m.conteudo AS resposta_ia,
  m.criado_em,
  CASE
    WHEN m.metadata_json->>'simulado_em' IS NOT NULL
    THEN 'SIMULADO (modo sombra)'
    WHEN m.metadata_json->>'enviado_em' IS NOT NULL
    THEN 'ENVIADO de verdade'
    ELSE 'PENDENTE envio'
  END AS status_envio,
  d.confianca,
  d.acao_decidida
FROM mensagens m
JOIN atendimentos a ON m.atendimento_id = a.id
JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN ia_decisoes d ON m.id = (
  SELECT mensagem_id FROM ia_decisoes WHERE atendimento_id = a.id ORDER BY criado_em DESC LIMIT 1
)
WHERE m.remetente = 'ia'
  AND m.criado_em > NOW() - INTERVAL '24 hours'
  AND m.empresa_id = 'sua-empresa-id'
ORDER BY m.criado_em DESC;
```

Contar quantas respostas foram simuladas vs enviadas:

```sql
SELECT
  empresa_id,
  COUNT(*) FILTER (WHERE metadata_json->>'simulado_em' IS NOT NULL) AS simuladas,
  COUNT(*) FILTER (WHERE metadata_json->>'enviado_em' IS NOT NULL) AS enviadas
FROM mensagens
WHERE remetente = 'ia'
  AND criado_em > NOW() - INTERVAL '7 days'
GROUP BY empresa_id;
```

## Critérios para desligar o modo sombra

**Nunca** mude `IA_ENVIO_REAL=true` antes de validar TODOS estes pontos:

### ✅ Pré-requisitos técnicos (P0)

- [x] **Gabarito/eval existe e passa 100%** — ver `apps/ai-orchestrator/src/eval/gabarito.ts`
- [x] **Histórico completo de mensagens** — IA tem contexto real da conversa
- [x] **Anti-alucinação ampliada** — além de `R$`, veta PDF/código/produto não-verificado
- [x] **Tipos sem fonte vetados** — afirmações comerciais/genéricas sem `fonte_tool_execucao_id` não passam pro atendente
- [ ] **Guard contra prompt injection** — conhecimento/ferramentas maliciosos não podem sequestrar a IA (P1, em andamento)

### ✅ Pré-requisitos de produto (P1)

- [x] **Comportamento JSON validado** — `ia_configuracoes.comportamento_json` em uso
- [x] **Matriz de decisão alinhada** — confiança média → investigar mais (não handoff imediato)
- [x] **Identidade da IA honesta** — nunca mente dizendo que é humana
- [x] **Mídia → handoff** — imagem/áudio do cliente vai pra humano, não fica em silêncio
- [ ] **Sessões de IA em uso** — memória estruturada derivada da conversa (P1, em andamento)

### ✅ Validação em produção

- [ ] **Auditoria manual de 50+ respostas simuladas** — representativas de casos reais diversos
- [ ] **Taxa de handoff aceitável** — não está transferindo TODO atendimento nem respondendo TUDO sem critério
- [ ] **Zero alucinações de preço** — NUNCA inventa valor, sempre vem do catálogo real
- [ ] **Zero promessas não-suportadas** — não oferece PDF, link, imagem, código quando não existe
- [ ] **Confiança correlacionada com qualidade** — respostas de confiança alta são realmente boas

### ✅ Decisão de negócio

- [ ] **Empresa piloto escolhida e alinhada** — sabe que é piloto, aceita risco, pode dar feedback rápido
- [ ] **SLA de handoff definido** — quanto tempo humano demora pra assumir quando a IA transfere
- [ ] **Plano de rollback claro** — como voltar pra modo sombra se der errado (só mudar .env e reiniciar)

## Como ligar o envio real (quando chegar a hora)

1. **Validar todos os critérios acima** — não pule nenhum
2. **Rodar o gabarito uma última vez:**
   ```bash
   npm run -w apps/ai-orchestrator eval
   ```
3. **Fazer backup da base** (Supabase dashboard → Database → Backup)
4. **Atualizar `.env` de `apps/whatsapp-worker`:**
   ```bash
   IA_ENVIO_REAL=true
   ```
5. **Reiniciar o processo:**
   ```bash
   # Se estiver rodando com npm run dev
   Ctrl+C e npm run dev novamente

   # Se estiver em produção (PM2, Docker, etc)
   pm2 restart whatsapp-worker
   # ou
   docker-compose restart whatsapp-worker
   ```
6. **Verificar logs:**
   ```bash
   # O log de "modo sombra" NÃO deve mais aparecer
   # Você deve ver confirmações de envio real:
   tail -f apps/whatsapp-worker/logs/app.log
   ```
7. **Monitorar ativamente nas primeiras 2 horas:**
   - Acompanhar via painel Kanban
   - Ler as respostas enviadas de verdade
   - Estar pronto pra voltar pra modo sombra se aparecer algo errado

## Rollback de emergência

Se algo der errado depois de ligar o envio real:

1. **Pausar imediatamente:**
   ```bash
   # Matar o processo
   pm2 stop whatsapp-worker
   # ou Ctrl+C no terminal
   ```
2. **Reverter `.env`:**
   ```bash
   IA_ENVIO_REAL=false
   ```
3. **Subir de novo:**
   ```bash
   pm2 start whatsapp-worker
   # ou npm run dev
   ```
4. **Investigar o problema:**
   - Revisar `ia_decisoes` do período
   - Ler as mensagens que foram enviadas de verdade
   - Rodar o gabarito pra confirmar se alguma regressão foi introduzida
   - Ajustar prompts/verificações conforme necessário
5. **Só religar envio real depois de corrigir a causa raiz**

## Relação com outros sistemas

### Modo teste com whitelist

O **modo teste** (`apps/whatsapp-worker/src/lib/whitelist.ts`) é ORTOGONAL ao modo sombra:

- **Modo sombra:** controla se respostas da IA são enviadas de verdade
- **Modo teste:** controla se QUALQUER mensagem (humano ou IA) é enviada pra números fora da whitelist

Você pode (e deve) combinar os dois no início:

```bash
# .env do whatsapp-worker
IA_ENVIO_REAL=false              # IA não envia nada de verdade
MODO_TESTE=true                  # Só envia pra números da whitelist
WHITELIST_NUMEROS=5511999999999  # Seu número de teste
```

Isso permite testar o envio real de mensagens HUMANAS sem risco, enquanto a IA ainda fica simulada.

### Gabarito/eval

O gabarito (`apps/ai-orchestrator/src/eval/gabarito.ts`) **não depende** do modo sombra — ele cria seu próprio cliente/atendimento descartável e testa diretamente a função `processarMensagem()`, sem passar pelo poller do WhatsApp.

Mas o modo sombra é pré-requisito para **ligar** o envio real: você precisa do gabarito passando 100% antes de mudar `IA_ENVIO_REAL=true`.

### Handoffs

Handoffs (IA → humano) funcionam IGUAL em modo sombra e envio real:

- A IA sempre cria o registro em `ia_handoffs`
- O atendimento sempre muda pra status adequado (`aguardando_atendente` ou outro)
- O Kanban sempre mostra a transferência
- A diferença: se a IA gerou uma mensagem de confirmação de transferência ("Ok, vou chamar um atendente"), essa mensagem só chega no WhatsApp do cliente se `IA_ENVIO_REAL=true`

## FAQ

**P: Se a IA não envia respostas, como eu testo se ela funciona?**

R: Você vê as respostas geradas no painel (aba Conversas do atendimento). Elas estão lá, completas, só não foram pro WhatsApp. Você pode ler, auditar, e confirmar se faria sentido enviar aquilo de verdade.

**P: Mensagens de humano são enviadas mesmo em modo sombra?**

R: **Sim.** O modo sombra só afeta mensagens com `remetente = 'ia'`. Mensagens de `remetente = 'humano'` sempre são enviadas de verdade (sujeitas ao modo teste com whitelist, se ativo).

**P: Posso ligar o envio real só pra alguns atendimentos/clientes?**

R: Hoje não — é global por empresa. Se você quer pilotar com segurança, use o **modo teste** (whitelist de números): deixe `IA_ENVIO_REAL=true` + `MODO_TESTE=true` + `WHITELIST_NUMEROS` só com o número do cliente piloto. Assim a IA envia de verdade, mas só pra quem você autorizou explicitamente.

**P: Se eu religar o modo sombra depois de ter enviado de verdade, o que acontece com mensagens antigas?**

R: Nada. Mensagens já enviadas (`metadata_json.enviado_em` preenchido) não mudam. Só as NOVAS mensagens geradas a partir daquele momento voltam a ser simuladas.

**P: O modo sombra consome tokens da API do DeepSeek?**

R: **Sim.** A investigação e redação acontecem normalmente, com chamadas reais ao LLM. A única coisa que não acontece é o `client.sendMessage()` final do WhatsApp.

**P: Quando o ROADMAP diz "gabarito/eval existir", isso tá pronto?**

R: **Sim** — ver `tasks/0001-gabarito_eval.md` (status: concluído). O gabarito existe, cobre 16 casos (determinísticos + E2E), e passa 100%. Rode com `npm run -w apps/ai-orchestrator eval`.

## Referência de código

- **Controle da flag:** `apps/whatsapp-worker/src/lib/env.ts` (linha 16)
- **Lógica de envio:** `apps/whatsapp-worker/src/poller.ts` (linhas 49–58)
- **Aviso no boot:** `apps/ai-orchestrator/src/index.ts` (linhas 42–44)
- **Exclusão de simuladas:** `apps/ai-orchestrator/src/poller.ts` (linha 109)

---

**Última atualização:** 2026-08-26
**Status da tarefa:** Concluída (tarefa P0 do ROADMAP)
