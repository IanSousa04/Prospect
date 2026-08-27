# Multi-tenancy — banco compartilhado com RLS

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 10. Infraestrutura / produção

Decisão validada contra o padrão de mercado para SaaS B2B com tenants de porte pequeno/médio: banco único (pooled) com isolamento reforçado por Row-Level Security no Postgres, em vez de banco isolado por tenant (que só compensa para clientes enterprise com exigência de compliance específica). Implementado em [`0005_fase1_atendimento.sql`](../supabase/migrations/0005_fase1_atendimento.sql): toda tabela de domínio carrega `empresa_id`, RLS habilitado com policy baseada em `app_metadata.empresa_id` do JWT — preparado tanto para o backend (service_role, ignora RLS) quanto para o painel acessando o Supabase diretamente no futuro (ex.: realtime no Kanban).
