import type { Client } from "whatsapp-web.js";
import { supabaseAdmin } from "./lib/supabase.js";
import { env } from "./lib/env.js";

const INTERVALO_MS = 3000;

/**
 * Envia ao WhatsApp as mensagens de humano OU de IA ainda não entregues.
 * Marca `metadata_json.enviado_em` só depois de confirmação real da API do
 * WhatsApp — nunca antes (CLAUDE.md, regra 7: nunca simular sucesso de
 * envio). Compartilhar este poller entre humano e IA garante que os dois
 * respeitem o mesmo rate limit natural (intervalo de 3s, lote de 20) — a IA
 * nunca abre um caminho de envio paralelo sem controle.
 *
 * Trava de segurança do MVP 1 (ver plano da camada de IA): enquanto
 * `env.iaEnvioReal` for false, mensagens de IA são "enviadas em modo
 * sombra" — nunca chamam client.sendMessage de verdade, só marcam
 * metadata_json.simulado_em, pra validar qualidade de resposta em produção
 * sem risco de cliente real receber algo errado. Mensagens de humano
 * SEMPRE são enviadas de verdade, independente dessa flag.
 */
export function iniciarPoller(client: Client): void {
  setInterval(async () => {
    const { data: pendentes, error } = await supabaseAdmin
      .from("mensagens")
      .select("id, atendimento_id, remetente, conteudo, metadata_json, atendimentos(cliente_id, clientes(whatsapp_id, telefone))")
      .eq("empresa_id", env.empresaId)
      .in("remetente", ["humano", "ia"])
      .is("metadata_json->>enviado_em", null)
      .is("metadata_json->>simulado_em", null)
      .order("criado_em", { ascending: true })
      .limit(20);

    if (error) {
      console.error("[poller] erro ao buscar mensagens pendentes:", error.message);
      return;
    }

    for (const msg of pendentes ?? []) {
      const atendimento = (msg as any).atendimentos;
      const destino: string | undefined =
        atendimento?.clientes?.whatsapp_id ?? atendimento?.clientes?.telefone;

      if (!destino) {
        console.warn(`[poller] mensagem ${msg.id} sem destino de WhatsApp resolvido, pulando`);
        continue;
      }

      if (msg.remetente === "ia" && !env.iaEnvioReal) {
        console.log(`[poller] (modo sombra) resposta de IA NÃO enviada de verdade — atendimento ${msg.atendimento_id}: "${msg.conteudo}"`);
        await supabaseAdmin
          .from("mensagens")
          .update({
            metadata_json: { ...(msg.metadata_json as object), simulado_em: new Date().toISOString() },
          })
          .eq("id", msg.id);
        continue;
      }

      try {
        await client.sendMessage(destino.includes("@") ? destino : `${destino}@c.us`, msg.conteudo);

        await supabaseAdmin
          .from("mensagens")
          .update({
            metadata_json: { ...(msg.metadata_json as object), enviado_em: new Date().toISOString() },
          })
          .eq("id", msg.id);
      } catch (sendError) {
        console.error(`[poller] falha ao enviar mensagem ${msg.id}:`, sendError);
        // não marca como enviada — próxima rodada tenta de novo.
      }
    }
  }, INTERVALO_MS);
}
