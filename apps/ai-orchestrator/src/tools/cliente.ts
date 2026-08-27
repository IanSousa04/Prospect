import { supabaseAdmin } from "../lib/supabase.js";
import { registerTool, type ToolContext } from "./registry.js";

// Nenhuma destas tools aceita um `cliente_id` de parâmetro — sempre usa
// `ctx.clienteId` (o cliente da própria conversa). Isso é deliberado: um
// parâmetro de cliente_id vindo do LLM seria uma superfície direta de
// extração de dado de outro cliente (R3 do plano da camada de IA — mesma
// categoria de ataque testada no Eddy).

const semParametros = { type: "object" as const, properties: {} };

registerTool({
  nome: "consultar_cliente",
  descricao: "Consulta o cadastro do cliente desta conversa (nome, telefone, tags, primeira/última interação).",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const { data, error } = await supabaseAdmin
      .from("clientes")
      .select("nome, telefone, tags, primeiro_contato_em, ultima_interacao_em")
      .eq("id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();

    if (error) throw new Error(`erro_ao_consultar_cliente: ${error.message}`);
    if (!data) return { erro: "cliente_nao_encontrado" };
    return data;
  },
});

registerTool({
  nome: "consultar_historico",
  descricao: "Consulta os últimos pedidos do cliente desta conversa (status, itens, total, data) — use para personalizar recomendações ou responder 'o que eu costumo pedir'.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => {
    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select("id, status, total, criado_em, itens:itens_pedido(nome_produto, quantidade)")
      .eq("cliente_id", ctx.clienteId)
      .eq("empresa_id", ctx.empresaId)
      .neq("status", "cancelado")
      .order("criado_em", { ascending: false })
      .limit(5);

    if (error) throw new Error(`erro_ao_consultar_historico: ${error.message}`);
    return { pedidos: data ?? [] };
  },
});
