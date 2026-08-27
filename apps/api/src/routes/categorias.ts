import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

export async function categoriasRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/categorias", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { data, error } = await supabaseAdmin
      .from("categorias")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("ordem", { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_categorias" });
    }
    return data;
  });

  app.post<{ Body: { nome: string; ordem?: number } }>("/categorias", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { nome, ordem } = request.body;

    if (!nome?.trim()) {
      return reply.code(400).send({ error: "nome_obrigatorio" });
    }

    const { data, error } = await supabaseAdmin
      .from("categorias")
      .insert({ empresa_id: empresaId, nome: nome.trim(), ordem: ordem ?? 0 })
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_criar_categoria" });
    }
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string }; Body: Partial<{ nome: string; ordem: number; status: string }> }>(
    "/categorias/:id",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id } = request.params;

      const { data, error } = await supabaseAdmin
        .from("categorias")
        .update(request.body)
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .select()
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_atualizar_categoria" });
      }
      if (!data) return reply.code(404).send({ error: "categoria_nao_encontrada" });
      return data;
    },
  );
}
