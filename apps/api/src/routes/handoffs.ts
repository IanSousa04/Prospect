import type { FastifyInstance } from "fastify";
import { CriarHandoffSchema } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

export async function handoffsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Criação de handoff pelo painel humano (ex.: atendente decide escalar
  // manualmente). O ai-orchestrator NÃO usa esta rota — insere direto via
  // supabaseAdmin com o mesmo schema Zod (ver plano da camada de IA, seção
  // "Handoff estruturado"), pra não fazer round-trip de rede num processo
  // que já roda como serviço confiável.
  app.post("/handoffs", async (request, reply) => {
    const { empresaId } = request.auth!;
    const parse = CriarHandoffSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }
    const body = parse.data;

    const { data: atendimento } = await supabaseAdmin
      .from("atendimentos")
      .select("id")
      .eq("id", body.atendimento_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!atendimento) return reply.code(400).send({ error: "atendimento_invalido" });

    const { data: handoff, error } = await supabaseAdmin
      .from("handoffs")
      .insert({ ...body, empresa_id: empresaId })
      .select()
      .single();

    if (error || !handoff) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_criar_handoff" });
    }

    const novoStatusAtendimento = body.origem === "cliente_solicitou" ? "cliente_solicitou_humano" : "ia_solicitou_humano";
    await supabaseAdmin
      .from("atendimentos")
      .update({ status: novoStatusAtendimento })
      .eq("id", body.atendimento_id)
      .eq("empresa_id", empresaId);

    return reply.code(201).send(handoff);
  });

  // Assumir o handoff resolve-o e assume o atendimento numa transação lógica
  // única — ver docs/product/03-atendimento-e-crm.md §3.4.
  app.post<{ Params: { id: string } }>("/handoffs/:id/assumir", async (request, reply) => {
    const { empresaId, usuarioId } = request.auth!;
    const { id } = request.params;

    const { data: handoff, error: handoffError } = await supabaseAdmin
      .from("handoffs")
      .update({ status: "assumido", assumido_por_usuario_id: usuarioId })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .eq("status", "aberto")
      .select()
      .maybeSingle();

    if (handoffError) {
      request.log.error(handoffError);
      return reply.code(500).send({ error: "erro_ao_assumir_handoff" });
    }
    if (!handoff) {
      return reply.code(404).send({ error: "handoff_nao_encontrado_ou_ja_assumido" });
    }

    await supabaseAdmin
      .from("atendimentos")
      .update({ status: "humano_atendendo", responsavel_usuario_id: usuarioId })
      .eq("id", handoff.atendimento_id)
      .eq("empresa_id", empresaId);

    return handoff;
  });

  app.post<{ Params: { id: string } }>("/handoffs/:id/resolver", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("handoffs")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_resolver_handoff" });
    }
    if (!data) {
      return reply.code(404).send({ error: "handoff_nao_encontrado" });
    }

    return data;
  });
}
