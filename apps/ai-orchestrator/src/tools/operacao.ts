import { registerTool, type ToolContext } from "./registry.js";
import { buscarConhecimentoPorCategoria } from "./_shared.js";

// As 4 tools de operação (§5.6 do doc) não têm tabela própria ainda — a
// fonte real hoje é conhecimento_itens cadastrado pela empresa nas
// categorias correspondentes (ver check constraint da tabela em
// supabase/migrations/0005_fase1_atendimento.sql). Cada tool aqui é uma
// categoria fixa, nunca escolhida pelo LLM — isso evita a IA "inventar" uma
// categoria pra contornar o que existe de fato cadastrado.

const semParametros = { type: "object" as const, properties: {} };

registerTool({
  nome: "consultar_horario",
  descricao: "Consulta o horário de funcionamento cadastrado pela empresa.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => buscarConhecimentoPorCategoria(ctx.empresaId, "horario"),
});

registerTool({
  nome: "consultar_taxa",
  descricao: "Consulta as regras de taxa de entrega cadastradas pela empresa.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => buscarConhecimentoPorCategoria(ctx.empresaId, "entrega"),
});

registerTool({
  nome: "consultar_regiao",
  descricao: "Consulta as regiões/bairros de entrega atendidos pela empresa.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => buscarConhecimentoPorCategoria(ctx.empresaId, "regiao"),
});

registerTool({
  nome: "consultar_politica",
  descricao: "Consulta políticas gerais da empresa (trocas, cancelamento, garantia etc).",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => buscarConhecimentoPorCategoria(ctx.empresaId, "politica"),
});
