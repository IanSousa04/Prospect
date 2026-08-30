import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

// Status que ainda ocupam a fila de preparo (mesmos valores de
// StatusPedido em @prospect/shared/pedidos.ts) — "pronto" em diante já não
// soma tempo de espera pro cálculo de prazo de um pedido novo.
const STATUS_FILA_ATIVA = ["aberto", "em_preparacao"] as const;

/**
 * Resposta pra "quanto tempo demora meu pedido?" (tasks/0075) — nos dois
 * modos configuráveis em `ia_configuracoes.prazo_entrega_modo`, sempre a
 * partir de dado real, nunca um número "de memória" do modelo (CLAUDE.md
 * regra 1):
 * - `padrao`: devolve o texto fixo cadastrado pela empresa
 *   (`prazo_entrega_texto`) — a IA nunca calcula neste modo.
 * - `calculado`: soma o tempo de preparo de cada item de cada pedido ainda
 *   na fila ativa desta empresa (regra 5: sempre escopado por tenant).
 *   Produto sem `tempo_preparo_minutos` cadastrado não contribui pro
 *   cálculo — sinalizado em `produtos_sem_tempo_cadastrado` pra a resposta
 *   poder avisar que a estimativa é parcial em vez de fingir precisão que
 *   não tem.
 */
registerTool({
  nome: "consultar_prazo_entrega",
  descricao:
    "Consulta o prazo de entrega/preparo configurado pela empresa — devolve um texto fixo cadastrado ou um cálculo real com base na fila de pedidos, dependendo do modo configurado. Use sempre que o cliente perguntar quanto tempo demora o pedido.",
  parametrosJsonSchema: { type: "object", properties: {} },
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const { data: config, error: erroConfig } = await supabaseAdmin
      .from("ia_configuracoes")
      .select("prazo_entrega_modo, prazo_entrega_texto")
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    if (erroConfig) throw new Error(`erro_ao_consultar_configuracao_prazo: ${erroConfig.message}`);

    const modo = config?.prazo_entrega_modo ?? "padrao";
    if (modo === "padrao") {
      return { modo, texto: config?.prazo_entrega_texto ?? null };
    }

    const { data: pedidos, error } = await supabaseAdmin
      .from("pedidos")
      .select("id, itens_pedido(quantidade, produto_id, produtos(tempo_preparo_minutos))")
      .eq("empresa_id", ctx.empresaId)
      .in("status", STATUS_FILA_ATIVA);

    if (error) throw new Error(`erro_ao_consultar_fila_pedidos: ${error.message}`);

    let minutosFila = 0;
    let produtosSemTempoCadastrado = 0;

    for (const pedido of pedidos ?? []) {
      for (const item of (pedido as any).itens_pedido ?? []) {
        const tempo = item.produtos?.tempo_preparo_minutos;
        if (tempo == null) {
          produtosSemTempoCadastrado += 1;
          continue;
        }
        minutosFila += tempo * item.quantidade;
      }
    }

    return {
      modo,
      pedidos_na_fila: (pedidos ?? []).length,
      minutos_estimados: minutosFila,
      produtos_sem_tempo_cadastrado: produtosSemTempoCadastrado,
    };
  },
});
