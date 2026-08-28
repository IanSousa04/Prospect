import type { FastifyInstance } from "fastify";
import type { WhatsappConexao } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const STATUS_PADRAO: Omit<WhatsappConexao, "empresa_id" | "atualizado_em"> = {
  status: "desconectado",
  qr_code: null,
  numero_conectado: null,
};

// Status de conexão do WhatsApp (aba WhatsApp no painel) — ver
// supabase/migrations/0017_whatsapp_conexoes.sql. O whatsapp-worker publica
// o status real na mesma tabela; esta rota só lê e escreve "comando"
// (nunca escreve status/qr_code diretamente — isso é fato observado pelo
// worker, não algo que o painel possa afirmar por conta própria).
export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/whatsapp/status", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { data, error } = await supabaseAdmin
      .from("whatsapp_conexoes")
      .select("status, qr_code, numero_conectado, atualizado_em")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_status_whatsapp" });
    }

    return data ?? { ...STATUS_PADRAO, atualizado_em: null };
  });

  app.post("/whatsapp/desconectar", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { error } = await supabaseAdmin
      .from("whatsapp_conexoes")
      .upsert({ empresa_id: empresaId, comando: "desconectar" }, { onConflict: "empresa_id" });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_desconectar_whatsapp" });
    }
    return { ok: true };
  });

  app.post("/whatsapp/reconectar", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { error } = await supabaseAdmin
      .from("whatsapp_conexoes")
      .upsert({ empresa_id: empresaId, comando: "reconectar" }, { onConflict: "empresa_id" });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_reconectar_whatsapp" });
    }
    return { ok: true };
  });
}
