import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";

/**
 * Modo teste com whitelist de números — ver docs/ROADMAP.md §3. Enquanto
 * `ia_configuracoes.modo_teste` estiver ligado para esta empresa, mensagem
 * de telefone fora de `numeros_whitelist` (ou com `ativo=false`) deve ser
 * ignorada por completo antes de chegar em `ingerirMensagemCliente` — nunca
 * gera cliente, atendimento ou mensagem.
 *
 * Consulta o banco a cada mensagem (sem cache) — volume de mensagens de
 * teste é baixo o suficiente pra isso não ser um problema de performance, e
 * evita servir uma whitelist desatualizada se alguém editar a lista pela UI
 * enquanto o worker está rodando.
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

export async function permiteIngestao(telefone: string, modoTeste: boolean): Promise<boolean> {
  if (!modoTeste) return true;

  const { data: numero, error: numeroError } = await supabaseAdmin
    .from("numeros_whitelist")
    .select("ativo")
    .eq("empresa_id", env.empresaId)
    .eq("telefone", telefone)
    .maybeSingle();

  if (numeroError) {
    throw numeroError;
  }

  return numero?.ativo === true;
}
