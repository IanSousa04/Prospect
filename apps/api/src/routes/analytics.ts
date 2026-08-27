import type { FastifyInstance } from "fastify";
import type { AnalyticsComercial, ProdutoMaisVendido } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const DIAS_PARA_REATIVAR = 30;

/** Estados de pedido que representam uma venda de fato confirmada — usados
 * pra taxa de conversão e faturamento. "aberto" ainda é só um carrinho em
 * montagem, não uma venda (ver docs/product/06-qualidade-analytics.md §6.3). */
const STATUS_CONVERTIDO = ["confirmado", "em_preparo", "pronto", "saiu_para_entrega", "entregue"];

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/analytics/comercial", async (request, reply) => {
    const { empresaId } = request.auth!;

    const [{ data: pedidos, error: pedidosError }, { count: atendimentosTotal }, { data: clientes }] =
      await Promise.all([
        supabaseAdmin.from("pedidos").select("id, status, total, cliente_id").eq("empresa_id", empresaId),
        supabaseAdmin
          .from("atendimentos")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", empresaId),
        supabaseAdmin.from("clientes").select("id, ultima_interacao_em").eq("empresa_id", empresaId),
      ]);

    if (pedidosError) {
      request.log.error(pedidosError);
      return reply.code(500).send({ error: "erro_ao_calcular_analytics" });
    }

    const todos = pedidos ?? [];
    const entregues = todos.filter((p) => p.status === "entregue");
    const convertidos = todos.filter((p) => STATUS_CONVERTIDO.includes(p.status));

    const pedidosPorStatus: Record<string, number> = {};
    for (const p of todos) pedidosPorStatus[p.status] = (pedidosPorStatus[p.status] ?? 0) + 1;

    const valorVendido = Math.round(entregues.reduce((acc, p) => acc + Number(p.total), 0) * 100) / 100;
    const ticketMedio = entregues.length > 0 ? Math.round((valorVendido / entregues.length) * 100) / 100 : 0;
    const taxaConversao = atendimentosTotal && atendimentosTotal > 0 ? convertidos.length / atendimentosTotal : 0;

    const pedidoIdsConvertidos = convertidos.map((p) => p.id);
    let produtosMaisVendidos: ProdutoMaisVendido[] = [];
    if (pedidoIdsConvertidos.length > 0) {
      const { data: itens } = await supabaseAdmin
        .from("itens_pedido")
        .select("produto_id, nome_produto, quantidade, preco_unitario")
        .eq("empresa_id", empresaId)
        .in("pedido_id", pedidoIdsConvertidos);

      const porProduto = new Map<string, ProdutoMaisVendido>();
      for (const item of itens ?? []) {
        const chave = item.produto_id ?? item.nome_produto;
        const atual = porProduto.get(chave) ?? {
          produto_id: item.produto_id,
          nome: item.nome_produto,
          quantidade: 0,
          valor_total: 0,
        };
        atual.quantidade += item.quantidade;
        atual.valor_total += Number(item.preco_unitario) * item.quantidade;
        porProduto.set(chave, atual);
      }
      produtosMaisVendidos = Array.from(porProduto.values())
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 5)
        .map((p) => ({ ...p, valor_total: Math.round(p.valor_total * 100) / 100 }));
    }

    const clienteIdsComPedido = new Set(convertidos.map((p) => p.cliente_id));
    const limite = Date.now() - DIAS_PARA_REATIVAR * 86_400_000;
    const clientesParaReativar = (clientes ?? []).filter(
      (c) => clienteIdsComPedido.has(c.id) && new Date(c.ultima_interacao_em).getTime() < limite,
    ).length;

    const resultado: AnalyticsComercial = {
      pedidos_total: todos.length,
      pedidos_por_status: pedidosPorStatus,
      valor_vendido: valorVendido,
      ticket_medio: ticketMedio,
      taxa_conversao: Math.round(taxaConversao * 1000) / 1000,
      produtos_mais_vendidos: produtosMaisVendidos,
      clientes_para_reativar: clientesParaReativar,
    };
    return resultado;
  });
}
