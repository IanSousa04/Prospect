import type { FastifyInstance } from "fastify";
import type { ClienteComMetricas } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const DIAS_PARA_REATIVAR = 30;

/** Junta clientes com o agregado de seus pedidos não cancelados — total de
 * pedidos, valor gasto (só pedidos 'entregue', que é receita realizada de
 * verdade), ticket médio e data do último pedido. Nada aqui é estimado: cada
 * número vem de uma soma real sobre `pedidos` (CLAUDE.md regra 1). */
async function comMetricas(clientes: any[], empresaId: string): Promise<ClienteComMetricas[]> {
  const clienteIds = clientes.map((c) => c.id);
  if (clienteIds.length === 0) return [];

  const { data: pedidos } = await supabaseAdmin
    .from("pedidos")
    .select("cliente_id, status, total, criado_em")
    .eq("empresa_id", empresaId)
    .in("cliente_id", clienteIds)
    .neq("status", "cancelado");

  const porCliente = new Map<string, { total_pedidos: number; valor_entregue: number; qtd_entregue: number; ultimo: string | null }>();
  for (const p of pedidos ?? []) {
    const atual = porCliente.get(p.cliente_id) ?? { total_pedidos: 0, valor_entregue: 0, qtd_entregue: 0, ultimo: null };
    atual.total_pedidos += 1;
    if (p.status === "entregue") {
      atual.valor_entregue += Number(p.total);
      atual.qtd_entregue += 1;
    }
    if (!atual.ultimo || p.criado_em > atual.ultimo) atual.ultimo = p.criado_em;
    porCliente.set(p.cliente_id, atual);
  }

  const agora = Date.now();
  return clientes.map((c) => {
    const m = porCliente.get(c.id);
    const ultimoPedidoEm = m?.ultimo ?? null;
    const diasDesdeUltimo = ultimoPedidoEm
      ? Math.floor((agora - new Date(ultimoPedidoEm).getTime()) / 86_400_000)
      : null;

    return {
      ...c,
      total_pedidos: m?.total_pedidos ?? 0,
      valor_total_gasto: Math.round((m?.valor_entregue ?? 0) * 100) / 100,
      ticket_medio: m && m.qtd_entregue > 0 ? Math.round((m.valor_entregue / m.qtd_entregue) * 100) / 100 : 0,
      ultimo_pedido_em: ultimoPedidoEm,
      dias_desde_ultimo_pedido: diasDesdeUltimo,
      para_reativar: diasDesdeUltimo !== null && diasDesdeUltimo > DIAS_PARA_REATIVAR,
    };
  });
}

export async function clientesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/clientes", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { data, error } = await supabaseAdmin
      .from("clientes")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("ultima_interacao_em", { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_clientes" });
    }

    return comMetricas(data ?? [], empresaId);
  });

  app.get<{ Params: { id: string } }>("/clientes/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("clientes")
      .select("*")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_cliente" });
    }
    if (!data) {
      return reply.code(404).send({ error: "cliente_nao_encontrado" });
    }

    const [comMetricasResult] = await comMetricas([data], empresaId);
    return comMetricasResult;
  });
}
