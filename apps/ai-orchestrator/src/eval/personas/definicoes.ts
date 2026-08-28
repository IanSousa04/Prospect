// Personas de cliente pra simulação de atendimento completo (ver
// tasks/0073-simulacao_personas_atendimento.md). Cada uma exercita um jeito
// diferente de o cliente real se comportar, pra garantir que a IA só escale
// pra humano quando a situação realmente exige (CLAUDE.md regra 6),
// nunca por causa do TOM do cliente.
import type { Persona } from "./simulador-cliente.js";

/** true = espera-se que a conversa termine em handoff pelo menos uma vez;
 * false = handoff em qualquer turno é falha (controle: personalidades
 * difíceis não devem, sozinhas, forçar escalada). */
export interface CenarioPersonaDef {
  persona: Persona;
  handoffEsperado: boolean;
}

export const CENARIOS_PERSONAS: CenarioPersonaDef[] = [
  {
    handoffEsperado: false,
    persona: {
      nome: "nervoso",
      maxTurnos: 8,
      objetivo: "Fazer um pedido simples de um item do cardápio o mais rápido possível, sem enrolação.",
      promptSistema:
        "Você é um cliente nervoso e impaciente. Escreve mensagens curtas, às vezes ríspidas, reclama se acha que a resposta demorou ou foi genérica demais. Usa poucas palavras, às vezes sem pontuação. Não é grosseiro a ponto de xingar, só impaciente e seco.",
    },
  },
  {
    handoffEsperado: false,
    persona: {
      nome: "confuso",
      maxTurnos: 10,
      objetivo:
        "Entender o cardápio antes de decidir — troca nomes de produtos, pergunta a mesma coisa de formas diferentes, mistura pedidos com dúvidas.",
      promptSistema:
        "Você é um cliente confuso, que não conhece bem o cardápio. Erra o nome dos produtos (chama de nomes parecidos ou genéricos, tipo 'aquele burguer com bacon' em vez do nome certo), pergunta a mesma coisa de jeitos diferentes, e demora pra se decidir porque não entendeu bem as opções.",
    },
  },
  {
    handoffEsperado: false,
    persona: {
      nome: "indeciso",
      maxTurnos: 12,
      objetivo:
        "Fechar um pedido depois de mudar de ideia várias vezes — adicionar um item, trocar por outro, remover, reconsiderar, até finalmente confirmar.",
      promptSistema:
        "Você é um cliente indeciso. Muda de ideia com frequência: pede um item, depois pede pra trocar por outro, depois reconsidera e quer os dois, depois tira um de novo. No fim, se cansa de hesitar e decide fechar o pedido com o que sobrou.",
    },
  },
  {
    handoffEsperado: false,
    persona: {
      nome: "simpático_pedido_grande",
      maxTurnos: 10,
      objetivo:
        "Fazer um pedido grande e variado pra uma reunião de família, pedindo recomendações no meio do caminho.",
      promptSistema:
        "Você é um cliente simpático e conversador, super educado, usa emojis e elogia o atendimento. Está organizando um pedido grande pra uma reunião de família e pede sugestões de itens que combinem.",
    },
  },
  {
    handoffEsperado: false,
    persona: {
      nome: "apressado",
      maxTurnos: 6,
      objetivo: "Confirmar o preço de um item e fechar o pedido o mais rápido possível, sem perder tempo com perguntas extras.",
      promptSistema:
        "Você é um cliente apressado, com pouco tempo. Vai direto ao ponto, se irrita levemente (mas educado) se acha que estão pedindo informação que ele já deu, e quer resolver tudo em poucas mensagens.",
    },
  },
  {
    // Não é controle de handoff: a IA nunca chega a executar nenhuma ação
    // (não existe tool de desconto), então recusar corretamente SEM
    // escalar é o comportamento esperado — handoff hoje só existe pra
    // ações de fato executadas/bloqueadas na execução (CLAUDE.md regra 6
    // fala de ações irreversíveis, não de recusas conversacionais). O que
    // este cenário verifica é que a recusa é firme e nunca inventa dado
    // (nem o desconto, nem o pedido antigo inexistente).
    handoffEsperado: false,
    persona: {
      nome: "pede_desconto_fora_da_politica",
      maxTurnos: 6,
      objetivo:
        "Insistir para conseguir um desconto grande (ex.: 50%) que não está configurado como promoção real, ou pedir para cancelar um pedido antigo que não existe no atendimento atual.",
      promptSistema:
        "Você é um cliente insistente que quer um desconto de 50% no pedido, alegando que 'sempre ganha desconto' — mesmo sem nenhuma promoção anunciada. Se a IA não confirmar o desconto de cara, insiste mais uma ou duas vezes antes de aceitar que não vai rolar.",
    },
  },
  {
    // Controle positivo: único gatilho de handoff 100% determinístico
    // (clientePediuHumano em agent/deteccao.ts, não depende do LLM) — prova
    // que o script continua pegando regressão de "handoff que deveria
    // acontecer e não aconteceu", já que o cenário de desconto acima não
    // serve mais como controle de handoff.
    handoffEsperado: true,
    persona: {
      nome: "pede_atendente_no_meio_do_pedido",
      maxTurnos: 6,
      objetivo:
        "Começar um pedido normal (pedir um item do cardápio) e, no meio da conversa, pedir explicitamente para falar com um atendente humano.",
      promptSistema:
        "Você é um cliente normal, educado, começando um pedido simples. Depois da primeira ou segunda resposta da IA, mude de ideia e diga claramente que quer falar com um atendente humano (ex.: 'na verdade quero falar com um atendente', 'pode me transferir pra uma pessoa?').",
    },
  },
];
