// Gabarito do pipeline "nada sai sem lastro" (tarefa 0082) — sem banco, sem
// LLM e sem rede.
//
// O cenário central é a conversa REAL que motivou a tarefa, turno a turno,
// reconstruída dos logs de `ia_execucoes`/`ia_decisoes`:
//
//   "Quero uma pizza"   → a busca não achou nada e a IA respondeu "a gente
//                          tem várias opções no cardápio"
//   "X bacon"           → respondeu tudo certo, mas nunca chamou
//                          `adicionar_ao_carrinho` — o carrinho ficou vazio
//                          e a máquina de estados nunca ligou
//   "É para entrega"    → ZERO ferramentas na rodada e a IA afirmou
//                          "não tá fazendo entregas", numa loja que entrega
//   "Sim"               → classificado como conversa social
//
// Cada um desses turnos tem um caso aqui.
import { FLUXO_PEDIDO_CONFIG_PADRAO, checkoutEhTransacional, derivarEstadoCheckout, pedidoVazio } from "@prospect/shared";
import { resolverItensMencionados } from "../agent/interpretacao/itens.js";
import { resolverPerguntas, TOOLS_POR_ASSUNTO } from "../agent/interpretacao/roteamento.js";
import {
  ASSUNTOS_PERGUNTADOS,
  INTENCAO_VAZIA,
  ehSocial,
  intencaoDeterministica,
  normalizarIntencao,
  type AssuntoPerguntado,
  type IntencaoDaMensagem,
  type ItemMencionado,
} from "../agent/interpretacao/mensagem.js";
import { aplicarIntencao } from "../agent/checkout/transicoes.js";
import { fatosParaAfirmacoes, fatosParaLastro, montarFatosVerificados } from "../agent/checkout/fatos.js";
import { detectarContradicao, verificarLastro } from "../agent/lastro.js";
import { CTX_FALSO, chatFalso, criarMundo, criarPortas, item } from "./mundo-falso.js";
import type { CasoDeterministico } from "./deterministicos.js";

const CONFIG = FLUXO_PEDIDO_CONFIG_PADRAO;

function citado(texto: string, quantidade = 1, extras: Partial<ItemMencionado> = {}): ItemMencionado {
  return { texto, quantidade, adicionais_texto: [], observacao: null, acao: "adicionar", ...extras };
}

function intencao(parcial: Partial<IntencaoDaMensagem>): IntencaoDaMensagem {
  return { ...INTENCAO_VAZIA, ...parcial };
}

export const CASOS_PIPELINE: CasoDeterministico[] = [
  // ======================= TURNO 1 — "QUERO UMA PIZZA" =======================
  {
    nome: 'episódio real, turno 1: "quero uma pizza" numa loja sem pizza vira fato negativo, nunca item adicionado',
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo);

      const resultado = await resolverItensMencionados({ itens: [citado("pizza")], ctx: CTX_FALSO, portas });

      if (resultado.adicionados.length > 0) return "adicionou ao carrinho um produto que não existe";
      if (!resultado.naoEncontrados.includes("pizza")) return "não registrou que a pizza não existe";
      if (!mundo.chamadas.some((c) => c.tool === "buscar_produtos")) return "não chegou a buscar no catálogo";
      return null;
    },
  },
  {
    nome: 'episódio real, turno 1: afirmar "temos várias opções" com o fato de que não existe é bloqueado SEM gastar LLM',
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "sem_carrinho",
        pedido: pedidoVazio(),
        pendencias: ["produtos"],
        itensResolvidos: {
          adicionados: [],
          removidos: [],
          quantidadeAlterada: [],
          naoEncontrados: ["pizza"],
          ambiguos: [],
          naoEstaNoCarrinho: [],
          evidencias: [],
          falhas: [],
        },
      });
      const paraLastro = fatosParaLastro(fatos, []);

      const contradicoes = detectarContradicao(
        "Ah, legal! Mas me conta: qual sabor de pizza você quer? A gente tem várias opções de pizza no cardápio.",
        paraLastro,
      );
      return contradicoes.length > 0 ? null : "a contradição com o fato de inexistência passou batido";
    },
  },
  {
    nome: "dizer honestamente que NÃO tem o produto nunca é bloqueado como contradição",
    rodar: () => {
      const paraLastro = [{ texto: 'Não existe nenhum produto chamado "pizza".', negaExistenciaDe: "pizza" }];
      const contradicoes = detectarContradicao(
        "Poxa, não temos pizza no cardápio. Mas temos hambúrguer, quer ver?",
        paraLastro,
      );
      return contradicoes.length === 0 ? null : `bloqueou a resposta correta: ${JSON.stringify(contradicoes)}`;
    },
  },

  // ======================= TURNO 2 — "X BACON" =======================
  {
    nome: 'episódio real, turno 2: "x bacon" MONTA o carrinho pelo código — não depende do modelo chamar a ferramenta',
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo);

      const resultado = await resolverItensMencionados({ itens: [citado("x bacon")], ctx: CTX_FALSO, portas });

      if (!mundo.chamadas.some((c) => c.tool === "adicionar_ao_carrinho")) {
        return "adicionar_ao_carrinho não foi executada — é exatamente o bug original";
      }
      if (resultado.adicionados[0]?.nome !== "X-Bacon") return "não resolveu 'x bacon' para o produto real 'X-Bacon'";
      if (mundo.pedido.itens.length !== 1) return "o carrinho continuou vazio";
      return null;
    },
  },
  {
    nome: "episódio real, turno 2: com o carrinho montado, a máquina de estados finalmente LIGA",
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo);
      await resolverItensMencionados({ itens: [citado("x bacon")], ctx: CTX_FALSO, portas });

      const estado = derivarEstadoCheckout(mundo.pedido, null, null, CONFIG);
      if (estado !== "montando_carrinho") return `estado errado depois de adicionar: ${estado}`;
      return checkoutEhTransacional(estado) ? null : "o checkout continuou não-transacional mesmo com item no carrinho";
    },
  },
  {
    nome: "adicional citado que não existe no produto nunca é inventado — vira fato",
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo);

      const resultado = await resolverItensMencionados({
        itens: [citado("x bacon", 1, { adicionais_texto: ["bacon extra", "abacaxi"] })],
        ctx: CTX_FALSO,
        portas,
      });

      const adicionado = resultado.adicionados[0];
      if (!adicionado) return "não adicionou o produto";
      if (!adicionado.adicionais_ignorados.includes("abacaxi")) return "não sinalizou o adicional inexistente";
      if (mundo.pedido.itens[0]?.opcoes.length !== 1) return "gravou um adicional que não existe no produto";
      return null;
    },
  },
  {
    nome: "produto ambíguo nunca é escolhido sozinho — vira esclarecimento com os nomes reais",
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo);

      // "a" casa com X-Bacon, Batata Frita e Coca-Cola.
      const resultado = await resolverItensMencionados({ itens: [citado("a")], ctx: CTX_FALSO, portas });

      if (resultado.adicionados.length > 0) return "escolheu um produto sozinho numa busca ambígua";
      if (resultado.ambiguos.length !== 1) return "não sinalizou a ambiguidade";
      return resultado.ambiguos[0]!.candidatos.length > 1 ? null : "não trouxe os candidatos reais para a pergunta";
    },
  },

  // ======================= TURNO 3 — "É PARA ENTREGA" =======================
  {
    nome: 'episódio real, turno 3: "é para entrega" EXECUTA a mutação e traz a configuração como fato',
    rodar: async () => {
      const mundo = criarMundo({ ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] });
      const portas = criarPortas(mundo);

      const transicao = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ tipo_entrega: "entrega" }),
        config: CONFIG,
        portas,
      });
      const roteamento = await resolverPerguntas({
        perguntas: ["opcoes_atendimento"],
        ctx: CTX_FALSO,
        portas,
        termoLivre: "é para entrega",
      });

      if (transicao.pedido.tipo_entrega !== "entrega") return "a entrega não foi registrada no estado real";
      if (!mundo.chamadas.some((c) => c.tool === "consultar_opcoes_atendimento")) {
        return "não consultou o que a loja oferece — é o fato que impede afirmar 'não fazemos entrega'";
      }

      const fatos = montarFatosVerificados({
        estado: "montando_carrinho",
        pedido: transicao.pedido,
        pendencias: transicao.pendencias,
        evidencias: [...transicao.evidencias, ...roteamento.evidencias],
      });
      if (!fatos.opcoes_atendimento?.tipos_entrega.includes("entrega")) {
        return "o fato de que a loja faz entrega não chegou ao conjunto de fatos";
      }

      const afirmacoes = fatosParaAfirmacoes(fatos, [...transicao.evidencias, ...roteamento.evidencias]);
      return afirmacoes.some((a) => /atende por/i.test(a.texto) && /entrega/i.test(a.texto))
        ? null
        : "nenhuma afirmação verificada descreve o que a loja atende";
    },
  },
  {
    nome: "roteamento de área de entrega consulta as DUAS categorias de conhecimento (regiao e entrega)",
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo, { conhecimento: { entrega: "Entregamos num raio de 5km da loja." } });

      const resultado = await resolverPerguntas({
        perguntas: ["area_entrega"],
        ctx: CTX_FALSO,
        portas,
        termoLivre: "vocês entregam no Centro?",
      });

      const tools = mundo.chamadas.map((c) => c.tool);
      if (!tools.includes("consultar_regiao") || !tools.includes("consultar_taxa")) {
        return `consultou só ${JSON.stringify(tools)} — a área de entrega da empresa real está na categoria "entrega"`;
      }
      return resultado.assuntosSemResposta.includes("area_entrega")
        ? "marcou como sem resposta mesmo tendo achado o conteúdo na outra categoria"
        : null;
    },
  },
  {
    nome: "assunto perguntado sem nada cadastrado vira fato de lacuna — a IA admite em vez de improvisar",
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo, { conhecimento: {} });

      const roteamento = await resolverPerguntas({
        perguntas: ["horario"],
        ctx: CTX_FALSO,
        portas,
        termoLivre: "que horas vocês abrem?",
      });

      if (!mundo.chamadas.some((c) => c.tool === "consultar_horario")) return "não consultou o horário";
      return roteamento.assuntosSemResposta.includes("horario")
        ? null
        : "não marcou o assunto como sem resposta cadastrada";
    },
  },
  {
    nome: "todo assunto do enum tem pelo menos uma ferramenta obrigatória mapeada",
    rodar: () => {
      const semTool = ASSUNTOS_PERGUNTADOS.filter((a) => (TOOLS_POR_ASSUNTO[a as AssuntoPerguntado] ?? []).length === 0);
      return semTool.length === 0 ? null : `assuntos sem ferramenta: ${JSON.stringify(semTool)}`;
    },
  },

  // ======================= TURNO 4 — "SIM" =======================
  {
    nome: 'episódio real, turno 4: "Sim" respondendo a uma pergunta do sistema NUNCA é conversa social',
    rodar: () => {
      const reconhecida = intencaoDeterministica("Sim");
      if (!reconhecida) return '"Sim" não foi reconhecido como intenção nenhuma';
      if (reconhecida.confirmacao !== "confirma") return `esperado "confirma", obtido "${reconhecida.confirmacao}"`;
      return reconhecida.social === false ? null : "foi classificado como social — é exatamente o bug original";
    },
  },
  {
    nome: "`social` é derivado em código: qualquer item, dado, confirmação ou pergunta desliga o caminho social",
    rodar: () => {
      const casos: Array<[string, Partial<IntencaoDaMensagem>]> = [
        ["item citado", { itens: [citado("x bacon")] }],
        ["tipo de entrega", { tipo_entrega: "entrega" }],
        ["forma de pagamento", { forma_pagamento: "pix" }],
        ["confirmação", { confirmacao: "confirma" }],
        ["pergunta", { perguntas: ["horario"] }],
        ["cancelamento", { quer_cancelar: true }],
      ];
      for (const [nome, parcial] of casos) {
        if (ehSocial({ ...INTENCAO_VAZIA, ...parcial })) return `"${nome}" foi tratado como conversa social`;
      }
      return ehSocial(INTENCAO_VAZIA) ? null : "saudação pura deixou de ser social";
    },
  },
  {
    nome: "o modelo não consegue mais marcar a mensagem como social por conta própria",
    rodar: () => {
      // Mesmo que a saída do modelo tentasse afirmar que é social, `social` é
      // recalculado a partir do conteúdo — o campo não é lido do JSON.
      const resultado = normalizarIntencao(
        { social: true, sem_investigacao: true, perguntas: ["horario"] },
        CONFIG,
      );
      return resultado.social === false ? null : "o modelo conseguiu forçar o caminho social";
    },
  },

  // ======================= GATE DE LASTRO =======================
  {
    nome: "gate de lastro bloqueia afirmação de regra de negócio sem nenhum fato que a sustente",
    rodar: async () => {
      const fatos = montarFatosVerificados({ estado: "montando_carrinho", pedido: pedidoVazio(), pendencias: ["produtos"] });
      const veredicto = await verificarLastro({
        texto: "No momento a gente não tá fazendo entregas, só retirada no balcão.",
        fatos: fatosParaLastro(fatos, []),
        chat: chatFalso('{"afirmacoes_sem_lastro":["No momento a gente não tá fazendo entregas, só retirada no balcão."]}'),
      });
      if (veredicto.aprovado) return "afirmação de regra de negócio sem lastro passou";
      return veredicto.semLastro[0]?.motivo === "sem_evidencia" ? null : "motivo classificado errado";
    },
  },
  {
    nome: "gate de lastro aprova texto inteiramente ancorado nos fatos",
    rodar: async () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] };
      const fatos = montarFatosVerificados({ estado: "montando_carrinho", pedido, pendencias: ["tipo_entrega"] });
      const veredicto = await verificarLastro({
        texto: "Anotei o X-Bacon aqui! Você prefere entrega ou retirada?",
        fatos: fatosParaLastro(fatos, []),
        chat: chatFalso('{"afirmacoes_sem_lastro":[]}'),
      });
      return veredicto.aprovado ? null : "bloqueou uma resposta legítima e ancorada";
    },
  },
  {
    nome: "auditor indisponível não trava a conversa (falha do classificador aprova, camadas determinísticas seguem valendo)",
    rodar: async () => {
      const fatos = montarFatosVerificados({ estado: "sem_carrinho", pedido: pedidoVazio(), pendencias: ["produtos"] });
      const veredicto = await verificarLastro({
        texto: "Oi! Como posso ajudar?",
        fatos: fatosParaLastro(fatos, []),
        chat: chatFalso("isso não é json"),
      });
      return veredicto.aprovado ? null : "uma falha do auditor derrubou uma mensagem social";
    },
  },
  {
    nome: "contradição é detectada antes do classificador — sem lastro por evidência contrária, não por opinião do modelo",
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "sem_carrinho",
        pedido: pedidoVazio(),
        pendencias: ["produtos"],
        itensResolvidos: {
          adicionados: [],
          removidos: [],
          quantidadeAlterada: [],
          naoEncontrados: ["pizza"],
          ambiguos: [],
          naoEstaNoCarrinho: [],
          evidencias: [],
          falhas: [],
        },
      });
      const veredicto = await verificarLastro({
        texto: "Temos pizza de calabresa e de mussarela!",
        // Classificador que aprovaria tudo — o bloqueio precisa vir da
        // camada determinística, não dele.
        fatos: fatosParaLastro(fatos, []),
        chat: chatFalso('{"afirmacoes_sem_lastro":[]}'),
      });
      if (veredicto.aprovado) return "a contradição não foi detectada";
      return veredicto.semLastro[0]?.motivo === "contradiz_evidencia" ? null : "motivo classificado errado";
    },
  },
];
