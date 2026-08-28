# Teste de performance do Kanban com muitas conversas

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 6. Pedidos (Fase 3)
**Depende de:** [Kanban unificado (0067)](0067-kanban_unificado.md) — testar a versão final, não a atual

Pedido do usuário (validação, não feature): confirmar se o Kanban aguenta um volume real de conversas simultâneas antes de considerar o board unificado pronto. Hoje `GET /atendimentos` (`apps/api/src/routes/atendimentos.ts`) busca TODOS os atendimentos da empresa numa query só, sem paginação nem limite — com poucas dezenas de conversas (cenário atual de empresas piloto) isso não é problema, mas não foi validado com volume maior.

## Escopo

- Script de carga (ex. `apps/api/src/scripts/` ou similar, fora do código de produção) que insere um número configurável de atendimentos + mensagens + handoffs/pedidos fake numa empresa de teste (nunca rodar contra dados reais de uma empresa cliente) — variar de centenas a milhares de linhas pra achar o ponto de degradação.
- Medir: tempo de resposta de `GET /atendimentos`, tempo de render do Kanban no navegador (React re-render de centenas de cards de uma vez), e o comportamento do canal realtime do Supabase (`Kanban.tsx` recarrega a lista inteira a cada evento — com muita atividade simultânea isso pode virar uma rajada de refetches).
- Se a degradação aparecer antes de um volume razoável (definir o que é "razoável" pro estágio atual do produto — sugestão: validar até uns 500-1000 atendimentos ativos, bem acima do que qualquer empresa piloto real deve ter tão cedo), considerar: paginação/virtualização de lista no Kanban, debounce no listener de realtime (hoje recarrega tudo a cada evento — trocar por um patch incremental do atendimento/pedido específico que mudou, em vez de refetch completo), ou filtrar `resolvido`/arquivados fora da query por padrão (o board unificado da 0066 já faz isso, o que já ajuda bastante).
- Resultado esperado desta tarefa: um relatório/registro do que foi medido e, se necessário, tarefas de otimização derivadas — não necessariamente uma otimização já implementada, a menos que a degradação apareça num volume baixo o suficiente pra ser urgente.
