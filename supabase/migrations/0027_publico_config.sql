-- Aba "Página pública" — aparência do cardápio público (/delivery/<slug>): cor de
-- destaque, fonte e organização dos produtos. Uma coluna jsonb, mesmo padrão
-- de `fluxo_pedido_json`/`comportamento_json` (estrutura validada por schema
-- em packages/shared/src/publico-config.ts).
--
-- Default reproduz a aparência anterior à feature (cor padrão da plataforma,
-- fonte padrão, produtos em lista) — nenhuma empresa em produção muda de
-- visual sem ação explícita.

alter table ia_configuracoes
  add column if not exists publico_json jsonb not null default '{
    "cor_primaria": null,
    "fonte": "padrao",
    "layout": "lista"
  }'::jsonb;
