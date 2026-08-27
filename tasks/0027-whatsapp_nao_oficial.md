# `whatsapp-web.js` não é a API oficial do WhatsApp Business

**Status:** desmembrada em subtarefas (ver abaixo) — este arquivo é a referência de contexto/risco, não é mais item avulso do ROADMAP
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

**Desmembrada em (2026-08-27, épico de 13 SP quebrado em subtarefas menores):**
1. [Monitorar risco atual + critério de decisão (0060)](0060-whatsapp_monitorar_risco.md) — `SP: 2`
2. [Avaliar provedores oficiais (0061)](0061-whatsapp_avaliar_provedores.md) — `SP: 3`
3. [Migrar `whatsapp-worker` para API oficial (0062)](0062-whatsapp_migrar_api_oficial.md) — `SP: 8`

Decisão consciente de manter por enquanto (mais rápido de prototipar), mas carrega risco real de banimento do número pela Meta — vale revisitar antes de qualquer empresa real depender disso em produção. **Exemplo concreto do risco, confirmado em teste real:** `message.downloadMedia()` (usado na ingestão de mídia, ver tarefa `Cliente manda imagem/áudio`) falha com erro minificado opaco (`r: r`) pra praticamente toda mídia recebida — bug ativo e aberto na própria lib ([issue #201828](https://github.com/wwebjs/whatsapp-web.js/issues/201828), [#201833](https://github.com/wwebjs/whatsapp-web.js/issues/201833), reportado jul/2026), já na versão mais recente estável (`1.34.7`, a última correção conhecida de `downloadMedia` foi na `1.34.3` e mesmo assim quebrou de novo — o WhatsApp Web muda a implementação interna do lado deles sem aviso). Sem workaround determinístico do nosso lado — o código já faz retentativa (`lib/media.ts`) e degrada graciosamente pra um indicativo visual "sem preview" + handoff sempre criado (nunca silêncio), mas a mídia em si não é recuperável enquanto o bug estiver aberto upstream. Ação: monitorar as issues linkadas; considerar `2.0.0-alpha.0` só depois de mais maturidade (major version, risco de breaking changes).
