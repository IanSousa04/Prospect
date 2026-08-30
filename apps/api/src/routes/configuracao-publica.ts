import type { FastifyInstance } from "fastify";
import { PUBLICO_CONFIG_PADRAO, PublicoConfigSchema } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

/**
 * Configuração de aparência da página pública (aba "Página pública") + o
 * `slug`/`nome` da empresa, que o painel não tem em lugar nenhum hoje (o
 * Topbar é hardcoded). O slug é o que monta a URL `/p/<slug>` que o botão
 * "Copiar" da aba usa.
 *
 * `publico_json` vive em `ia_configuracoes` (mesma linha da configuração da
 * IA), mas o painel não precisa carregar o resto da config pra editar a
 * aparência — recurso próprio, superfície própria.
 */
export async function configuracaoPublicaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/configuracao-publica", async (request, reply) => {
    const { empresaId } = request.auth!;

    const [empresa, config] = await Promise.all([
      supabaseAdmin
        .from("empresas")
        .select("slug, nome")
        .eq("id", empresaId)
        .maybeSingle(),
      supabaseAdmin
        .from("ia_configuracoes")
        .select("publico_json")
        .eq("empresa_id", empresaId)
        .maybeSingle(),
    ]);

    if (empresa.error || config.error) {
      request.log.error(empresa.error ?? config.error);
      return reply.code(500).send({ error: "erro_ao_buscar_configuracao_publica" });
    }

    const parse = PublicoConfigSchema.safeParse(config.data?.publico_json ?? {});
    return {
      slug: empresa.data?.slug ?? null,
      nome: empresa.data?.nome ?? null,
      publico: parse.success ? parse.data : PUBLICO_CONFIG_PADRAO,
    };
  });

  app.put("/configuracao-publica", async (request, reply) => {
    const { empresaId } = request.auth!;
    const parse = PublicoConfigSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }

    const { data, error } = await supabaseAdmin
      .from("ia_configuracoes")
      .upsert({ empresa_id: empresaId, publico_json: parse.data }, { onConflict: "empresa_id" })
      .select("publico_json")
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_salvar_configuracao_publica" });
    }

    const salvo = PublicoConfigSchema.safeParse(data?.publico_json ?? {});
    return { publico: salvo.success ? salvo.data : PUBLICO_CONFIG_PADRAO };
  });
}
