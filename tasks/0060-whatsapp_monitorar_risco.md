# Monitorar risco atual de `whatsapp-web.js` e critério de decisão de migração

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`whatsapp-web.js` não é a API oficial (0027)](0027-whatsapp_nao_oficial.md), passo 1 de 3

Trabalho contínuo, não uma entrega única: acompanhar as issues upstream que já afetam produção (`message.downloadMedia()` falhando com erro opaco pra praticamente toda mídia recebida — [issue #201828](https://github.com/wwebjs/whatsapp-web.js/issues/201828), [#201833](https://github.com/wwebjs/whatsapp-web.js/issues/201833)) e qualquer sinal novo de instabilidade/banimento. Definir explicitamente o critério de "quando migrar de verdade" (e não só monitorar pra sempre) — ex.: primeiro cliente pagante real assumindo volume de produção, ou um banimento de número acontecendo. Sem isso definido, as tarefas 0061/0062 (avaliação de provedor e migração) nunca têm gatilho claro pra começar.
