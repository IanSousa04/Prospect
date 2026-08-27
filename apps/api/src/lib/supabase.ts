import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// service_role: ignora RLS. Por isso toda query neste app precisa filtrar
// empresa_id explicitamente (ver CLAUDE.md, regra 5) — nunca depender só de
// RLS aqui, já que este cliente a contorna.
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

// cliente com anon key, usado só para validar o JWT que o painel envia
// (auth.getUser não precisa de service role e não deve usá-la).
export const supabaseAuth = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: false },
});
