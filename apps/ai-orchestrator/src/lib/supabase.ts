import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Mesmo padrão do whatsapp-worker: processo confiável, service_role direto.
// Isolamento multi-tenant depende de TODA query no orquestrador filtrar
// empresa_id explicitamente (nunca de RLS) — ver decisão em CLAUDE.md /
// plano da camada de IA, seção "Autenticação de máquina".
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
