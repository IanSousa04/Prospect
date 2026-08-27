import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

interface PedidoIdInput {
  pedido_id?: string;
}

/**
 * Resolve qual pedido consultar: se `pedidoId` for informado, só é aceito
 * se pertencer ao MESMO cliente e empresa desta conversa (nunca confia num
 * ID solto vindo do LLM/cliente — impede um cliente consultar o pedido de
 * outro só adivinhando/inventando um UUID). Sem `pedidoId`, cai pro pedido
 * mais recente não cancelado deste atendimento.
 */
async function resolverPedidoId(ctx: ToolContext, pedidoId: string | undefined): Promise<string | null> {
  if (pedidoId) {
    const { data } = await supabaseAdmin
      .from("pedidos")
      .select("id")
      .eq("id", pedidoId)
      .eq("cliente_id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    return data?.id ?? null;
  }

  const { data } = await supabaseAdmin
    .from("pedidos")
    .select("id")
    .eq("atendimento_id", ctx.atendimentoId)
    .eq("empresa_id", ctx.empresaId)
    .neq("status", "cancelado")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

registerTool({
  nome: "consultar_pedido",
  descricao:
    "Consulta os detalhes completos (itens, personalizações, total, status, pagamento) do pedido atual desta conversa, ou de um pedido específico do próprio cliente.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      pedido_id: { type: "string", description: "Opcional — se omitido, usa o pedido mais recente desta conversa." },
    },
  },
  risco: "baixo",
  executor: async (input: PedidoIdInput, ctx: ToolContext) => {
    const pedidoId = await resolverPedidoId(ctx, input.pedido_id);
    if (!pedidoId) return { erro: "pedido_nao_encontrado" };

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select(
        "status, tipo_entrega, taxa_entrega, forma_pagamento, status_pagamento, subtotal, total, criado_em, itens:itens_pedido(nome_produto, quantidade, preco_unitario, opcoes:itens_pedido_opcoes(nome_opcao, preco_adicional))",
      )
      .eq("id", pedidoId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();

    if (error) throw new Error(`erro_ao_consultar_pedido: ${error.message}`);
    if (!data) return { erro: "pedido_nao_encontrado" };
    return data;
  },
});

registerTool({
  nome: "consultar_status",
  descricao: "Consulta só o status atual do pedido desta conversa (mais leve que consultar_pedido) — use para 'cadê meu pedido'.",
  parametrosJsonSchema: {
    type: "object",
    properties: {
      pedido_id: { type: "string", description: "Opcional — se omitido, usa o pedido mais recente desta conversa." },
    },
  },
  risco: "baixo",
  executor: async (input: PedidoIdInput, ctx: ToolContext) => {
    const pedidoId = await resolverPedidoId(ctx, input.pedido_id);
    if (!pedidoId) return { erro: "pedido_nao_encontrado" };

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select("status, total, criado_em")
      .eq("id", pedidoId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();

    if (error) throw new Error(`erro_ao_consultar_status: ${error.message}`);
    if (!data) return { erro: "pedido_nao_encontrado" };
    return data;
  },
});
