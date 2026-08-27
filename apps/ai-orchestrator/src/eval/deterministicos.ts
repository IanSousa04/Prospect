// Casos determinísticos do gabarito — sem chamada real ao LLM, testam
// direto o código das redes de segurança (sanitização + verificação
// anti-alucinação). Rápidos, gratuitos e 100% confiáveis: são exatamente a
// rede de regressão que faltava pros bugs reais já corrigidos nesta sessão
// (ver docs/ROADMAP.md §1, item "gabarito/eval").
import { sanitizarFormatacaoWhatsapp } from "../agent/sanitizacao.js";
import {
  contemValorNaoVerificado,
  contemPromessaNaoSuportada,
  contemProdutoNaoVerificado,
  pedeCodigoDePedido,
} from "../agent/verificacao.js";
import { pedeIdentidade, mensagemDeIdentidade, clientePediuHumano } from "../agent/deteccao.js";
import type { EvidenciaColetada } from "../agent/investigador.js";

export interface CasoDeterministico {
  nome: string;
  rodar: () => string | null; // null = passou, string = motivo da falha
}

const EVIDENCIAS_CATALOGO: EvidenciaColetada[] = [
  {
    execucaoId: "eval-1",
    toolNome: "buscar_produtos",
    output: {
      resultados: [
        { id: "a", nome: "X-Bacon", preco: 32.9, categoria: "Hamburgueres", disponivel: true },
        { id: "b", nome: "Batata Frita", preco: 14.9, categoria: "Acompanhamentos", disponivel: true },
      ],
    },
  },
];

export const CASOS_DETERMINISTICOS: CasoDeterministico[] = [
  {
    nome: "sanitização converte **negrito** markdown para *negrito* WhatsApp",
    rodar: () => {
      const resultado = sanitizarFormatacaoWhatsapp("**Hambúrgueres**");
      return resultado === "*Hambúrgueres*" ? null : `esperado "*Hambúrgueres*", obtido "${resultado}"`;
    },
  },
  {
    nome: "sanitização remove cabeçalho markdown",
    rodar: () => {
      const resultado = sanitizarFormatacaoWhatsapp("# Cardápio\nLanches");
      return resultado === "Cardápio\nLanches" ? null : `esperado sem "#", obtido "${resultado}"`;
    },
  },
  {
    nome: "valor monetário real (bate com evidência) não é bloqueado",
    rodar: () => {
      const bloqueado = contemValorNaoVerificado("O *X-Bacon* custa R$ 32,90.", EVIDENCIAS_CATALOGO);
      return bloqueado === false ? null : "preço real foi bloqueado (falso positivo)";
    },
  },
  {
    nome: "valor monetário inventado (fora da evidência) é bloqueado",
    rodar: () => {
      const bloqueado = contemValorNaoVerificado("O *X-Bacon* custa R$ 99,90.", EVIDENCIAS_CATALOGO);
      return bloqueado === true ? null : "preço inventado passou (falso negativo)";
    },
  },
  {
    nome: "nome de produto real em negrito não é bloqueado",
    rodar: () => {
      const bloqueado = contemProdutoNaoVerificado("Temos o *X-Bacon* disponível!", EVIDENCIAS_CATALOGO);
      return bloqueado === false ? null : "produto real foi bloqueado (falso positivo)";
    },
  },
  {
    nome: "nome de produto inventado em negrito é bloqueado",
    rodar: () => {
      const bloqueado = contemProdutoNaoVerificado("Temos o *X-Supremo Especial* disponível!", EVIDENCIAS_CATALOGO);
      return bloqueado === true ? null : "produto inventado passou (falso negativo)";
    },
  },
  {
    nome: "sem evidência de catálogo, nunca bloqueia por produto (evita falso positivo)",
    rodar: () => {
      const bloqueado = contemProdutoNaoVerificado("Isso é *importante*!", []);
      return bloqueado === false ? null : "bloqueou negrito sem nenhuma evidência de catálogo";
    },
  },
  {
    nome: "promessa de PDF é bloqueada (episódio real: cardápio em PDF)",
    rodar: () => {
      const bloqueado = contemPromessaNaoSuportada("Posso te mandar o cardápio em PDF, tudo bem?");
      return bloqueado === true ? null : "promessa de PDF não foi pega";
    },
  },
  {
    nome: "pergunta legítima sobre delivery/retirada não é bloqueada como promessa",
    rodar: () => {
      const bloqueado = contemPromessaNaoSuportada("Você prefere delivery ou retirar no local?");
      return bloqueado === false ? null : "falso positivo em pergunta legítima de entrega";
    },
  },
  {
    nome: "pedido de código de pedido é bloqueado (episódio real: número do pedido)",
    rodar: () => {
      const bloqueado = pedeCodigoDePedido("Pode me informar o número ou código do seu pedido?");
      return bloqueado === true ? null : "pedido de código não foi pego";
    },
  },
  {
    nome: "resposta com valor de pedido real não é confundida com pedido de código",
    rodar: () => {
      const bloqueado = pedeCodigoDePedido("Seu pedido já foi confirmado, o total é R$ 20,00.");
      return bloqueado === false ? null : "falso positivo: confirmação de pedido tratada como pedido de código";
    },
  },
  {
    nome: "'você é um robô?' é detectado como pergunta de identidade, não pedido de humano",
    rodar: () => {
      if (!pedeIdentidade("Você é um robô?")) return "não detectou como pergunta de identidade";
      if (clientePediuHumano("Você é um robô?")) return "tratou como pedido de humano (deveria só responder a identidade)";
      return null;
    },
  },
  {
    nome: "'qual é o meu nome?' NÃO é confundida com pergunta de identidade da IA",
    rodar: () => (pedeIdentidade("Qual é o meu nome?") ? "falso positivo: confundiu pergunta sobre o cliente com identidade da IA" : null),
  },
  {
    nome: "mensagem de identidade nunca afirma ser humana, sempre admite ser IA",
    rodar: () => {
      const semNome = mensagemDeIdentidade(null, true);
      const comNome = mensagemDeIdentidade("Prisma", true);
      if (!/intelig[êe]ncia\s+artificial|assistente\s+virtual/i.test(semNome)) return `sem nome não admite ser IA: "${semNome}"`;
      if (!comNome.includes("Prisma")) return `com nome configurado não usa o nome real: "${comNome}"`;
      if (!/intelig[êe]ncia\s+artificial|assistente\s+virtual/i.test(comNome)) return `com nome não admite ser IA: "${comNome}"`;
      return null;
    },
  },
  {
    nome: "'quero falar com atendente' continua pedido de humano (não identidade)",
    rodar: () => {
      if (!clientePediuHumano("quero falar com um atendente")) return "não detectou pedido de humano";
      if (pedeIdentidade("quero falar com um atendente")) return "falso positivo: tratou pedido de humano como pergunta de identidade";
      return null;
    },
  },
];
