import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";

/**
 * Mesmo flag `ia_configuracoes.modo_teste` que o whatsapp-worker usa pra
 * whitelist (ver docs/ROADMAP.md §3) — aqui usado só pra decidir se o
 * handoff manda a descrição estruturada de volta pro WhatsApp (ver
 * handoffs.ts), pra dar pra testar só com o celular, sem abrir o painel.
 */
export async function estaEmModoTeste(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("ia_configuracoes")
    .select("modo_teste")
    .eq("empresa_id", env.empresaId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.modo_teste === true;
}
