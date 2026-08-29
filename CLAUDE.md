# CLAUDE.md

Instruções permanentes para qualquer agente Claude (interativo ou autônomo) trabalhando neste repositório.

## O que é este projeto

Plataforma SaaS de atendimento e vendas conversacionais via WhatsApp para negócios de alimentação (hamburguerias, pizzarias, restaurantes, etc). Visão de produto, fases do MVP e todas as pendências vivem em [ROADMAP.md](ROADMAP.md) — **leia isso antes de planejar qualquer funcionalidade**.

O repositório está em transição: o código do MVP anterior (prospecção outbound) foi removido; apenas `supabase/migrations/` foi mantido e será reaproveitado. A aplicação será construída do zero para este novo domínio.

**Referência de arquitetura de IA — projeto Eddy:** `C:\Dev\Claude\Eddy` é um agente de suporte multi-repositório em produção que já implementa, no mesmo padrão que este produto precisa, a separação investigador/redator, cálculo de confiança com verificação de citação, ingestão versionada e sistema de gabaritos/eval. Ao implementar qualquer parte de IA/orquestração/avaliação, consulte o código real do Eddy (especialmente `apps/query-api/src/agent.ts` e `docs/ROADMAP.md`) em vez de reinventar o padrão.

## Regras invioláveis

Estas regras vêm diretamente da especificação de produto e não podem ser contornadas por conveniência de implementação, prazo ou "vamos simplificar por enquanto":

1. **A IA nunca inventa dados comerciais.** Preço, disponibilidade, adicionais, promoções, regras, taxas, horários — tudo vem do catálogo/conhecimento real, nunca de suposição do modelo. Qualquer resposta de IA sem fonte de dados rastreável é um bug.
2. **A IA nunca infere permissões.** Toda ação (criar pedido, cancelar, aplicar desconto, etc.) deve checar uma permissão explícita configurada pela empresa antes de executar. Ausência de configuração = ação negada, nunca permitida por padrão.
3. **Separação orquestrador / atendente.** A camada que investiga (busca dados, chama ferramentas, raciocina) é distinta da camada que fala com o cliente. Detalhes internos de investigação (IDs técnicos, nomes de ferramentas, raciocínio bruto do modelo) nunca vazam para a mensagem do WhatsApp.
4. **Handoff sempre estruturado.** Quando a IA escala para humano, gera contexto estruturado (cliente, motivo, pedido relacionado, resumo, ação sugerida, prioridade, origem) — nunca apenas "vou te transferir".
5. **Isolamento multi-tenant absoluto.** Toda query, ferramenta de IA e endpoint deve ser escopado por empresa (tenant). Vazamento de dado entre empresas é tratado como incidente de segurança, não como bug comum.
6. **Ações irreversíveis exigem confiança alta + baixo risco + permissão explícita.** Confiança alta sozinha não basta se o risco ou o impacto financeiro for alto — nesse caso, handoff.
7. **Custo real de mensageria.** Todo envio automático de mensagem ao WhatsApp de um cliente é uma ação com custo e risco reputacional real — nunca simule "sucesso" sem confirmação da API, e nunca envie mensagens em loop sem rate limiting.
8. **Todo estado novo que a IA passa a gerenciar precisa ser gerenciável por um humano na UI, sobre o MESMO estado — nunca um estado paralelo.** Exemplo real: o carrinho em construção que a IA monta (`ia_sessoes.estado_json.pedido`) precisa poder ser editado por um atendente humano que assuma a conversa no meio do processo (adicionar/remover item, mudar tipo de entrega, forma de pagamento etc.), vendo e mexendo exatamente no que a IA já tinha montado — nunca obrigando o humano a recomeçar do zero num pedido desconectado. Toda tarefa do ROADMAP que introduz um novo campo/estrutura de estado gerenciado pela IA deve, na mesma tarefa ou numa tarefa companheira explicitamente referenciada, cobrir também o gerenciamento desse estado pela UI.
9. **A LLM nunca tem autoridade sobre estado transacional.** Ela é usada para compreensão de linguagem e geração de texto; o workflow, as transições de estado, a execução de ferramentas e a autorização para confirmar um pedido são controlados deterministicamente por código. Em concreto: a LLM pode ROTULAR a mensagem do cliente (intenção, dados estruturados), mas quem decide quais ferramentas precisam rodar é código puro — toda ferramenta que muta estado transacional é `somenteWorkflow` e nem aparece na lista oferecida ao modelo; depois de mutar, o estado é sempre relido do banco e validado antes de avançar de etapa (MUTATE → READ → VALIDATE → NEXT STATE), nunca se confiando no retorno que a própria tool montou em memória; e nenhuma afirmação transacional chega ao cliente sem evidência persistida correspondente (`pedido_id`, `handoff_id`). A frase que resume: **a LLM nunca pode declarar que uma ação transacional aconteceu se o backend não tiver evidência persistida de que ela aconteceu.** Ver o padrão implementado em [tasks/0081](tasks/0081-workflow_deterministico_checkout.md) e reaproduzi-lo em qualquer tool de escrita nova, em vez de corrigir alucinação transacional aumentando prompt ou ampliando regex.

## Antes de implementar

- Verifique se a funcionalidade está descrita em `ROADMAP.md`. Se não estiver, pare e confirme com o usuário antes de inventar comportamento.
- Para qualquer mudança que toque IA (prompts, ferramentas, orquestração, permissões, catálogo semântico, handoff), rode a skill `food-ai-guardrails` antes de considerar a tarefa concluída.
- Para mudanças de schema/dados que afetam mais de uma empresa (tenant), confirme explicitamente o impacto de isolamento antes de aplicar.

## Convenções de código

- Workspaces npm (`apps/*`, `packages/*`). Tipos compartilhados ficam em `packages/shared`.
- TypeScript em todo lugar; evite `any` em código de domínio (catálogo, pedidos, permissões, IA).
- Sem comentários explicando o óbvio; comente só decisões não-óbvias (ex.: por que uma regra de negócio existe).
- Não adicionar abstrações, feature flags ou fallbacks para cenários que não existem no escopo da fase atual.

## Segurança e dados sensíveis

- Nunca commitar `.env`, chaves de API (DeepSeek, Supabase, WhatsApp) ou tokens.
- Dados de clientes finais (telefone, histórico de pedidos, conversas) são dados pessoais — trate com o mesmo cuidado de PII em qualquer query, log ou export.
