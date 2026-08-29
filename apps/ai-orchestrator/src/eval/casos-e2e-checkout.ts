// Casos de ponta a ponta ROTEIRIZADOS do checkout (tarefa 0081) — reproduzem
// os dois episódios reais (Luiza e Barbara) contra a pipeline completa, com
// LLM e Supabase de verdade, e depois conferem o BANCO: existe pedido? um só?
// com entrega, endereço e pagamento? alguma invariante disparou?
//
// Diferente de `eval/personas/`, o cliente aqui não é simulado por um LLM —
// as mensagens são fixas. Isso troca variedade por reprodutibilidade, que é
// o que faz sentido pra um cenário de regressão de bug conhecido: se este
// caso falhar, o bug voltou, não foi "o simulador variou".
import { supabaseAdmin } from "../lib/supabase.js";
import { env } from "../lib/env.js";
import { processarMensagem } from "../agent/orquestrador.js";
import type { AcaoDecidida } from "../agent/types.js";
import type { ChatMessage } from "../llm/types.js";
import {
  criarAtendimentoDeTeste,
  limparAtendimentoDeTeste,
  montarConfigDeProcessamentoDeTeste,
} from "./casos-e2e.js";

export interface TurnoRoteirizado {
  cliente: string;
  ia: string | null;
  acao: AcaoDecidida;
}

export interface ContextoValidacaoE2E {
  turnos: TurnoRoteirizado[];
  pedidos: Array<{ tipo_entrega: string | null; endereco_json: unknown; forma_pagamento: string | null }>;
  execucoes: Array<{ tool_nome: string | null; sucesso: boolean | null }>;
  invariantes: Array<{ evento: string }>;
}

export interface CasoE2EMultiTurno {
  nome: string;
  mensagens: string[];
  validar: (contexto: ContextoValidacaoE2E) => string | null;
}

export async function rodarCasoE2EMultiTurno(caso: CasoE2EMultiTurno): Promise<{ ok: boolean; motivo?: string }> {
  const empresaId = env.empresaId;
  const teste = await criarAtendimentoDeTeste(empresaId);

  try {
    const config = await montarConfigDeProcessamentoDeTeste(empresaId, teste);
    const historico: ChatMessage[] = [];
    const turnos: TurnoRoteirizado[] = [];

    for (const mensagem of caso.mensagens) {
      const resultado = await processarMensagem({ pergunta: mensagem, historico: [...historico], ...config });
      turnos.push({ cliente: mensagem, ia: resultado.respostaTexto, acao: resultado.acao });

      historico.push({ role: "user", content: mensagem });
      if (resultado.respostaTexto) historico.push({ role: "assistant", content: resultado.respostaTexto });
      // Depois de um handoff a IA não responde mais automaticamente — não
      // faz sentido continuar mandando mensagens roteirizadas.
      if (resultado.acao === "handoff") break;
    }

    const [{ data: pedidos }, { data: execucoes }, { data: invariantes }] = await Promise.all([
      supabaseAdmin
        .from("pedidos")
        .select("tipo_entrega, endereco_json, forma_pagamento")
        .eq("atendimento_id", teste.atendimentoId)
        .eq("empresa_id", empresaId),
      supabaseAdmin
        .from("ia_execucoes")
        .select("tool_nome, sucesso")
        .eq("atendimento_id", teste.atendimentoId)
        .eq("empresa_id", empresaId),
      supabaseAdmin
        .from("ia_invariantes")
        .select("evento")
        .eq("atendimento_id", teste.atendimentoId)
        .eq("empresa_id", empresaId),
    ]);

    const motivo = caso.validar({
      turnos,
      pedidos: pedidos ?? [],
      execucoes: execucoes ?? [],
      invariantes: invariantes ?? [],
    });
    return motivo ? { ok: false, motivo } : { ok: true };
  } finally {
    await limparAtendimentoDeTeste(teste.clienteId);
  }
}

function transcricao(turnos: TurnoRoteirizado[]): string {
  return turnos.map((t) => `  cliente: ${t.cliente}\n  ia (${t.acao}): ${t.ia ?? "(sem resposta)"}`).join("\n");
}

function checarPedidoUnicoCompleto(
  contexto: ContextoValidacaoE2E,
  esperado: { tipo_entrega: string; exigeEndereco: boolean },
): string | null {
  if (contexto.pedidos.length === 0) {
    return `nenhum pedido real foi criado no banco.\n${transcricao(contexto.turnos)}`;
  }
  if (contexto.pedidos.length > 1) {
    return `foram criados ${contexto.pedidos.length} pedidos — a confirmação não é idempotente.`;
  }
  const pedido = contexto.pedidos[0]!;
  if (pedido.tipo_entrega !== esperado.tipo_entrega) {
    return `pedido criado com tipo_entrega "${pedido.tipo_entrega}", esperado "${esperado.tipo_entrega}"`;
  }
  if (esperado.exigeEndereco && !pedido.endereco_json) {
    return "pedido de entrega criado sem endereço — confirmou sem ter o dado obrigatório";
  }
  if (!pedido.forma_pagamento) {
    return "pedido criado sem forma de pagamento";
  }
  return null;
}

/** Ferramentas sem as quais o checkout é estruturalmente impossível. Sem
 * permissão em `ia_permissoes` (CLAUDE.md regra 2: ausência = negado), a IA
 * não consegue fechar pedido nenhum — e os cenários abaixo falhariam por
 * configuração do tenant, não por regressão de código. Este check existe pra
 * a mensagem dizer exatamente isso, em vez de mandar procurar um bug que não
 * existe: foi assim que a primeira rodada do gabarito revelou que
 * `definir_endereco_entrega` e `definir_forma_pagamento` nunca tinham sido
 * liberadas nesta empresa. */
const FERRAMENTAS_ESSENCIAIS_DO_CHECKOUT = [
  "adicionar_ao_carrinho",
  "consultar_carrinho",
  "definir_tipo_entrega",
  "definir_endereco_entrega",
  "definir_forma_pagamento",
  "criar_pedido",
] as const;

export async function permissoesFaltantesDoCheckout(empresaId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("ia_permissoes")
    .select("ferramenta, permitido")
    .eq("empresa_id", empresaId);

  const permitidas = new Set((data ?? []).filter((r) => r.permitido === true).map((r) => r.ferramenta));
  return FERRAMENTAS_ESSENCIAIS_DO_CHECKOUT.filter((f) => !permitidas.has(f));
}

/** Os cenários dependem de um produto real do catálogo desta empresa (dado
 * de usuário, não fixture) — busca dois ativos em vez de assumir nomes
 * fixos, mesmo cuidado de `montarCasoPrecoReal` em casos-e2e.ts. */
export async function montarCasosE2ECheckout(empresaId: string): Promise<CasoE2EMultiTurno[]> {
  const faltando = await permissoesFaltantesDoCheckout(empresaId);
  if (faltando.length > 0) {
    return [
      {
        nome: "E2E checkout — pré-requisito de permissões",
        mensagens: [],
        validar: () =>
          `esta empresa não tem permissão em ia_permissoes para: ${faltando.join(", ")}. ` +
          `Sem isso a IA não consegue fechar pedido nenhum (CLAUDE.md regra 2: ausência de permissão = negado) ` +
          `e os cenários de checkout não podem ser avaliados. Libere essas ferramentas nas permissões da IA e rode de novo.`,
      },
    ];
  }

  const { data } = await supabaseAdmin
    .from("produtos")
    .select("nome")
    .eq("empresa_id", empresaId)
    .eq("status", "ativo")
    .eq("tipo", "produto")
    .limit(2);

  if (!data || data.length === 0) return [];
  const primeiro = data[0]!.nome;
  const segundo = data[1]?.nome ?? primeiro;

  return [
    {
      // Episódio real "Luiza": resumo completo apresentado, cliente responde
      // só "Tudo certo" — antes da tarefa 0081 isso virava handoff mudo
      // (a mensagem era classificada como social e o pedido nunca nascia).
      nome: `E2E checkout — "Tudo certo" fecha o pedido de verdade (episódio Luiza, produto: ${primeiro})`,
      mensagens: [
        `Quero um ${primeiro}`,
        "É pra entrega. Rua das Flores, 100, Centro, São Paulo",
        "Cartão de crédito",
        "Tudo certo",
        // Folga de um turno: a IA pode gastar um turno esclarecendo algo
        // (ex.: raio de entrega, tasks/0079) antes de apresentar o resumo
        // final. A confirmação repetida é idempotente por desenho, então
        // este turno extra nunca cria um segundo pedido.
        "Tudo certo",
      ],
      validar: (contexto) => {
        const problema = checarPedidoUnicoCompleto(contexto, { tipo_entrega: "entrega", exigeEndereco: true });
        if (problema) return problema;

        const alucinacoes = contexto.invariantes.filter((i) => i.evento === "transactional_claim_without_evidence");
        if (alucinacoes.length > 0) {
          return `${alucinacoes.length} afirmação(ões) transacional(is) sem evidência foram bloqueadas no caminho — o fluxo feliz não deveria produzir nenhuma`;
        }

        const ultimo = contexto.turnos[contexto.turnos.length - 1]!;
        if (ultimo.acao === "handoff") return `a confirmação terminou em handoff:\n${transcricao(contexto.turnos)}`;
        if (!ultimo.ia) return "a confirmação não gerou resposta nenhuma ao cliente (handoff mudo)";
        return null;
      },
    },
    {
      // Episódio real "Barbara": cliente informa entrega e pagamento numa
      // mensagem só — antes da tarefa 0081 a IA respondia "entendi, entrega e
      // cartão" sem executar nenhuma das duas mutações.
      nome: `E2E checkout — entrega + pagamento na mesma mensagem EXECUTAM as mutações (episódio Barbara, produto: ${segundo})`,
      mensagens: [
        `Quero uma ${segundo}`,
        "Confirmado",
        "Retirada\nDinheiro",
        "Pode fechar",
        // Mesma folga do cenário anterior: um turno extra de confirmação, que
        // é idempotente por desenho e nunca cria um segundo pedido.
        "Pode fechar",
      ],
      validar: (contexto) => {
        const executouComSucesso = (tool: string) =>
          contexto.execucoes.some((e) => e.tool_nome === tool && e.sucesso === true);

        if (!executouComSucesso("definir_tipo_entrega")) {
          return `"definir_tipo_entrega" nunca foi executada — a IA respondeu sobre a entrega sem registrar nada.\n${transcricao(contexto.turnos)}`;
        }
        if (!executouComSucesso("definir_forma_pagamento")) {
          return `"definir_forma_pagamento" nunca foi executada — a IA respondeu sobre o pagamento sem registrar nada.\n${transcricao(contexto.turnos)}`;
        }
        return checarPedidoUnicoCompleto(contexto, { tipo_entrega: "retirada", exigeEndereco: false });
      },
    },
    {
      // Conversa real que motivou a tarefa 0082, reproduzida turno a turno.
      // Antes: "quero uma pizza" virou "a gente tem várias opções", o X-Bacon
      // nunca entrou no carrinho, "é para entrega" foi respondido com ZERO
      // ferramentas ("não tá fazendo entregas", numa loja que entrega) e o
      // "Sim" final virou handoff mudo.
      nome: `E2E pipeline — conversa real do episódio 0082 (produto: ${primeiro})`,
      mensagens: [
        "Oi",
        "Quero uma pizza",
        "Quais opções têm?",
        primeiro,
        "É para entrega. Rua das Flores, 100, Centro, São Paulo",
        "Cartão de crédito",
        "Tudo certo",
        "Tudo certo",
      ],
      validar: (contexto) => {
        const turnoPizza = contexto.turnos.find((t) => t.cliente === "Quero uma pizza");
        if (turnoPizza?.ia && /(temos|tem|há)\s+(v[áa]rias|v[áa]rios|muitas|muitos)/i.test(turnoPizza.ia)) {
          return `afirmou ter opções de um produto inexistente: "${turnoPizza.ia}"`;
        }

        const executouComSucesso = (tool: string) =>
          contexto.execucoes.some((e) => e.tool_nome === tool && e.sucesso === true);
        if (!executouComSucesso("adicionar_ao_carrinho")) {
          return `o item nunca entrou no carrinho — bug central da tarefa 0082.
${transcricao(contexto.turnos)}`;
        }
        if (!executouComSucesso("consultar_opcoes_atendimento")) {
          return "nunca consultou o que a loja oferece — sem esse fato a IA pode voltar a inventar que não faz entrega";
        }

        const inventou = contexto.invariantes.filter(
          (i) => i.evento === "business_claim_without_evidence" || i.evento === "claim_contradicts_evidence",
        );
        if (inventou.length > 0) {
          return `${inventou.length} afirmação(ões) sem lastro precisaram ser bloqueadas — o fluxo feliz não deveria produzir nenhuma`;
        }

        return checarPedidoUnicoCompleto(contexto, { tipo_entrega: "entrega", exigeEndereco: true });
      },
    },
    {
      // Confirmação repetida (item 15 da especificação) ponta a ponta: mesmo
      // com três "tudo certo" seguidos, só pode existir UM pedido real.
      nome: `E2E checkout — confirmação repetida nunca cria dois pedidos (produto: ${primeiro})`,
      mensagens: [
        `Quero um ${primeiro}`,
        "Retirada",
        "Pix",
        "Tudo certo",
        "Tudo certo",
        "Tudo certo",
      ],
      validar: (contexto) => checarPedidoUnicoCompleto(contexto, { tipo_entrega: "retirada", exigeEndereco: false }),
    },
  ];
}
