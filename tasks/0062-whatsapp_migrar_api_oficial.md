# Migrar `whatsapp-worker` para a API oficial do WhatsApp Business

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`whatsapp-web.js` não é a API oficial (0027)](0027-whatsapp_nao_oficial.md), passo 3 de 3
**Depende de:** provedor escolhido (0061)

Implementação completa: trocar o modelo atual (sessão de navegador via Puppeteer, pareada por QR code, `LocalAuth`) por integração com o provedor escolhido em 0061 — normalmente inversão do fluxo de recebimento (webhook recebendo eventos em vez do worker escutando uma sessão), reimplementação do envio de mensagem/mídia, e um novo fluxo de vinculação de número por empresa (substitui o QR code atual). Cutover por empresa, não big-bang: cada empresa piloto migra individualmente, com o `whatsapp-web.js` continuando disponível como fallback até todas migrarem. Efeito colateral esperado: resolve de vez o bug de `downloadMedia()` (0009, 0060) e destrava a tarefa 0024 num sentido — API oficial via webhook remove a restrição técnica de "1 processo por empresa" que hoje vem do Puppeteer/`LocalAuth`, então esta migração pode simplificar ainda mais a topologia-alvo de 0024 (o worker por empresa deixa de ser uma restrição técnica).
