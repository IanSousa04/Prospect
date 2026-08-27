# Modo teste com whitelist de números

**Status:** concluído
**Prioridade:** P2 (seção 3, sem tag explícita no item original)
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Implementado: migration `0011_modo_teste_whitelist.sql` adiciona `ia_configuracoes.modo_teste` e a tabela `numeros_whitelist` (`empresa_id`, `telefone`, `ativo`), ambas escopadas por empresa com RLS. `apps/whatsapp-worker/src/lib/whitelist.ts` (`permiteIngestao`) é checado em `index.ts` antes de `ingerirMensagemCliente`, no mesmo lugar dos filtros de grupo/mensagem vazia já existentes — número fora da whitelist (ou `ativo=false`) com `modo_teste=true` não gera `cliente`, `atendimento` nem `mensagem`. Gerenciável via UI em Configurações → IA (`apps/web/src/pages/ConfiguracoesIa.tsx`), com rotas `apps/api/src/routes/modo-teste.ts` (`GET/PUT /modo-teste`, `POST/PATCH/DELETE /modo-teste/numeros/:id`). Bloquear na ingestão já resolve o `ai-orchestrator` por consequência, como planejado (ele só processa o que existe em `mensagens`).

**Extensão — comando `/exit`:** `apps/whatsapp-worker/src/lib/comando-teste.ts` (`apagarAtendimentosDeTeste`) — em modo teste, mensagem `/exit` de um número whitelisted apaga todos os atendimentos daquele telefone (cascata cuida de mensagens/handoffs/decisões de IA), sem gerar mensagem nem passar pela IA. Permite recomeçar um teste do zero sem precisar da UI.

**Extensão — descrição do handoff via WhatsApp:** `apps/ai-orchestrator/src/handoffs.ts` (`criarHandoff`) — em modo teste, todo handoff manda de volta uma mensagem de texto com origem/prioridade/motivo/resumo/ação sugerida (montada em código, nunca pelo LLM), reaproveitando o mesmo caminho de envio de qualquer mensagem de IA (sujeito à mesma flag `IA_ENVIO_REAL` de sempre — sem ela, fica em modo sombra igual a qualquer outra resposta). Dá pra testar o fluxo inteiro só com o celular, sem abrir o painel pra ver o Kanban/handoffs.
