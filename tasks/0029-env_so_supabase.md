# Princípio explícito do usuário: `.env` deve conter só dados de conexão com o Supabase — todo o resto vira configuração no banco, por empresa, com gestão via UI

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Hoje o `.env` de cada app carrega bem mais que isso:

- `apps/whatsapp-worker/.env`: `EMPRESA_ID`, `IA_ENVIO_REAL`.
- `apps/ai-orchestrator/.env`: `EMPRESA_ID`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `POLLING_INTERVALO_MS`.
- `apps/api/.env`: `PORT`, `WEB_ORIGIN`.
- `apps/web/.env`: `VITE_API_URL`.

O que precisa migrar pro banco (config de negócio, por empresa, editável pela UI): `IA_ENVIO_REAL`, a whitelist/modo teste (ver tarefa `Modo teste com whitelist de números`), e qualquer outro flag operacional que hoje é `.env`. `EMPRESA_ID` some por conta própria quando a topologia do `ai-orchestrator` virar compartilhada (ver tarefa `Topologia de processos do ai-orchestrator`) — deixa de fazer sentido como variável assim que o processo passa a iterar sobre todas as empresas.

**`DEEPSEEK_API_KEY` merece cuidado à parte por ser um segredo de verdade** (custo real em API paga), não só uma config operacional: se for pro banco, não pode ser uma coluna `jsonb`/texto solta lida por qualquer rota — precisa RLS travado só pra `service_role` (nunca exposto por nenhum endpoint da API pro frontend) e, idealmente, usar o [Supabase Vault](https://supabase.com/docs/guides/database/vault) (armazenamento nativo criptografado do Supabase) em vez de uma tabela comum, já que é o mecanismo correto do próprio ecossistema pra isso.

**Ponto em aberto, não resolvido aqui:** `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` continuam em `.env` por necessidade (é a própria credencial que dá acesso ao banco onde o resto da config mora — não dá pra buscar config do banco sem já ter a conexão). `PORT`/`WEB_ORIGIN`/`VITE_API_URL` são mais topologia de deploy (em que porta escutar, qual origem aceitar) do que configuração de negócio — vale decidir na hora da implementação se eles também migram ou ficam, já que não foram o alvo principal do pedido.
