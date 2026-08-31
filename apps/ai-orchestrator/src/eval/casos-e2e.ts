// Casos de ponta a ponta do gabarito — chamam a pipeline real (Investigador
// → confiança → decisão → Atendente → verificação), com API de verdade do
// DeepSeek. Custam tokens e podem ter alguma variação natural de LLM (menos
// determinísticos que os casos em deterministicos.ts, que testam só código);
// ainda assim são o que garante que o PROMPT continua produzindo o
// comportamento esperado, não só o código de rede de segurança.
import { supabaseAdmin } from "../lib/supabase.js";
import { env } from "../lib/env.js";
import { processarMensagem } from "../agent/orquestrador.js";
import type { ResultadoOrquestracao } from "../agent/orquestrador.js";
import type { ChatMessage } from "../llm/types.js";
import type { ToolContext } from "../tools/index.js";
import {
  mapaDePermissoes,
  ComportamentoJsonSchema,
  FluxoPedidoConfigSchema,
  FLUXO_PEDIDO_CONFIG_PADRAO,
  type IaPermissao,
} from "@prospect/shared";

export interface CasoE2E {
  nome: string;
  pergunta: string;
  /** Histórico sintético opcional — default []. Usado pra reproduzir bugs
   * de continuidade de conversa sem precisar rodar múltiplos turnos reais. */
  historico?: ChatMessage[];
  validar: (resultado: ResultadoOrquestracao) => string | null; // null = passou
}

const CASOS_FIXOS: CasoE2E[] = [
  {
    nome: "saudação social responde direto, sem handoff",
    pergunta: "Oi, boa tarde!",
    validar: (r) => (r.acao === "responder" && r.confianca !== "baixa" ? null : `acao=${r.acao} confianca=${r.confianca}`),
  },
  {
    nome: "pedido de PDF nunca promete o formato, e nunca fica em silêncio total",
    pergunta: "Pode me mandar o cardápio em PDF?",
    validar: (r) => {
      if (r.respostaTexto && /\bpdf\b|arquivo do card[áa]pio|imagem do card[áa]pio/i.test(r.respostaTexto)) {
        return `resposta prometeu PDF: "${r.respostaTexto}"`;
      }
      return null;
    },
  },
  {
    nome: '"o que eu já pedi?" sem nenhum pedido em aberto responde direto (não escala, não pede código)',
    pergunta: "O que eu já pedi?",
    validar: (r) => {
      if (r.acao === "handoff") return "escalou pra humano em vez de responder que não há pedidos";
      if (r.respostaTexto && /(?:n[úu]mero|c[óo]digo)\s+(?:d[oe]\s+)?(?:seu\s+)?pedido/i.test(r.respostaTexto)) {
        return `pediu código do pedido: "${r.respostaTexto}"`;
      }
      return null;
    },
  },
  {
    nome: "cliente pede atendente humano → handoff com mensagem de transferência",
    pergunta: "quero falar com um atendente",
    validar: (r) =>
      r.acao === "handoff" && r.respostaTexto && /transferir/i.test(r.respostaTexto)
        ? null
        : `acao=${r.acao} respostaTexto="${r.respostaTexto}"`,
  },
  {
    // Episódio real: cliente perguntou o nome duas vezes, com uma troca no
    // meio confirmando "Ian" — na segunda vez a IA respondeu "Meu nome é
    // Ian" (perdeu o fio da conversa e inverteu de quem era o nome).
    nome: "pergunta sobre o nome do cliente nunca inverte a perspectiva (episódio real: 'meu nome é Ian')",
    historico: [
      { role: "user", content: "Qual é o meu nome?" },
      { role: "assistant", content: "Oi! Como posso te chamar?" },
      { role: "user", content: "Ian" },
      { role: "assistant", content: "Oi, Ian! Como posso te ajudar hoje?" },
    ],
    pergunta: "Qual o meu nome mesmo?",
    validar: (r) => {
      if (r.respostaTexto && /\bmeu nome (é|e)\b/i.test(r.respostaTexto)) {
        return `resposta inverteu a perspectiva (atribuiu o nome do cliente a si mesma): "${r.respostaTexto}"`;
      }
      return null;
    },
  },
];

/** Caso "preço real" depende do catálogo cadastrado nesta empresa (dado real
 * de usuário, não fixture) — busca um produto ativo qualquer em vez de
 * assumir um nome fixo, pra não quebrar se o catálogo mudar. Retorna null
 * (pula o caso) se não houver nenhum produto cadastrado. */
async function montarCasoPrecoReal(empresaId: string): Promise<CasoE2E | null> {
  const { data } = await supabaseAdmin
    .from("produtos")
    .select("nome, preco")
    .eq("empresa_id", empresaId)
    .eq("status", "ativo")
    .eq("tipo", "produto")
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const precoFormatado = Number(data.preco).toFixed(2).replace(".", ",");
  return {
    nome: `pergunta de preço real (${data.nome}) responde com o valor correto`,
    pergunta: `Quanto custa o ${data.nome}?`,
    validar: (r) => {
      if (r.acao !== "responder") return `acao=${r.acao} (esperado responder)`;
      if (!r.respostaTexto?.includes(precoFormatado)) {
        return `resposta não contém o preço real R$ ${precoFormatado}: "${r.respostaTexto}"`;
      }
      return null;
    },
  };
}

export async function montarCasosE2E(empresaId: string): Promise<CasoE2E[]> {
  const casoPreco = await montarCasoPrecoReal(empresaId);
  return casoPreco ? [...CASOS_FIXOS, casoPreco] : CASOS_FIXOS;
}

export interface AtendimentoDeTeste {
  clienteId: string;
  atendimentoId: string;
}

/** Cliente/atendimento descartáveis, criados e apagados a cada caso — nunca
 * reaproveita dado real de cliente, pra garantir que "sem pedido em aberto"
 * etc sejam sempre verdadeiros. Telefone claramente falso: mesmo que
 * `criarHandoff` dispare a notificação de modo teste (ver handoffs.ts), o
 * whatsapp-worker nunca entrega de verdade pra um número inválido — e o
 * atendimento é apagado logo em seguida de qualquer forma. */
export async function criarAtendimentoDeTeste(empresaId: string): Promise<AtendimentoDeTeste> {
  const telefoneFake = `0${Date.now()}`.slice(0, 13);
  const { data: cliente, error: clienteError } = await supabaseAdmin
    .from("clientes")
    .insert({ empresa_id: empresaId, telefone: telefoneFake, nome: "Gabarito Eval" })
    .select("id")
    .single();
  if (clienteError || !cliente) throw clienteError ?? new Error("falha ao criar cliente de teste");

  const { data: atendimento, error: atendimentoError } = await supabaseAdmin
    .from("atendimentos")
    .insert({ empresa_id: empresaId, cliente_id: cliente.id, status: "ia_atendendo" })
    .select("id")
    .single();
  if (atendimentoError || !atendimento) throw atendimentoError ?? new Error("falha ao criar atendimento de teste");

  return { clienteId: cliente.id, atendimentoId: atendimento.id };
}

/** Apaga o cliente de teste — cascata cuida de atendimento/mensagens/
 * handoffs/decisões/execuções (mesmo mecanismo de apagarAtendimentosDeTeste
 * no whatsapp-worker, ver docs/ROADMAP.md §3). */
export async function limparAtendimentoDeTeste(clienteId: string): Promise<void> {
  await supabaseAdmin.from("clientes").delete().eq("id", clienteId);
}

export interface ConfigDeProcessamentoDeTeste {
  ctx: ToolContext;
  tomDeVoz: "formal" | "neutro" | "amigavel" | "descontraido";
  usaEmoji: boolean;
  nomeAssistente: string | null;
  comportamento: ReturnType<typeof ComportamentoJsonSchema.parse>;
  linkPublico: string | null;
}

/** Monta a config real da empresa (permissões, tom de voz, comportamento)
 * pra rodar `processarMensagem` como se fosse o atendimento de teste dado —
 * extraído de `rodarCasoE2E` pra ser reaproveitado por qualquer runner que
 * precise de mais de um turno na mesma sessão (ver eval/personas/). */
export async function montarConfigDeProcessamentoDeTeste(
  empresaId: string,
  teste: AtendimentoDeTeste,
): Promise<ConfigDeProcessamentoDeTeste> {
  const { data: permissoesRows } = await supabaseAdmin
    .from("ia_permissoes")
    .select("*")
    .eq("empresa_id", empresaId);
  const { data: config } = await supabaseAdmin
    .from("ia_configuracoes")
    .select("tom_de_voz, usa_emoji, nome_assistente, comportamento_json, fluxo_pedido_json")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const comportamentoParseado = ComportamentoJsonSchema.safeParse(config?.comportamento_json ?? {});
  const comportamento = comportamentoParseado.success ? comportamentoParseado.data : {};
  const fluxoPedidoParseado = FluxoPedidoConfigSchema.safeParse(config?.fluxo_pedido_json ?? {});
  const fluxoPedido = fluxoPedidoParseado.success ? fluxoPedidoParseado.data : FLUXO_PEDIDO_CONFIG_PADRAO;

  return {
    ctx: {
      empresaId,
      atendimentoId: teste.atendimentoId,
      clienteId: teste.clienteId,
      permissoes: mapaDePermissoes((permissoesRows ?? []) as IaPermissao[]),
      mensagemId: null,
      comportamento,
      fluxoPedido,
    },
    tomDeVoz: (config?.tom_de_voz as "formal" | "neutro" | "amigavel" | "descontraido") ?? "amigavel",
    usaEmoji: config?.usa_emoji ?? true,
    nomeAssistente: config?.nome_assistente ?? null,
    comportamento,
    linkPublico: null,
  };
}

export async function rodarCasoE2E(caso: CasoE2E): Promise<{ ok: boolean; motivo?: string }> {
  const empresaId = env.empresaId;
  const teste = await criarAtendimentoDeTeste(empresaId);

  try {
    const config = await montarConfigDeProcessamentoDeTeste(empresaId, teste);

    const resultado = await processarMensagem({
      pergunta: caso.pergunta,
      historico: caso.historico ?? [],
      ...config,
    });

    const motivo = caso.validar(resultado);
    return motivo ? { ok: false, motivo } : { ok: true };
  } finally {
    await limparAtendimentoDeTeste(teste.clienteId);
  }
}
