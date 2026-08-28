# Verificar endereço informado via API simples e gratuita

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3.1 Fechar o ciclo comercial da IA (realizar pedido)

Hoje `definir_endereco_entrega` (`apps/ai-orchestrator/src/tools/carrinho.ts`) salva qualquer texto que o cliente informar (rua, número, bairro, cidade) sem checar se o endereço existe de verdade — um erro de digitação ou um endereço inválido só é percebido na hora da entrega, tarde demais.

## O que fazer

- Integrar uma API gratuita de geocoding/CEP para validar o endereço informado antes de salvar (ex.: Nominatim/OpenStreetMap para geocoding por endereço completo, ou ViaCEP como complemento pra validar/preencher bairro e cidade a partir do CEP quando o cliente informar um). Escolher com base em: gratuita, sem necessidade de cartão/chave paga, e limites de uso compatíveis com o volume esperado.
- Se a API não encontrar o endereço informado, a tool não salva de cara — devolve um resultado indicando "endereço não encontrado", pra o Investigador reportar isso e o Atendente pedir confirmação/correção ao cliente (nunca salvar um endereço não verificável como se fosse válido).
- Isso é uma fonte de dado adicional, não uma trava absoluta: se a API estiver fora do ar ou não cobrir a região (comum em bairros novos/rurais), o fluxo não pode travar o pedido inteiro — precisa de um caminho de fallback (ex.: aceitar mesmo sem confirmação, sinalizando pro humano revisar) em vez de virar handoff silencioso.
- Nunca expor detalhes técnicos da chamada de API (erro cru, payload) na mensagem ao cliente (CLAUDE.md regra 3).
- Rodar a skill `food-ai-guardrails` ao final (toca ferramenta de IA).
