// CRUD da base de conhecimento (`conhecimento_itens`) — o texto livre que a
// IA pode citar quando o cliente pergunta algo que não é produto.
//
// A tabela existe desde a migration 0005 e as tools de operação já a leem,
// mas até aqui não havia nenhuma forma de cadastrar um item pelo painel: o
// conteúdo só entrava direto no banco. Sem isso, a IA responde "não tenho
// essa informação" para perguntas que o dono acha que já respondeu.
import type { FastifyInstance } from "fastify";
import {
  AtualizarConhecimentoItemSchema,
  ConhecimentoItemInputSchema,
  CATEGORIAS_CONHECIMENTO,
  type CategoriaConhecimento,
} from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

export async function conhecimentoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { categoria?: string } }>("/conhecimento", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { categoria } = request.query;

    let query = supabaseAdmin
      .from("conhecimento_itens")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("categoria", { ascending: true })
      .order("titulo", { ascending: true });

    // Filtro só é aplicado se for uma categoria conhecida — nunca repassa
    // texto arbitrário da query string pro banco.
    if (categoria && (CATEGORIAS_CONHECIMENTO as readonly string[]).includes(categoria)) {
      query = query.eq("categoria", categoria as CategoriaConhecimento);
    }

    const { data, error } = await query;
    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_conhecimento" });
    }
    return data;
  });

  app.post("/conhecimento", async (request, reply) => {
    const { empresaId } = request.auth!;

    const parseado = ConhecimentoItemInputSchema.safeParse(request.body);
    if (!parseado.success) {
      return reply.code(400).send({ error: "dados_invalidos", detalhes: parseado.error.issues });
    }

    const { data, error } = await supabaseAdmin
      .from("conhecimento_itens")
      .insert({ ...parseado.data, empresa_id: empresaId })
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_criar_conhecimento" });
    }
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>("/conhecimento/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const parseado = AtualizarConhecimentoItemSchema.safeParse(request.body);
    if (!parseado.success) {
      return reply.code(400).send({ error: "dados_invalidos", detalhes: parseado.error.issues });
    }
    if (Object.keys(parseado.data).length === 0) {
      return reply.code(400).send({ error: "nenhum_campo_para_atualizar" });
    }

    const { data, error } = await supabaseAdmin
      .from("conhecimento_itens")
      .update(parseado.data)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_atualizar_conhecimento" });
    }
    if (!data) return reply.code(404).send({ error: "conhecimento_nao_encontrado" });
    return data;
  });

  app.delete<{ Params: { id: string } }>("/conhecimento/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("conhecimento_itens")
      .delete()
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("id")
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_remover_conhecimento" });
    }
    if (!data) return reply.code(404).send({ error: "conhecimento_nao_encontrado" });
    return reply.code(204).send();
  });
}
