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

/**
 * O que a loja OFERECE — tipos de entrega e formas de pagamento — lido de
 * `ia_configuracoes.fluxo_pedido_json` (tarefa 0082).
 *
 * Existe como ferramenta, e não como um fato montado direto do `ToolContext`,
 * por um motivo só: assim a configuração vira evidência real, com linha em
 * `ia_execucoes`, do mesmo jeito que qualquer outro fato que o Atendente pode
 * afirmar. Sem isso ela seria uma afirmação sem fonte — exatamente o que o
 * resto do sistema existe pra proibir.
 *
 * É a fonte da verdade sobre DISPONIBILIDADE (decisão do usuário, tarefa
 * 0082): a base de conhecimento em texto livre pode detalhar raio, taxa e
 * regras, mas nunca contradizer isto sobre o que a loja aceita. Episódio
 * real: a IA respondeu "não estamos fazendo entregas" para uma loja cuja
 * configuração oferece entrega.
 */
registerTool({
  nome: "consultar_opcoes_atendimento",
  descricao:
    "Consulta o que esta loja oferece: tipos de entrega disponíveis (entrega/retirada) e formas de pagamento aceitas. Fonte da verdade sobre disponibilidade — use sempre que o cliente perguntar ou informar entrega/retirada ou forma de pagamento.",
  parametrosJsonSchema: semParametros,
  risco: "baixo",
  executor: async (_input: unknown, ctx: ToolContext) => ({
    tipos_entrega_oferecidos: ctx.fluxoPedido.tipos_entrega_oferecidos,
    formas_pagamento_aceitas: ctx.fluxoPedido.perguntar_forma_pagamento
      ? ctx.fluxoPedido.formas_pagamento_aceitas
      : [],
    pergunta_forma_pagamento: ctx.fluxoPedido.perguntar_forma_pagamento,
    pagamento_na_entrega: true,
  }),
});
