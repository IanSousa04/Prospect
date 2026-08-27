import type { FastifyInstance } from "fastify";
import {
  AtualizarModoTesteSchema,
  AtualizarNumeroWhitelistSchema,
  CriarNumeroWhitelistSchema,
} from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

// Modo teste com whitelist de números — ver docs/ROADMAP.md §3. Consumido
// pelo painel (esta rota) e pelo whatsapp-worker (leitura direta do banco,
// ver apps/whatsapp-worker/src/lib/whitelist.ts).
export async function modoTesteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/modo-teste", async (request, reply) => {
    const { empresaId } = request.auth!;

    const [config, numeros] = await Promise.all([
      supabaseAdmin.from("ia_configuracoes").select("modo_teste").eq("empresa_id", empresaId).maybeSingle(),
      supabaseAdmin
        .from("numeros_whitelist")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("criado_em", { ascending: false }),
    ]);

    if (config.error || numeros.error) {
      request.log.error(config.error ?? numeros.error);
      return reply.code(500).send({ error: "erro_ao_buscar_modo_teste" });
    }

    return { modo_teste: config.data?.modo_teste ?? false, numeros: numeros.data ?? [] };
  });

  app.put("/modo-teste", async (request, reply) => {
    const { empresaId } = request.auth!;
    const parse = AtualizarModoTesteSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }

    const { error } = await supabaseAdmin
      .from("ia_configuracoes")
      .upsert({ empresa_id: empresaId, modo_teste: parse.data.modo_teste }, { onConflict: "empresa_id" });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_salvar_modo_teste" });
    }
    return { modo_teste: parse.data.modo_teste };
  });

  app.post("/modo-teste/numeros", async (request, reply) => {
    const { empresaId } = request.auth!;
    const parse = CriarNumeroWhitelistSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }

    const { data, error } = await supabaseAdmin
      .from("numeros_whitelist")
      .upsert(
        { empresa_id: empresaId, telefone: parse.data.telefone, ativo: true },
        { onConflict: "empresa_id,telefone" },
      )
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_criar_numero" });
    }
    return data;
  });

  app.patch("/modo-teste/numeros/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params as { id: string };
    const parse = AtualizarNumeroWhitelistSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }

    const { data, error } = await supabaseAdmin
      .from("numeros_whitelist")
      .update({ ativo: parse.data.ativo })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_atualizar_numero" });
    }
    return data;
  });

  app.delete("/modo-teste/numeros/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params as { id: string };

    const { error } = await supabaseAdmin
      .from("numeros_whitelist")
      .delete()
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_remover_numero" });
    }
    return reply.code(204).send();
  });
}
