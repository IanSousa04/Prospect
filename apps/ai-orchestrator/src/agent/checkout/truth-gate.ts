// TransactionTruthGate (tarefa 0081, item 10) — última camada antes de a
// mensagem sair pro cliente. Compara o que o texto AFIRMA com o que o
// sistema COMPROVADAMENTE fez.
//
// A garantia principal não é textual: é o estado real (`FatosVerificados`,
// montado a partir do banco). O reconhecimento da afirmação tem duas
// camadas, nesta ordem:
//
//   1. regex determinística (agent/verificacao.ts) — grátis, sempre roda;
//   2. classificador semântico (LLM) — só na JANELA DE RISCO, isto é,
//      quando não existe `pedido_id` desta rodada e o checkout está num
//      estado transacional. Fora dela, uma afirmação de pedido ou é
//      verdadeira (tem evidência) ou não faz sentido no contexto, então
//      não vale gastar uma chamada por turno.
//
// Bloquear aqui NUNCA significa silêncio: o chamador regenera a resposta a
// partir dos fatos reais (ver orquestrador.ts) e, no limite, usa a mensagem
// determinística de `fatos.ts`. O handoff mudo que existia antes desta
// tarefa era pior pro cliente do que a própria alucinação.
import { checkoutEhTransacional } from "@prospect/shared";
import { getChatModel } from "../../llm/client.js";
import type { ChatModel } from "../../llm/types.js";
import { afirmaCancelamentoRealizado, afirmaHandoffRealizado, afirmaPedidoConfirmado } from "../verificacao.js";
import { NOME_PENDENCIA, type FatosVerificados } from "./fatos.js";

export type ClassificacaoResposta = "TRANSACTIONAL_CLAIM" | "NON_TRANSACTIONAL";

export type MotivoBloqueioTruthGate = "pedido_sem_evidencia" | "handoff_sem_evidencia" | "cancelamento_inexistente";

export interface VeredictoTruthGate {
  aprovado: boolean;
  motivo?: MotivoBloqueioTruthGate;
  detectadoPor?: "regex" | "classificador";
}

const APROVADO: VeredictoTruthGate = { aprovado: true };

const PROMPT_CLASSIFICADOR = `Você classifica mensagens que um atendente de delivery está prestes a enviar a um cliente por WhatsApp. Não julgue se a mensagem é boa ou educada — só se ela AFIRMA que algo já aconteceu no sistema.

Responda APENAS com JSON: {"classificacao":"TRANSACTIONAL_CLAIM"} ou {"classificacao":"NON_TRANSACTIONAL"}.

Use "TRANSACTIONAL_CLAIM" quando a mensagem afirmar, como fato consumado, QUALQUER uma destas coisas:
- que o pedido foi criado, confirmado, fechado, registrado ou anotado como pedido;
- que o pedido foi enviado, encaminhado, está com a equipe, foi para a cozinha, está em preparo ou a caminho;
- que o pagamento foi processado/cobrado;
- que um atendente humano já foi acionado, avisado ou vai assumir a conversa.

Use "NON_TRANSACTIONAL" para todo o resto, incluindo:
- perguntar se pode confirmar ("posso fechar assim?", "confirma pra mim?");
- apresentar um resumo do carrinho sem dizer que virou pedido;
- dizer o que ainda falta ("preciso do endereço");
- confirmar que ANOTOU uma preferência do pedido em construção (item adicionado ao carrinho, forma de pagamento escolhida, entrega ou retirada) sem dizer que o pedido está fechado;
- responder dúvida sobre cardápio, preço, horário ou qualquer outro assunto.

Na dúvida entre as duas, responda "TRANSACTIONAL_CLAIM".`;

async function classificarSemanticamente(texto: string, chat: ChatModel): Promise<ClassificacaoResposta> {
  try {
    const resultado = await chat.chatCompletion(
      [
        { role: "system", content: PROMPT_CLASSIFICADOR },
        { role: "user", content: texto },
      ],
      { jsonMode: true, temperature: 0 },
    );
    if (!resultado.content) return "NON_TRANSACTIONAL";
    const bruto = JSON.parse(resultado.content) as Record<string, unknown>;
    return bruto.classificacao === "TRANSACTIONAL_CLAIM" ? "TRANSACTIONAL_CLAIM" : "NON_TRANSACTIONAL";
  } catch {
    // Falha do classificador não pode bloquear uma conversa legítima — a
    // camada de regex já rodou e o estado real continua sendo a garantia
    // de fundo (a tool nunca cria pedido sem pré-requisito).
    return "NON_TRANSACTIONAL";
  }
}

/**
 * `true` quando ainda é possível o texto afirmar uma criação que não
 * aconteceu — é a única situação em que vale pagar uma chamada de LLM a
 * mais. Com `pedido_id` real na mão, afirmar que o pedido existe é verdade.
 */
export function dentroDaJanelaDeRisco(fatos: FatosVerificados): boolean {
  return fatos.pedido_id === null && checkoutEhTransacional(fatos.estado_checkout);
}

export async function avaliarRespostaTransacional(params: {
  texto: string;
  fatos: FatosVerificados;
  chat?: ChatModel;
}): Promise<VeredictoTruthGate> {
  const { texto, fatos } = params;

  // ---- Camada 1: regex determinística ----
  if (afirmaPedidoConfirmado(texto) && fatos.pedido_id === null) {
    return { aprovado: false, motivo: "pedido_sem_evidencia", detectadoPor: "regex" };
  }
  if (afirmaHandoffRealizado(texto) && fatos.handoff_id === null) {
    return { aprovado: false, motivo: "handoff_sem_evidencia", detectadoPor: "regex" };
  }
  // Cancelamento não tem evidência possível: a IA não tem a ferramenta
  // (tasks/0058), então a afirmação é sempre falsa, em qualquer estado.
  if (afirmaCancelamentoRealizado(texto)) {
    return { aprovado: false, motivo: "cancelamento_inexistente", detectadoPor: "regex" };
  }

  // ---- Camada 2: classificador semântico, só na janela de risco ----
  if (!dentroDaJanelaDeRisco(fatos)) return APROVADO;

  const chat = params.chat ?? getChatModel();
  const classificacao = await classificarSemanticamente(texto, chat);
  if (classificacao === "TRANSACTIONAL_CLAIM") {
    return { aprovado: false, motivo: "pedido_sem_evidencia", detectadoPor: "classificador" };
  }

  return APROVADO;
}

/**
 * Instrução de correção usada na única retentativa de redação: diz ao
 * Atendente, em termos do estado real, exatamente o que ele não pode
 * afirmar e o que precisa perguntar. Se ainda assim ele insistir, o
 * chamador troca por `mensagemDeterministicaDeFallback` (fatos.ts) — o
 * cliente nunca fica sem resposta.
 */
export function instrucaoDeCorrecao(fatos: FatosVerificados, motivo: MotivoBloqueioTruthGate): string {
  if (motivo === "cancelamento_inexistente") {
    return "ATENÇÃO: sua resposta anterior foi descartada porque afirmava que um pedido foi cancelado, e o sistema NÃO cancela nada por aqui. Reescreva sem dizer que cancelou — se o cliente quer cancelar, diga que vai passar para a equipe resolver.";
  }

  if (motivo === "handoff_sem_evidencia") {
    return "ATENÇÃO: sua resposta anterior foi descartada porque afirmava que um atendente humano já tinha sido acionado, e isso NÃO aconteceu. Reescreva sem dizer que alguém foi chamado, avisado ou vai assumir a conversa.";
  }

  const pendenciasReais = fatos.pendencias.filter((p) => p !== "confirmacao_final");
  const oQueFalta =
    pendenciasReais.length > 0
      ? `Ainda falta: ${pendenciasReais.map((p) => NOME_PENDENCIA[p]).join(", ")}. Peça exatamente isso ao cliente.`
      : "O pedido está completo, mas o cliente ainda não confirmou o resumo. Apresente o resumo e pergunte se pode confirmar.";

  return `ATENÇÃO: sua resposta anterior foi descartada porque afirmava que o pedido já estava confirmado/criado/enviado, e NENHUM pedido foi criado no sistema. ${oQueFalta} Nunca diga que o pedido foi confirmado, criado, fechado, enviado, que foi pra cozinha, que está em preparo ou a caminho.`;
}
