import type { FastifyInstance } from "fastify";
import { AtualizarIaConfiguracaoSchema, FLUXO_PEDIDO_CONFIG_PADRAO } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

/**
 * Tom de voz, emoji, nome/persona da IA e comportamento comercial
 * (`comportamento_json`) — ver docs/ROADMAP.md §1 "Fazer valer
 * comportamento_json". Uma linha por empresa (`ia_configuracoes.empresa_id`
 * é PK), então GET sempre devolve os valores padrão quando a empresa ainda
 * não configurou nada — nunca 404, pra tela de Configurações não precisar
 * tratar "sem configuração" como um estado de erro.
 */
export async function iaConfiguracoesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/ia-configuracoes", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { data, error } = await supabaseAdmin
      .from("ia_configuracoes")
      .select("tom_de_voz, usa_emoji, nome_assistente, comportamento_json, prazo_entrega_modo, prazo_entrega_texto, fluxo_pedido_json")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_configuracao" });
    }

    if (!data) {
      return {
        tom_de_voz: "amigavel",
        usa_emoji: true,
        nome_assistente: null,
        comportamento_json: {},
        prazo_entrega_modo: "padrao",
        prazo_entrega_texto: null,
        fluxo_pedido: FLUXO_PEDIDO_CONFIG_PADRAO,
      };
    }

    const { fluxo_pedido_json, ...resto } = data;
    return { ...resto, fluxo_pedido: fluxo_pedido_json ?? FLUXO_PEDIDO_CONFIG_PADRAO };
  });

  app.put("/ia-configuracoes", async (request, reply) => {
    const { empresaId } = request.auth!;
    const parse = AtualizarIaConfiguracaoSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: "corpo_invalido", detalhes: parse.error.flatten() });
    }
    const body = parse.data;

    const { data, error } = await supabaseAdmin
      .from("ia_configuracoes")
      .upsert(
        {
          empresa_id: empresaId,
          tom_de_voz: body.tom_de_voz,
          usa_emoji: body.usa_emoji,
          nome_assistente: body.nome_assistente?.trim() || null,
          comportamento_json: body.comportamento_json,
          prazo_entrega_modo: body.prazo_entrega_modo,
          prazo_entrega_texto: body.prazo_entrega_texto?.trim() || null,
          fluxo_pedido_json: body.fluxo_pedido,
        },
        { onConflict: "empresa_id" },
      )
      .select("tom_de_voz, usa_emoji, nome_assistente, comportamento_json, prazo_entrega_modo, prazo_entrega_texto, fluxo_pedido_json")
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_salvar_configuracao" });
    }
    const { fluxo_pedido_json, ...resto } = data;
    return { ...resto, fluxo_pedido: fluxo_pedido_json ?? FLUXO_PEDIDO_CONFIG_PADRAO };
  });
}
