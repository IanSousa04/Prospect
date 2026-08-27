import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";

/**
 * Comando `/exit` do modo teste — ver docs/ROADMAP.md §3. Só é interpretado
 * como comando (nunca ingerido como mensagem de cliente) quando o modo
 * teste está ligado para a empresa; fora do modo teste, "/exit" é uma
 * mensagem normal como qualquer outra.
 *
 * Apaga todos os atendimentos do telefone (mensagens/handoffs/decisões de
 * IA somem junto via `on delete cascade`), mas preserva o registro do
 * cliente — só o histórico de conversa é resetado, pra permitir recomeçar
 * um teste do zero sem precisar recriar o cliente na próxima mensagem.
 */
export async function apagarAtendimentosDeTeste(telefone: string): Promise<number> {
  const { data: cliente, error: clienteError } = await supabaseAdmin
    .from("clientes")
    .select("id")
    .eq("empresa_id", env.empresaId)
    .eq("telefone", telefone)
    .maybeSingle();

  if (clienteError) {
    throw clienteError;
  }
  if (!cliente) return 0;

  const { data: apagados, error: atendimentosError } = await supabaseAdmin
    .from("atendimentos")
    .delete()
    .eq("empresa_id", env.empresaId)
    .eq("cliente_id", cliente.id)
    .select("id");

  if (atendimentosError) {
    throw atendimentosError;
  }

  return apagados?.length ?? 0;
}
