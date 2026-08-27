-- Identidade da IA — ver docs/ROADMAP.md §1 (P1 "Identidade da IA"). Hoje
-- não existe nome/persona configurável nem resposta padrão pra "quem é
-- você?"/"você é um robô?" — episódio real anterior mostrou a IA inventando
-- que era humana quando perguntada, sem regra determinística nenhuma pra
-- isso (mesmo motivo que já existe pra "cliente pediu humano" e "hora/data
-- atual" — nunca deixar essa resposta na mão livre do LLM).
--
-- `nome_assistente` é opcional (nullable): quando não configurado, a
-- resposta determinística cai num texto genérico ("assistente virtual"),
-- nunca inventa um nome. Rodar no SQL Editor do projeto Supabase, depois de
-- 0011_modo_teste_whitelist.sql.

alter table ia_configuracoes
  add column if not exists nome_assistente text;
