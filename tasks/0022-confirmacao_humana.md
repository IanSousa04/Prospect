# Fluxo de confirmação humana fora do texto livre

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

`estado_json.aguardando_confirmacao` com hash+expiração — depende de `ia_sessoes` estar em uso (ver tarefa `ia_sessoes em uso`).

**Lacuna real encontrada antes de implementar:** `OrderContext.confirmado` (campo que `informacoesPendentes()` já checava desde a tarefa 0055) nunca era setado por nenhum código — a única coisa que impedia `criar_pedido` de disparar cedo demais era o LLM seguir a regra 11 do prompt do Investigador ("só chame depois que o cliente confirmar explicitamente"). Não havia nenhuma checagem determinística de que um resumo foi de fato apresentado, que o carrinho não mudou desde então, ou que a "confirmação" não era de uma rodada muito antiga da conversa.

**Implementado:**
- `packages/shared/src/pedido-ia.ts` — `AguardandoConfirmacao { hash, expiraEm, resumoTexto }`, `calcularHashConfirmacao(pedido)` (hash determinístico, não criptográfico, de itens+entrega+endereço+pagamento — ordem dos itens não afeta o resultado), `construirResumoTexto(pedido)`. `ResumoPedidoIa`/`resumoPedidoIa()` ganharam o campo `aguardando_confirmacao` (opcional no segundo parâmetro, retrocompatível).
- `apps/ai-orchestrator/src/agent/sessao.ts` — `aguardando_confirmacao` como irmão de `pedido` em `EstadoSessao` (estado da conversa, não do carrinho em si), com `carregarConfirmacaoPendente`/`salvarConfirmacaoPendente`.
- `apps/ai-orchestrator/src/tools/carrinho.ts` — `consultar_carrinho` agora refresca (ou limpa) a confirmação pendente toda vez que é chamado, determinístico, sem depender do LLM lembrar de gerar nada.
- `apps/ai-orchestrator/src/tools/pedido.ts` — `criar_pedido` agora exige uma confirmação pendente válida (hash bate com o pedido ATUAL recalculado, ainda dentro da janela de 10 minutos) antes de sequer chegar ao gate de risco (tarefa 0023); recusa com `erro:"confirmacao_expirada_ou_invalida"` caso contrário, e limpa a confirmação usada depois de criar com sucesso.
- `apps/ai-orchestrator/src/agent/investigador.ts` — nova rede de segurança `sintetizarAfirmacaoDeConfirmacaoExpirada`: trata a recusa como situação normal de conversa (nunca handoff, nunca silêncio) — sintetiza a explicação + um resumo fresco do carrinho (usando a evidência de `consultar_carrinho` desta mesma rodada) pra o Atendente reapresentar e perguntar de novo.
- `apps/api/src/routes/atendimentos.ts` + `apps/web/src/pages/Atendimento.tsx` — GET `/atendimentos/:id/carrinho` expõe `aguardando_confirmacao`; painel mostra "Aguardando confirmação do cliente — expira às HH:MM" (só leitura — editar o carrinho pela UI já invalida a confirmação automaticamente, tanto pelo hash não bater mais quanto por `salvarPedidoIa` limpar o campo explicitamente).
- 8 novos casos determinísticos no gabarito. Gabarito completo: 84/84.
