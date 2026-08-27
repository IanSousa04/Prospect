import type { FastifyInstance } from "fastify";
import { CriarOuAtualizarPermissaoSchema, NOMES_FERRAMENTAS, type IaPermissao } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

export async function iaPermissoesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Sempre retorna as ~19 ferramentas do domínio, mesmo as que nunca foram
  // configuradas — a UI precisa mostrar "não permitido" explicitamente para
  // toda ferramenta sem linha, nunca omitir (ausência = negado, regra 2).
  app.get("/ia-permissoes", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { data, error } = await supabaseAdmin.from("ia_permissoes").select("*").eq("empresa_id", empresaId);
    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_permissoes" });
    }

    const porFerramenta = new Map((data ?? []).map((linha) => [linha.ferramenta, linha as IaPermissao]));

    return NOMES_FERRAMENTAS.map((ferramenta) => {
      const existente = porFerramenta.get(ferramenta);
      return (
        existente ?? {
          id: null,
          empresa_id: empresaId,
          ferramenta,
          permitido: false,
          exige_confirmacao_humana: null,
          valor_maximo_sem_handoff: null,
          condicoes_json: null,
          campos_permitidos: null,
          criado_em: null,
          atualizado_em: null,
        }
      );
    });
  });

  app.put("/ia-permissoes", async (request, reply) => {
    const { empresaId } = request.auth!;
    const parse = CriarOuAtualizarPermissaoSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }
    const body = parse.data;

    const { data, error } = await supabaseAdmin
      .from("ia_permissoes")
      .upsert({ ...body, empresa_id: empresaId }, { onConflict: "empresa_id,ferramenta" })
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_salvar_permissao" });
    }
    return data;
  });
}
