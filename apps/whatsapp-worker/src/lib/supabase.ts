import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Um processo por empresa — não há JWT de usuário aqui, então service_role é
// necessário. Toda query mesmo assim filtra empresa_id (env.empresaId, nunca
// inferido da mensagem recebida) — ver CLAUDE.md, regra 5.
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
