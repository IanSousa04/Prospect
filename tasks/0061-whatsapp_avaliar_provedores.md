# Avaliar provedores oficiais de WhatsApp Business API

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além
**Subtarefa de:** [`whatsapp-web.js` não é a API oficial (0027)](0027-whatsapp_nao_oficial.md), passo 2 de 3
**Depende de:** critério de decisão definido (0060)

Pesquisa e decisão arquitetural, sem código ainda: comparar Meta Cloud API (direta, sem intermediário, mas cobrança por conversa/template e onboarding mais burocrático) contra BSPs (Business Solution Providers — ex. Twilio, 360dialog, Zenvia) que simplificam onboarding/billing em troca de uma camada a mais de custo/dependência. Critérios: custo por conversa/empresa piloto, tempo de aprovação de número, suporte a mídia (áudio/imagem/vídeo/documento — hoje o ponto mais frágil do `whatsapp-web.js`, ver 0009), e o quanto cada opção exige mudar o modelo de entrega de mensagem (webhook recebendo eventos, em vez do polling atual sobre uma sessão de navegador). Resultado esperado: decisão documentada de qual provedor usar e desenho de alto nível da migração — vira input pra 0062.
