# Topologia de processos do `ai-orchestrator` — migrar de "1 processo por empresa" para "1 processo compartilhado"

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

O `apps/whatsapp-worker` precisa continuar um processo por empresa: `whatsapp-web.js` amarra uma sessão de navegador (Puppeteer) a um número de WhatsApp específico, pareado por QR code e persistido via `LocalAuth` — um único `Client` não multiplexa múltiplas contas, restrição técnica da própria lib, não escolha de arquitetura. Já o `ai-orchestrator` não tem essa restrição: não mantém sessão externa persistente por empresa, só faz *polling* na tabela `mensagens`, chama o DeepSeek, grava a resposta — conceitualmente igual ao `apps/api`, que já serve todas as empresas de um processo só, escopando cada query por `empresa_id`. Toda a lógica de negócio já escrita (`tools/registry.ts`, `agent/*`, `poller.ts`) já filtra por `empresaId` como parâmetro de contexto, não variável de ambiente global — trocar "um `EMPRESA_ID` fixo" por "iterar sobre `empresas where status='ativo'`" não exige redesenho, só um loop no nível mais externo do polling.

Vantagens de centralizar: menos processos por empresa nova (+1 em vez de +2), rate limit/custo do DeepSeek centralizados, caminho de escala mais natural (sharding por `empresa_id` se o volume crescer, sem voltar ao modelo antigo).

Trade-off aceito: hoje se o `ai-orchestrator` de uma empresa trava, só ela é afetada; centralizado, um bug afeta todas até o restart — aceitável na escala atual (poucas empresas piloto), mitigado por `try/catch` isolando falha por empresa dentro do ciclo de polling (hoje só existe isolamento por mensagem individual) e concorrência **limitada** entre empresas por ciclo (ex. 3-4 em paralelo, nunca todas de uma vez nem sequencial puro — sequencial criaria *head-of-line blocking*).

Trabalho de implementação: (1) remover `EMPRESA_ID` de `apps/ai-orchestrator/.env.example`/`lib/env.ts`; (2) `poller.ts`: loop sobre empresas ativas com concorrência limitada e `try/catch` por empresa; (3) `DEEPSEEK_API_KEY`/credenciais Supabase deixam de ser "por empresa"; (4) nenhuma mudança necessária em `tools/`, `agent/`, `handoffs.ts`.

Topologia alvo: **N `whatsapp-worker` (um por empresa) : 1 `ai-orchestrator` (todas as empresas) : 1 `api`**.

**Nota (tarefa 0062):** a razão de `whatsapp-worker` continuar 1-por-empresa é a restrição técnica do `whatsapp-web.js`/Puppeteer, não uma escolha de arquitetura. Se/quando a migração pra API oficial do WhatsApp Business acontecer (0062), essa restrição desaparece — o worker oficial (baseado em webhook, sem sessão de navegador presa a um `Client`) pode passar a multiplexar empresas como o `ai-orchestrator` já faz, simplificando a topologia ainda mais. Não é pré-requisito um do outro (esta tarefa não depende de 0062 pra ser feita), só um efeito colateral a considerar se a ordem de implementação permitir.
