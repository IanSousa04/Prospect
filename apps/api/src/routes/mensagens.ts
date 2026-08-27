import type { FastifyInstance } from "fastify";
import type { MensagemComMidia, MidiaMensagem } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

// Nunca público — o painel nunca fala com o Storage direto, só recebe uma
// signed URL de curta duração gerada aqui, já filtrada por empresa_id (ver
// CLAUDE.md regra 5). Mesmo bucket usado pelo whatsapp-worker na ingestão
// (apps/whatsapp-worker/src/lib/media.ts).
const BUCKET_MIDIAS = "midias-atendimento";
const VALIDADE_SIGNED_URL_SEGUNDOS = 60 * 60;

async function comMidiaUrl(mensagens: MensagemComMidia[]): Promise<MensagemComMidia[]> {
  return Promise.all(
    mensagens.map(async (m) => {
      const midia = (m.metadata_json as { midia?: MidiaMensagem } | null)?.midia;
      if (!midia?.storage_path) return m;

      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_MIDIAS)
        .createSignedUrl(midia.storage_path, VALIDADE_SIGNED_URL_SEGUNDOS);

      return { ...m, midia_url: error ? null : data.signedUrl };
    }),
  );
}

export async function mensagensRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { atendimentoId: string } }>(
    "/atendimentos/:atendimentoId/mensagens",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { atendimentoId } = request.params;

      const { data, error } = await supabaseAdmin
        .from("mensagens")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("atendimento_id", atendimentoId)
        .order("criado_em", { ascending: true });

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_buscar_mensagens" });
      }

      return comMidiaUrl((data ?? []) as MensagemComMidia[]);
    },
  );

  // Envio manual pelo humano — nunca confunde com envio automático da IA
  // (remetente é sempre 'humano' aqui; a IA grava suas próprias mensagens
  // pelo worker/orquestrador, não por esta rota).
  app.post<{ Params: { atendimentoId: string }; Body: { conteudo: string } }>(
    "/atendimentos/:atendimentoId/mensagens",
    async (request, reply) => {
      const { empresaId, usuarioId } = request.auth!;
      const { atendimentoId } = request.params;
      const { conteudo } = request.body;

      if (!conteudo?.trim()) {
        return reply.code(400).send({ error: "conteudo_vazio" });
      }

      const { data: atendimento, error: atendimentoError } = await supabaseAdmin
        .from("atendimentos")
        .select("id")
        .eq("id", atendimentoId)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      if (atendimentoError) {
        request.log.error(atendimentoError);
        return reply.code(500).send({ error: "erro_ao_validar_atendimento" });
      }
      if (!atendimento) {
        return reply.code(404).send({ error: "atendimento_nao_encontrado" });
      }

      const { data, error } = await supabaseAdmin
        .from("mensagens")
        .insert({
          empresa_id: empresaId,
          atendimento_id: atendimentoId,
          remetente: "humano",
          conteudo,
          metadata_json: { usuario_id: usuarioId },
        })
        .select()
        .single();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_enviar_mensagem" });
      }

      await supabaseAdmin
        .from("atendimentos")
        .update({ ultima_mensagem_em: new Date().toISOString() })
        .eq("id", atendimentoId);

      // O envio real pelo WhatsApp é responsabilidade do whatsapp-worker, que
      // observa esta tabela — ver docs/product/ e apps/whatsapp-worker.
      // Nenhuma resposta de sucesso aqui implica que a mensagem já chegou ao
      // cliente (CLAUDE.md, regra 7).
      return data;
    },
  );
}
