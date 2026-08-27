# Prospect — Plataforma de Atendimento e Vendas com IA para Food Service

Especificação de produto em [docs/product/README.md](docs/product/README.md). Pendências de engenharia em [docs/ROADMAP.md](docs/ROADMAP.md).

## Estrutura atual

```
apps/
  api/                Fastify — API HTTP usada pelo painel
  web/                 React + Vite — painel administrativo
  whatsapp-worker/      whatsapp-web.js — canal de WhatsApp (um processo por empresa)
  ai-orchestrator/       Investigador/Atendente da IA (DeepSeek) — hoje também um processo por empresa
packages/
  shared/             Tipos TS + schemas Zod compartilhados
  pedidos-core/         Lógica de precificação/validação de pedido compartilhada (API + IA)
docs/
  product/            Especificação funcional do produto (fonte da verdade)
  architecture/         Notas de arquitetura e decisões (ex.: topologia do ai-orchestrator)
  ROADMAP.md            Pendências de engenharia — o que falta, o que ficou frágil, o que foi adiado
supabase/
  migrations/            Histórico de schema (10 migrations até agora)
  seed.sql                Dados fictícios pra testar Kanban/isolamento multi-tenant localmente
CLAUDE.md              Regras permanentes para agentes Claude neste repo
.claude/skills/        Skills customizadas (ex.: food-ai-guardrails)
```

## Setup local

1. `npm install` na raiz (workspaces).
2. Copiar cada `.env.example` (`apps/api`, `apps/web`, `apps/whatsapp-worker`, `apps/ai-orchestrator`) pra `.env` e preencher com as credenciais do Supabase e a `DEEPSEEK_API_KEY`.
3. Aplicar as migrations pendentes em `supabase/migrations/` no SQL Editor do Supabase, em ordem numérica.
4. `npm run dev` na raiz sobe os 4 apps juntos.

## Próximo passo

A camada de IA (`apps/ai-orchestrator`) está em modo *sombra* (`IA_ENVIO_REAL=false` em `apps/whatsapp-worker`) — ela já investiga, decide e grava resposta, mas nada é enviado de verdade ao cliente ainda. Ver [docs/ROADMAP.md](docs/ROADMAP.md) para o que falta antes de ligar isso em produção (principalmente: sistema de gabarito/eval).
