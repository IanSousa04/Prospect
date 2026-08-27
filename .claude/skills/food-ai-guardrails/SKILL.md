---
name: food-ai-guardrails
description: Checklist de segurança e UX obrigatório antes de finalizar qualquer tarefa que toque comportamento da IA de atendimento, ferramentas/orquestrador, catálogo semântico, permissões, handoff ou mensageria WhatsApp. Use sempre que a mudança envolver prompts, tools de IA, regras de negócio de venda/pedido, ou dados que a IA consulta.
---

# Guardrails da IA de Atendimento (Food Service)

Esta skill existe porque a plataforma vende comida de verdade para clientes reais via WhatsApp. Um erro de preço, uma permissão mal checada ou um handoff mal formado tem impacto financeiro e reputacional direto para o dono do negócio — não é só um bug de UI.

Referência completa de produto: `docs/product/` (especialmente `04-catalogo.md`, `05-ia-conhecimento.md` e `03-atendimento-e-crm.md`). Regras invioláveis: `CLAUDE.md` na raiz.

## Quando usar

Rode este checklist antes de considerar concluída qualquer tarefa que:

- Altere prompts, system messages ou comportamento do agente conversacional.
- Adicione, altere ou remova uma ferramenta (tool) que a IA pode chamar.
- Toque na camada semântica do catálogo (como produtos/preços/regras viram contexto para a IA).
- Altere lógica de permissões, confiança, risco ou decisão de handoff.
- Altere o que é enviado automaticamente ao WhatsApp do cliente.
- Altere isolamento multi-tenant em qualquer query ou tool usada pela IA.

## Checklist

### 1. Fundamentação em dados
- [ ] Toda informação que a IA pode citar (preço, disponibilidade, adicional, promoção, taxa, horário) vem de uma consulta real ao catálogo/conhecimento — nunca de texto fixo no prompt ou "conhecimento geral" do modelo.
- [ ] Se a informação não for encontrada, o comportamento correto é admitir a lacuna ou fazer handoff — nunca inventar uma resposta plausível.

### 2. Permissões
- [ ] A ação que a IA está prestes a executar (criar pedido, alterar, cancelar, aplicar desconto, etc.) tem uma checagem explícita de permissão configurada pela empresa.
- [ ] Ausência de configuração de permissão resulta em ação **negada**, nunca permitida por padrão.
- [ ] Ações de alto impacto financeiro (desconto, cancelamento, reembolso) exigem confiança alta + baixo risco + permissão explícita — caso contrário, handoff.

### 3. Separação orquestrador / atendente
- [ ] Nenhum detalhe interno (nome de ferramenta, ID técnico, raciocínio bruto do modelo, erro de sistema cru) pode aparecer na mensagem enviada ao cliente no WhatsApp.
- [ ] A camada de investigação (busca de dados) e a camada de resposta ao cliente permanecem desacopladas — teste isso lendo a mensagem final como se fosse o cliente.

### 4. Handoff
- [ ] Todo handoff gera um objeto de contexto estruturado: cliente, motivo, pedido relacionado (se houver), resumo, ação sugerida, prioridade e origem (cliente solicitou / IA solicitou / regra operacional / falha de conhecimento / ação sem permissão / alto risco).
- [ ] A mensagem que o cliente recebe ao ser transferido é clara e não técnica.

### 5. Multi-tenant
- [ ] Toda query nova ou alterada (incluindo as usadas por ferramentas de IA) filtra explicitamente por `empresa_id`/tenant — nunca depende apenas de RLS implícito sem verificação.
- [ ] Testado (ou pelo menos considerado) o cenário de duas empresas com dados parecidos para garantir que não há vazamento cruzado.

### 6. Mensageria WhatsApp
- [ ] Envio de mensagem só é considerado bem-sucedido após confirmação real da API — nunca assumido como "enviado" antes disso.
- [ ] Não há risco de loop de mensagens ou envio duplicado para o mesmo cliente/pedido.

### 7. UX operacional (painel admin)
- [ ] Informações técnicas de debug (contexto da IA, ferramentas usadas, confiança) ficam visíveis só para o administrador (ex.: simulador, painel de contexto do atendimento) — nunca vazam para telas do cliente.
- [ ] Estados visuais seguem o padrão de cores definido em `docs/product/07-ux-multitenant-fluxos.md` §7.1 (roxo discreto=IA, âmbar=IA pediu ajuda, vermelho=cliente pediu ajuda, azul=humano atendendo, cinza=resolvido) — vermelho é reservado só pro caso mais urgente, nunca usado pra IA.

## Ao final

Se algum item não se aplica, está tudo bem — mas registre mentalmente/por que não se aplica em vez de pular silenciosamente. Se algum item falhar, a tarefa não está pronta, independentemente de testes automatizados passarem.
