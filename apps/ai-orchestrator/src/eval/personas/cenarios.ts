// Runner de cenário multi-turno: alterna entre o simulador de cliente
// (simulador-cliente.ts) e a pipeline real (`processarMensagem`), acumulando
// o histórico real da conversa, até o cliente sinalizar fim ou bater o
// limite de turnos da persona. Ao final, roda checagens determinísticas
// (o que é objetivo: handoff ocorreu quando não devia, ou preço mencionado
// não bate com o catálogo real) + o LLM-juiz (o que é qualitativo: conduta,
// continuidade, progresso rumo ao objetivo do cliente).
import { supabaseAdmin } from "../../lib/supabase.js";
import { env } from "../../lib/env.js";
import { processarMensagem } from "../../agent/orquestrador.js";
import type { ChatMessage } from "../../llm/types.js";
import {
  criarAtendimentoDeTeste,
  limparAtendimentoDeTeste,
  montarConfigDeProcessamentoDeTeste,
} from "../casos-e2e.js";
import { gerarProximaFalaCliente } from "./simulador-cliente.js";
import { julgarConducaoDaConversa } from "./juiz.js";
import type { CenarioPersonaDef } from "./definicoes.js";
import { afirmaPedidoConfirmado } from "../../agent/verificacao.js";

export interface TurnoSimulado {
  cliente: string;
  ia: string | null;
  acao: "responder" | "pedir_esclarecimento" | "handoff";
}

export interface ResultadoCenario {
  nomePersona: string;
  ok: boolean;
  turnos: TurnoSimulado[];
  motivosFalha: string[];
}

function formatarReal(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/** Preços reais ativos da empresa de teste — usados como rede de segurança
 * determinística contra preço inventado nas respostas da IA ao longo da
 * conversa simulada (mesmo espírito de `montarCasoPrecoReal` em
 * casos-e2e.ts, mas aplicado a qualquer valor monetário citado, não a um
 * produto fixo). Inclui preço de produto E de adicionais/opções (`opcoes.
 * preco_adicional`) — episódio real do gabarito de personas: "adicionar
 * ovo por R$ 3,00" foi sinalizado como inventado só porque a checagem
 * original olhava só pra `produtos`, nunca pra `opcoes`. Também inclui
 * somas de até 3 valores reais (produto + adicionais), pra cobrir frases
 * tipo "X-Bacon com ovo: R$ 35,90" sem precisar de acesso às evidências
 * internas da rodada (que `ResultadoOrquestracao` não expõe) — continua
 * uma heurística, não uma verificação exaustiva de todo subtotal possível.
 */
async function carregarPrecosReais(empresaId: string): Promise<Set<string>> {
  const [{ data: produtos }, { data: opcoes }] = await Promise.all([
    supabaseAdmin.from("produtos").select("preco").eq("empresa_id", empresaId).eq("status", "ativo").eq("tipo", "produto"),
    supabaseAdmin.from("opcoes").select("preco_adicional").eq("empresa_id", empresaId).eq("disponivel", true),
  ]);

  const valoresBase = [
    ...(produtos ?? []).map((row) => Number(row.preco)),
    ...(opcoes ?? []).map((row) => Number(row.preco_adicional)).filter((v) => v > 0),
  ];

  const precos = new Set<string>();
  for (const valor of valoresBase) precos.add(formatarReal(valor));

  // Combinações de até 3 valores (produto + até 2 adicionais) — cobre
  // resumos de item único personalizado, não carrinhos com vários itens
  // (esses continuam fora do escopo desta heurística, ver comentário do
  // caller sobre "subtotal"/"total").
  for (let i = 0; i < valoresBase.length; i++) {
    for (let j = i; j < valoresBase.length; j++) {
      precos.add(formatarReal(valoresBase[i]! + valoresBase[j]!));
      for (let k = j; k < valoresBase.length; k++) {
        precos.add(formatarReal(valoresBase[i]! + valoresBase[j]! + valoresBase[k]!));
      }
    }
  }

  return precos;
}

function extrairValoresMonetarios(texto: string): string[] {
  const matches = texto.match(/R\$\s?(\d{1,4},\d{2})/g) ?? [];
  return matches.map((m) => m.replace(/^R\$\s?/, ""));
}

export async function rodarCenarioPersona(def: CenarioPersonaDef): Promise<ResultadoCenario> {
  const empresaId = env.empresaId;
  const teste = await criarAtendimentoDeTeste(empresaId);
  const motivosFalha: string[] = [];
  const turnos: TurnoSimulado[] = [];
  let houveHandoff = false;
  let houveAfirmacaoDePedidoConfirmado = false;

  try {
    const config = await montarConfigDeProcessamentoDeTeste(empresaId, teste);
    const precosReais = await carregarPrecosReais(empresaId);
    const historico: ChatMessage[] = [];

    for (let turno = 0; turno < def.persona.maxTurnos; turno++) {
      const falaCliente = await gerarProximaFalaCliente(def.persona, historico);
      if (!falaCliente.texto) break;

      historico.push({ role: "user", content: falaCliente.texto });

      if (houveHandoff) {
        // Depois de um handoff a IA não responde mais automaticamente (o
        // humano assume) — encerra a simulação aqui, não há mais pipeline
        // real pra chamar.
        turnos.push({ cliente: falaCliente.texto, ia: null, acao: "handoff" });
        break;
      }

      const resultado = await processarMensagem({
        pergunta: falaCliente.texto,
        historico: historico.slice(0, -1),
        ...config,
      });

      turnos.push({ cliente: falaCliente.texto, ia: resultado.respostaTexto, acao: resultado.acao });

      if (resultado.acao === "handoff") {
        houveHandoff = true;
        if (!def.handoffEsperado) {
          motivosFalha.push(
            `handoff disparado no turno ${turno + 1} sem que o cenário exigisse (cliente disse: "${falaCliente.texto}")`,
          );
        }
      }

      if (resultado.respostaTexto) {
        historico.push({ role: "assistant", content: resultado.respostaTexto });

        if (afirmaPedidoConfirmado(resultado.respostaTexto)) {
          houveAfirmacaoDePedidoConfirmado = true;
        }

        // Ignora valores citados junto de "subtotal"/"total": são somas de
        // vários itens (não verificáveis contra preço unitário de
        // catálogo sem acesso às evidências internas da rodada, que
        // `ResultadoOrquestracao` não expõe) — reprovar aqui seria falso
        // positivo, não indício de preço inventado.
        const pareceValorComputado = /subtotal|total/i.test(resultado.respostaTexto);
        const valoresDaMensagem = extrairValoresMonetarios(resultado.respostaTexto);
        if (!pareceValorComputado && valoresDaMensagem.length === 1) {
          const [valor] = valoresDaMensagem;
          if (!precosReais.has(valor!)) {
            motivosFalha.push(`valor R$ ${valor} citado no turno ${turno + 1} não bate com nenhum preço real do catálogo`);
          }
        }
      }

      if (falaCliente.fim) break;
    }

    if (def.handoffEsperado && !houveHandoff) {
      motivosFalha.push("cenário de controle esperava handoff em algum momento, mas a conversa terminou sem nenhum");
    }

    // Checagem de ponta a ponta contra o banco real (não só a lógica
    // isolada de verificacao.ts): se em algum turno a IA afirmou que o
    // pedido foi confirmado, precisa existir de verdade um pedido criado
    // pra este atendimento, com entrega e pagamento já definidos — nunca
    // confia que "a IA disse que criou" significa "criou". Episódio real de
    // produção que motivou esta checagem: a IA confirmou um pedido sem
    // nunca ter perguntado tipo de entrega, endereço nem forma de pagamento.
    if (houveAfirmacaoDePedidoConfirmado) {
      const { data: pedidosCriados } = await supabaseAdmin
        .from("pedidos")
        .select("tipo_entrega, endereco_json, forma_pagamento")
        .eq("atendimento_id", teste.atendimentoId)
        .eq("empresa_id", empresaId);

      if (!pedidosCriados || pedidosCriados.length === 0) {
        motivosFalha.push(
          "IA afirmou que o pedido foi confirmado, mas nenhum pedido real existe no banco pra este atendimento (alucinação de confirmação)",
        );
      } else {
        for (const pedido of pedidosCriados) {
          if (!pedido.tipo_entrega) {
            motivosFalha.push("pedido criado no banco sem 'tipo_entrega' definido — IA confirmou sem ter perguntado entrega/retirada");
          }
          if (!pedido.forma_pagamento) {
            motivosFalha.push("pedido criado no banco sem 'forma_pagamento' definido — IA confirmou sem ter perguntado forma de pagamento");
          }
          if (pedido.tipo_entrega === "entrega" && !pedido.endereco_json) {
            motivosFalha.push("pedido de entrega criado no banco sem 'endereco_json' definido — IA confirmou sem ter pedido o endereço");
          }
        }
      }
    }

    const veredicto = await julgarConducaoDaConversa({
      nomePersona: def.persona.nome,
      objetivo: def.persona.objetivo,
      transcricao: historico,
    });
    if (!veredicto.passou) {
      motivosFalha.push(`LLM-juiz reprovou a condução da conversa: ${veredicto.motivo}`);
    }

    return { nomePersona: def.persona.nome, ok: motivosFalha.length === 0, turnos, motivosFalha };
  } finally {
    await limparAtendimentoDeTeste(teste.clienteId);
  }
}
