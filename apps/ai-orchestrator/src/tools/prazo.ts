import {
  PRAZO_ENTREGA_MAX_PADRAO,
  PRAZO_ENTREGA_MIN_PADRAO,
  formatarPrazoEntrega,
} from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

/**
 * Resposta pra "quanto tempo demora meu pedido?" — um RANGE fixo configurável
 * por empresa (default 60–90 min), a MESMA fonte de verdade que a página
 * pública exibe (CLAUDE.md regra 1: a IA nunca calcula prazo, sempre lê o
 * range cadastrado).
 */
registerTool({
  nome: "consultar_prazo_entrega",
  descricao:
    "Consulta o prazo de entrega configurado pela empresa (range fixo, ex.: 60 a 90 minutos). Use sempre que o cliente perguntar quanto tempo demora o pedido.",
  parametrosJsonSchema: { type: "object", properties: {} },
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const { data: config, error: erroConfig } = await supabaseAdmin
      .from("ia_configuracoes")
      .select("prazo_entrega_min_minutos, prazo_entrega_max_minutos")
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    if (erroConfig) throw new Error(`erro_ao_consultar_configuracao_prazo: ${erroConfig.message}`);

    const minMinutos = config?.prazo_entrega_min_minutos ?? PRAZO_ENTREGA_MIN_PADRAO;
    const maxMinutos = config?.prazo_entrega_max_minutos ?? PRAZO_ENTREGA_MAX_PADRAO;

    return {
      min_minutos: minMinutos,
      max_minutos: maxMinutos,
      texto: formatarPrazoEntrega(minMinutos, maxMinutos),
    };
  },
});
