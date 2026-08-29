// Gabarito do workflow transacional determinístico (tarefa 0081) — roda sem
// banco, sem LLM e sem rede: o workflow inteiro recebe suas dependências por
// injeção (`PortasDoWorkflow`, agent/checkout/transicoes.ts), então dá pra
// exercitar a máquina de estados, as mutações obrigatórias, a idempotência e
// o TransactionTruthGate de ponta a ponta em milissegundos.
//
// Cobre os 7 cenários exigidos na especificação da tarefa (Luiza, Barbara,
// confirmação incompleta, falha de ferramenta, confirmação falsa, "tudo
// certo" fora do checkout, confirmação repetida) e mais a máquina de estados
// isolada.
//
// Importante: a validação de `criar_pedido` NÃO é reimplementada aqui — o
// executor falso chama `validarPreRequisitosDeCriacao`, exatamente a mesma
// função pura que a tool real usa em produção. O que é simulado é só a
// persistência.
import type { AguardandoConfirmacao, FluxoPedidoConfig, UltimoPedidoCriado } from "@prospect/shared";
import {
  FLUXO_PEDIDO_CONFIG_PADRAO,
  calcularHashConfirmacao,
  checkoutEhTransacional,
  derivarEstadoCheckout,
  informacoesPendentes,
  pedidoVazio,
  resumoPedidoIa,
} from "@prospect/shared";
import type { PortasDoWorkflow } from "../agent/checkout/transicoes.js";
import { aplicarIntencao, decidirMutacoes, sincronizarConfirmacaoPendente } from "../agent/checkout/transicoes.js";
import {
  INTENCAO_VAZIA,
  intencaoDeterministica,
  normalizarIntencao,
  type IntencaoDaMensagem,
} from "../agent/interpretacao/mensagem.js";
import { validarPreRequisitosDeCriacao } from "../agent/checkout/validacao-criacao.js";
import { montarFatosVerificados, fatosParaAfirmacoes, mensagemDeterministicaDeFallback } from "../agent/checkout/fatos.js";
import { avaliarRespostaTransacional } from "../agent/checkout/truth-gate.js";
import { afirmaCancelamentoRealizado, afirmaHandoffRealizado, afirmaPedidoConfirmado } from "../agent/verificacao.js";
import type { EvidenciaColetada } from "../agent/investigador.js";
import type { CasoDeterministico } from "./deterministicos.js";
import {
  CTX_FALSO,
  chatFalso,
  confirmacaoValidaPara,
  criarMundo,
  criarPortas,
  item,
  pedidoProntoPraFechar,
} from "./mundo-falso.js";

function intencao(parcial: Partial<IntencaoDaMensagem>): IntencaoDaMensagem {
  return { ...INTENCAO_VAZIA, ...parcial };
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

export const CASOS_CHECKOUT: CasoDeterministico[] = [
  // ======================= MÁQUINA DE ESTADOS =======================
  {
    nome: "derivarEstadoCheckout: carrinho vazio e sem pedido criado é 'sem_carrinho' (não transacional)",
    rodar: () => {
      const estado = derivarEstadoCheckout(pedidoVazio(), null, null);
      if (estado !== "sem_carrinho") return `esperado "sem_carrinho", obtido "${estado}"`;
      return checkoutEhTransacional(estado) ? "estado sem carrinho não pode ser transacional" : null;
    },
  },
  {
    nome: "derivarEstadoCheckout: carrinho com item e dados faltando é 'montando_carrinho'",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] };
      const estado = derivarEstadoCheckout(pedido, null, null);
      if (estado !== "montando_carrinho") return `esperado "montando_carrinho", obtido "${estado}"`;
      return checkoutEhTransacional(estado) ? null : "montando_carrinho precisa ser transacional";
    },
  },
  {
    nome: "derivarEstadoCheckout: tudo definido mas sem resumo apresentado é 'dados_completos' (nunca já aguardando confirmação)",
    rodar: () => {
      const estado = derivarEstadoCheckout(pedidoProntoPraFechar(), null, null);
      return estado === "dados_completos" ? null : `esperado "dados_completos", obtido "${estado}"`;
    },
  },
  {
    nome: "derivarEstadoCheckout: com resumo apresentado e hash batendo é 'aguardando_confirmacao'",
    rodar: () => {
      const pedido = pedidoProntoPraFechar();
      const estado = derivarEstadoCheckout(pedido, confirmacaoValidaPara(pedido), null);
      return estado === "aguardando_confirmacao" ? null : `esperado "aguardando_confirmacao", obtido "${estado}"`;
    },
  },
  {
    nome: "derivarEstadoCheckout: carrinho que mudou depois do resumo volta pra 'dados_completos' (confirmação antiga não vale)",
    rodar: () => {
      const pedidoOriginal = pedidoProntoPraFechar();
      const confirmacao = confirmacaoValidaPara(pedidoOriginal);
      const pedidoAlterado = { ...pedidoOriginal, itens: [item("X-Bacon", 32.9, 3)] };
      const estado = derivarEstadoCheckout(pedidoAlterado, confirmacao, null);
      return estado === "dados_completos" ? null : `esperado "dados_completos" (hash não bate), obtido "${estado}"`;
    },
  },
  {
    nome: "derivarEstadoCheckout: confirmação expirada não conta como resumo pendente",
    rodar: () => {
      const pedido = pedidoProntoPraFechar();
      const expirada: AguardandoConfirmacao = {
        hash: calcularHashConfirmacao(pedido),
        expiraEm: new Date(Date.now() - 60_000).toISOString(),
        resumoTexto: "antigo",
      };
      const estado = derivarEstadoCheckout(pedido, expirada, null);
      return estado === "dados_completos" ? null : `esperado "dados_completos" (expirou), obtido "${estado}"`;
    },
  },
  {
    nome: "derivarEstadoCheckout: carrinho resetado logo após criar o pedido continua 'pedido_criado' (evidência sobrevive ao reset)",
    rodar: () => {
      const ultimo: UltimoPedidoCriado = { pedido_id: "pedido-1", hash: "abc", criado_em: new Date().toISOString() };
      const estado = derivarEstadoCheckout(pedidoVazio(), null, ultimo);
      return estado === "pedido_criado" ? null : `esperado "pedido_criado", obtido "${estado}"`;
    },
  },
  {
    nome: "derivarEstadoCheckout: pedido criado há muito tempo não segura mais o estado (janela de idempotência expira)",
    rodar: () => {
      const antigo: UltimoPedidoCriado = {
        pedido_id: "pedido-1",
        hash: "abc",
        criado_em: new Date(Date.now() - 120 * 60_000).toISOString(),
      };
      const estado = derivarEstadoCheckout(pedidoVazio(), null, antigo);
      return estado === "sem_carrinho" ? null : `esperado "sem_carrinho", obtido "${estado}"`;
    },
  },
  {
    nome: "a etapa morta 'confirmar_carrinho' não existe mais — carrinho com dados completos chega em confirmacao_final sem nenhum passo intermediário",
    rodar: () => {
      const pendencias = informacoesPendentes(pedidoProntoPraFechar());
      return pendencias.length === 1 && pendencias[0] === "confirmacao_final"
        ? null
        : `esperado só ["confirmacao_final"], obtido ${JSON.stringify(pendencias)}`;
    },
  },

  // ======================= DECISÃO DE MUTAÇÕES =======================
  {
    nome: "decidirMutacoes: dado identificado na mensagem SEMPRE vira mutação obrigatória (nunca depende do LLM lembrar de chamar a tool)",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("Batata Frita", 14.9)] };
      const { mutacoes } = decidirMutacoes(
        pedido,
        intencao({ tipo_entrega: "entrega", forma_pagamento: "cartao_credito" }),
        FLUXO_PEDIDO_CONFIG_PADRAO,
      );
      const tools = mutacoes.map((m) => m.tool);
      return tools.includes("definir_tipo_entrega") && tools.includes("definir_forma_pagamento")
        ? null
        : `esperado as duas mutações, obtido ${JSON.stringify(tools)}`;
    },
  },
  {
    nome: "decidirMutacoes: repetir um valor idêntico ao que já está salvo não gera mutação (mutação à toa invalidaria a confirmação)",
    rodar: () => {
      const pedido = { ...pedidoProntoPraFechar(), carrinho_confirmado: true };
      const { mutacoes } = decidirMutacoes(
        pedido,
        intencao({ tipo_entrega: "entrega", forma_pagamento: "cartao_credito" }),
        FLUXO_PEDIDO_CONFIG_PADRAO,
      );
      return mutacoes.length === 0 ? null : `nenhuma mutação esperada, obtido ${JSON.stringify(mutacoes.map((m) => m.tool))}`;
    },
  },
  {
    nome: "decidirMutacoes: endereço incompleto nunca é gravado — vira dado não aproveitado pra IA pedir o que falta",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] };
      const { mutacoes, dadosNaoAproveitados } = decidirMutacoes(
        pedido,
        intencao({ tipo_entrega: "entrega", endereco: { rua: "Rua X" } }),
        FLUXO_PEDIDO_CONFIG_PADRAO,
      );
      if (mutacoes.some((m) => m.tool === "definir_endereco_entrega")) return "gravou um endereço incompleto";
      return dadosNaoAproveitados.includes("endereco_incompleto") ? null : "não sinalizou endereco_incompleto";
    },
  },
  {
    nome: "decidirMutacoes: endereço informado junto de 'retirada' é ignorado, nunca gravado",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] };
      const { mutacoes, dadosNaoAproveitados } = decidirMutacoes(
        pedido,
        intencao({
          tipo_entrega: "retirada",
          endereco: { rua: "Rua X", numero: "1", bairro: "Centro", cidade: "SP" },
        }),
        FLUXO_PEDIDO_CONFIG_PADRAO,
      );
      if (mutacoes.some((m) => m.tool === "definir_endereco_entrega")) return "gravou endereço num pedido de retirada";
      return dadosNaoAproveitados.includes("endereco_ignorado_em_retirada") ? null : "não sinalizou o endereço ignorado";
    },
  },
  {
    nome: "decidirMutacoes: carrinho vazio não configura entrega/pagamento (a pergunta certa ainda é o que o cliente quer)",
    rodar: () => {
      const { mutacoes } = decidirMutacoes(
        pedidoVazio(),
        intencao({ tipo_entrega: "entrega", forma_pagamento: "pix" }),
        FLUXO_PEDIDO_CONFIG_PADRAO,
      );
      return mutacoes.length === 0 ? null : `nenhuma mutação esperada num carrinho vazio, obtido ${mutacoes.length}`;
    },
  },
  {
    nome: "normalizarIntencao: valor fora do que a empresa oferece é descartado, nunca vira mutação",
    rodar: () => {
      const config: FluxoPedidoConfig = {
        tipos_entrega_oferecidos: ["retirada"],
        perguntar_forma_pagamento: true,
        formas_pagamento_aceitas: ["dinheiro"],
      };
      const resultado = normalizarIntencao({ tipo_entrega: "entrega", forma_pagamento: "pix" }, config);
      if (resultado.tipo_entrega !== null) return "aceitou tipo de entrega que a empresa não oferece";
      return resultado.forma_pagamento === null ? null : "aceitou forma de pagamento que a empresa não aceita";
    },
  },
  {
    nome: "normalizarIntencao: enum inventado pelo modelo vira null (nunca chega ao banco)",
    rodar: () => {
      const resultado = normalizarIntencao(
        { confirmacao: "talvez", tipo_entrega: "drone", forma_pagamento: "bitcoin" },
        FLUXO_PEDIDO_CONFIG_PADRAO,
      );
      if (resultado.confirmacao !== "nenhuma") return `confirmação inválida virou "${resultado.confirmacao}"`;
      return resultado.tipo_entrega === null && resultado.forma_pagamento === null
        ? null
        : "valor fora do domínio passou pela normalização";
    },
  },

  // ======================= TESTE 1 — LUIZA =======================
  {
    nome: 'TESTE 1 (Luiza): "Tudo certo" após o resumo é confirmação transacional, nunca conversa social',
    rodar: () => {
      const reconhecida = intencaoDeterministica("Tudo certo");
      if (!reconhecida) return '"Tudo certo" não foi reconhecida como intenção nenhuma';
      return reconhecida.confirmacao === "confirma" ? null : `esperado "confirma", obtido "${reconhecida.confirmacao}"`;
    },
  },
  {
    nome: 'TESTE 1 (Luiza): resumo apresentado + "Tudo certo" cria o pedido de verdade e devolve pedido_id',
    rodar: async () => {
      const pedido = pedidoProntoPraFechar();
      const mundo = criarMundo(pedido, confirmacaoValidaPara(pedido));
      const portas = criarPortas(mundo);

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ confirmacao: "confirma" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      if (resultado.estadoInicial !== "aguardando_confirmacao") return `estado inicial errado: ${resultado.estadoInicial}`;
      if (!resultado.confirmacaoRecebida) return "confirmação válida não foi reconhecida";
      if (!resultado.pedidoCriadoAgora?.pedido_id) return "nenhum pedido_id foi devolvido";
      if (!mundo.chamadas.some((c) => c.tool === "criar_pedido")) return "criar_pedido nunca foi executada";
      if (mundo.pedidosCriados.length !== 1) return `esperado 1 pedido criado, obtido ${mundo.pedidosCriados.length}`;
      if (resultado.estadoFinal !== "pedido_criado") return `estado final errado: ${resultado.estadoFinal}`;
      return null;
    },
  },
  {
    nome: "TESTE 1 (Luiza): a confirmação é PERSISTIDA no estado antes de criar — criar_pedido nunca roda sobre uma confirmação só em memória",
    rodar: async () => {
      const pedido = pedidoProntoPraFechar();
      const mundo = criarMundo(pedido, confirmacaoValidaPara(pedido));
      // Bloqueia a criação pra poder inspecionar o estado logo antes dela.
      const portas = criarPortas(mundo, { bloqueioDeRisco: { motivo: "empresa_exige_confirmacao_humana", total: 32.9 } });

      await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ confirmacao: "confirma" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      return mundo.pedido.carrinho_confirmado ? null : "carrinho_confirmado não foi gravado antes da criação";
    },
  },

  // ======================= TESTE 2 — BARBARA =======================
  {
    nome: 'TESTE 2 (Barbara): "Entrega / Cartão de crédito" EXECUTA as duas mutações — nunca só responde que registrou',
    rodar: async () => {
      const mundo = criarMundo({ ...pedidoVazio(), itens: [item("Batata Frita", 14.9)] });
      const portas = criarPortas(mundo);

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ tipo_entrega: "entrega", forma_pagamento: "cartao_credito" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      const tools = mundo.chamadas.map((c) => c.tool);
      if (!tools.includes("definir_tipo_entrega")) return "definir_tipo_entrega não foi executada";
      if (!tools.includes("definir_forma_pagamento")) return "definir_forma_pagamento não foi executada";
      // E o estado RELIDO precisa refletir as mutações (MUTATE → READ → VALIDATE).
      if (resultado.pedido.tipo_entrega !== "entrega") return "estado relido não tem o tipo de entrega";
      if (resultado.pedido.forma_pagamento !== "cartao_credito") return "estado relido não tem a forma de pagamento";
      if (resultado.falhas.length > 0) return `falhas inesperadas: ${JSON.stringify(resultado.falhas)}`;
      return null;
    },
  },
  {
    nome: "TESTE 2 (Barbara): faltando só o endereço, o workflow não confirma nada e reporta a pendência real",
    rodar: async () => {
      const mundo = criarMundo({ ...pedidoVazio(), itens: [item("Batata Frita", 14.9)] });
      const portas = criarPortas(mundo);

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ tipo_entrega: "entrega", forma_pagamento: "cartao_credito" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      if (resultado.pedidoCriadoAgora) return "criou pedido sem endereço";
      return resultado.pendencias.includes("endereco") ? null : `pendência de endereço sumiu: ${JSON.stringify(resultado.pendencias)}`;
    },
  },

  // ======================= TESTE 3 — CONFIRMAÇÃO INCOMPLETA =======================
  {
    nome: "TESTE 3: confirmação com dados incompletos não cria pedido, não faz handoff e mantém as pendências",
    rodar: async () => {
      const mundo = criarMundo({
        ...pedidoVazio(),
        itens: [item("X-Bacon", 32.9)],
        tipo_entrega: "retirada",
      });
      const portas = criarPortas(mundo);

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ confirmacao: "confirma" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      if (resultado.pedidoCriadoAgora) return "criou pedido sem forma de pagamento";
      if (resultado.confirmacaoRecebida) return "tratou como confirmação válida algo que não tinha resumo pendente";
      if (mundo.chamadas.some((c) => c.tool === "criar_pedido")) return "chamou criar_pedido fora da etapa de confirmação";
      if (resultado.bloqueioDeRisco) return "gerou bloqueio de risco onde não havia risco nenhum";
      return resultado.pendencias.includes("forma_pagamento") ? null : "não reportou a forma de pagamento pendente";
    },
  },
  {
    nome: "TESTE 3: os fatos verificados dizem exatamente o que falta, sem nunca afirmar criação",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)], tipo_entrega: "retirada" as const };
      const fatos = montarFatosVerificados({
        estado: "montando_carrinho",
        pedido,
        pendencias: informacoesPendentes(pedido),
      });
      if (fatos.pedido_criado || fatos.pedido_id !== null) return "fatos afirmam um pedido que não existe";
      const texto = mensagemDeterministicaDeFallback(fatos, false);
      if (afirmaPedidoConfirmado(texto)) return `mensagem de fallback afirma confirmação: "${texto}"`;
      return /forma de pagamento/i.test(texto) ? null : `fallback não pede o que falta: "${texto}"`;
    },
  },

  // ======================= TESTE 4 — FALHA DE FERRAMENTA =======================
  {
    nome: "TESTE 4: quando definir_forma_pagamento falha, nada é confirmado, nada é criado e o estado não ganha o pagamento",
    rodar: async () => {
      const mundo = criarMundo({
        ...pedidoVazio(),
        itens: [item("X-Bacon", 32.9)],
        tipo_entrega: "retirada",
      });
      const portas = criarPortas(mundo, { erros: { definir_forma_pagamento: "forma_pagamento_nao_aceita" } });

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ forma_pagamento: "pix", confirmacao: "confirma" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      if (mundo.pedido.forma_pagamento !== null) return "estado ganhou uma forma de pagamento que a tool recusou";
      if (resultado.pedidoCriadoAgora) return "criou pedido depois de uma ferramenta falhar";
      if (mundo.chamadas.some((c) => c.tool === "criar_pedido")) return "tentou criar pedido depois da falha";
      return resultado.falhas.some((f) => f.tool === "definir_forma_pagamento") ? null : "a falha não foi registrada";
    },
  },
  {
    nome: "TESTE 4: os fatos verificados nunca dizem que o pagamento foi registrado quando a ferramenta falhou",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)], tipo_entrega: "retirada" as const };
      const evidencias: EvidenciaColetada[] = [
        { execucaoId: "e1", toolNome: "consultar_carrinho", output: resumoPedidoIa(pedido) },
      ];
      const fatos = montarFatosVerificados({
        estado: "montando_carrinho",
        pedido,
        pendencias: informacoesPendentes(pedido),
        falhas: [{ tool: "definir_forma_pagamento", erro: "forma_pagamento_nao_aceita" }],
      });
      const afirmacoes = fatosParaAfirmacoes(fatos, evidencias);
      if (afirmacoes.some((a) => /forma de pagamento já registrada/i.test(a.texto))) {
        return "afirmou pagamento registrado mesmo com a ferramenta tendo falhado";
      }
      return afirmacoes.some((a) => /não foi possível concluir/i.test(a.texto)) ? null : "não relatou a falha ao Atendente";
    },
  },

  {
    nome: "MUTATE→READ→VALIDATE: ferramenta que reporta sucesso sem mudar o estado real vira falha + invariante",
    rodar: async () => {
      const mundo = criarMundo({ ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] });
      const portas = criarPortas(mundo);
      // Executor que confirma sucesso mas não encosta no estado — é
      // exatamente o "tool_success_without_state_change" da especificação.
      const portasMentirosas: PortasDoWorkflow = {
        ...portas,
        executar: async (nome, input) => {
          mundo.chamadas.push({ tool: nome, input });
          return { sucesso: true, output: { ok: true }, execucaoId: `exec-${++mundo.sequencia}` };
        },
      };

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ tipo_entrega: "entrega" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas: portasMentirosas,
      });

      if (!resultado.falhas.some((f) => f.erro === "estado_nao_mudou")) {
        return "sucesso reportado sem efeito real passou como se tivesse funcionado";
      }
      return mundo.invariantes.some((i) => i.evento === "tool_success_without_state_change")
        ? null
        : "invariante tool_success_without_state_change não foi registrada";
    },
  },
  {
    nome: "MUTATE→READ→VALIDATE: o valor gravado precisa ser o pretendido, não só 'campo não nulo'",
    rodar: async () => {
      const mundo = criarMundo({ ...pedidoVazio(), itens: [item("X-Bacon", 32.9)], tipo_entrega: "retirada" });
      const portas = criarPortas(mundo);
      const portasQueIgnoram: PortasDoWorkflow = {
        ...portas,
        executar: async (nome, input) => {
          mundo.chamadas.push({ tool: nome, input });
          return { sucesso: true, output: { ok: true }, execucaoId: `exec-${++mundo.sequencia}` };
        },
      };

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ tipo_entrega: "entrega" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas: portasQueIgnoram,
      });

      // O campo continua preenchido ("retirada"), mas com o valor ERRADO.
      return resultado.falhas.some((f) => f.erro === "estado_nao_mudou")
        ? null
        : "campo preenchido com o valor errado passou pela validação";
    },
  },

  // ======================= TESTE 5 — CONFIRMAÇÃO FALSA =======================
  {
    nome: 'TESTE 5: TransactionTruthGate bloqueia "Fechado! Seu pedido já está com a gente." sem pedido_id',
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "aguardando_confirmacao",
        pedido: pedidoProntoPraFechar(),
        pendencias: ["confirmacao_final"],
      });
      const veredicto = await avaliarRespostaTransacional({
        texto: "Fechado! Seu pedido já está com a gente.",
        fatos,
        chat: chatFalso('{"classificacao":"NON_TRANSACTIONAL"}'),
      });
      if (veredicto.aprovado) return "afirmação sem evidência passou pelo gate";
      if (veredicto.detectadoPor !== "regex") return `esperado bloqueio por regex, obtido "${veredicto.detectadoPor}"`;
      return veredicto.motivo === "pedido_sem_evidencia" ? null : `motivo errado: ${veredicto.motivo}`;
    },
  },
  {
    nome: "TESTE 5: afirmação que a regex NÃO prevê ainda é bloqueada pelo classificador semântico (regex deixou de ser a única barreira)",
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "aguardando_confirmacao",
        pedido: pedidoProntoPraFechar(),
        pendencias: ["confirmacao_final"],
      });
      const texto = "Prontinho, deixei tudo acertado por aqui e a equipe já assumiu daqui pra frente.";
      if (afirmaPedidoConfirmado(texto)) return "cenário inválido: a regex já pegava essa frase";
      const veredicto = await avaliarRespostaTransacional({
        texto,
        fatos,
        chat: chatFalso('{"classificacao":"TRANSACTIONAL_CLAIM"}'),
      });
      if (veredicto.aprovado) return "classificador semântico não bloqueou a afirmação";
      return veredicto.detectadoPor === "classificador" ? null : `esperado bloqueio por classificador, obtido "${veredicto.detectadoPor}"`;
    },
  },
  {
    nome: "TESTE 5: com pedido_id real, a mesma afirmação passa (o gate valida evidência, não vocabulário)",
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "pedido_criado",
        pedido: pedidoVazio(),
        pendencias: ["produtos"],
        pedidoId: "pedido-1",
      });
      const veredicto = await avaliarRespostaTransacional({
        texto: "Pedido confirmado! Já vai pra cozinha.",
        fatos,
        chat: chatFalso('{"classificacao":"TRANSACTIONAL_CLAIM"}'),
      });
      return veredicto.aprovado ? null : "bloqueou uma afirmação verdadeira, com pedido real criado";
    },
  },
  {
    nome: "TESTE 5: pergunta legítima de confirmação ('posso fechar assim?') nunca é bloqueada",
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "aguardando_confirmacao",
        pedido: pedidoProntoPraFechar(),
        pendencias: ["confirmacao_final"],
      });
      const veredicto = await avaliarRespostaTransacional({
        texto: "Ficou 1x X-Bacon, entrega no seu endereço, no cartão de crédito. Posso fechar assim?",
        fatos,
        chat: chatFalso('{"classificacao":"NON_TRANSACTIONAL"}'),
      });
      return veredicto.aprovado ? null : "bloqueou o fluxo legítimo de pedir confirmação";
    },
  },
  {
    nome: "TESTE 5: afirmar que um humano foi acionado sem handoff_id é bloqueado",
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "montando_carrinho",
        pedido: { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] },
        pendencias: ["tipo_entrega"],
      });
      const veredicto = await avaliarRespostaTransacional({
        texto: "Já avisei um atendente humano, ele te responde já já.",
        fatos,
        chat: chatFalso('{"classificacao":"NON_TRANSACTIONAL"}'),
      });
      if (veredicto.aprovado) return "afirmação de handoff sem evidência passou";
      return veredicto.motivo === "handoff_sem_evidencia" ? null : `motivo errado: ${veredicto.motivo}`;
    },
  },

  {
    nome: "afirmar cancelamento é SEMPRE bloqueado — a IA não tem ferramenta de cancelamento, então não existe evidência possível",
    rodar: async () => {
      const fatos = montarFatosVerificados({
        estado: "pedido_criado",
        pedido: pedidoVazio(),
        pendencias: ["produtos"],
        pedidoId: "pedido-1",
      });
      const veredicto = await avaliarRespostaTransacional({
        texto: "Pronto, cancelei seu pedido!",
        fatos,
        chat: chatFalso('{"classificacao":"NON_TRANSACTIONAL"}'),
      });
      if (veredicto.aprovado) return "afirmação de cancelamento passou mesmo sem a IA poder cancelar";
      return veredicto.motivo === "cancelamento_inexistente" ? null : `motivo errado: ${veredicto.motivo}`;
    },
  },
  {
    nome: "dizer honestamente que NÃO consegue cancelar nunca é bloqueado",
    rodar: () => {
      const honestas = [
        "Não consigo cancelar o pedido por aqui, vou passar pra equipe.",
        "Quer que eu peça o cancelamento pra equipe?",
      ];
      const falsos = honestas.filter((f) => afirmaCancelamentoRealizado(f));
      return falsos.length === 0 ? null : `falso positivo em: ${JSON.stringify(falsos)}`;
    },
  },

  // ======================= TESTE 6 — FORA DO CHECKOUT =======================
  {
    nome: 'TESTE 6: "Tudo certo" fora do checkout continua sendo conversa social (nenhum ramo transacional roda)',
    rodar: () => {
      const estado = derivarEstadoCheckout(pedidoVazio(), null, null);
      if (checkoutEhTransacional(estado)) return "estado sem carrinho foi classificado como transacional";
      // A intenção até é reconhecida no texto — o que impede a ação é o
      // ESTADO, não o vocabulário (é exatamente essa a inversão da tarefa).
      return intencaoDeterministica("Tudo certo")?.confirmacao === "confirma"
        ? null
        : "o reconhecimento de texto deveria continuar funcionando; quem barra é o estado";
    },
  },
  {
    nome: 'TESTE 6: "Tudo certo" com carrinho vazio nunca cria pedido nenhum',
    rodar: async () => {
      const mundo = criarMundo(pedidoVazio());
      const portas = criarPortas(mundo);

      const resultado = await aplicarIntencao({
        ctx: CTX_FALSO,
        intencao: intencao({ confirmacao: "confirma" }),
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
        portas,
      });

      if (resultado.pedidoCriadoAgora) return "criou pedido a partir de um carrinho vazio";
      return mundo.pedidosCriados.length === 0 ? null : "algum pedido foi criado sem carrinho";
    },
  },

  // ======================= TESTE 7 — IDEMPOTÊNCIA =======================
  {
    nome: "TESTE 7: três confirmações seguidas criam exatamente UM pedido",
    rodar: async () => {
      const pedido = pedidoProntoPraFechar();
      const mundo = criarMundo(pedido, confirmacaoValidaPara(pedido));
      const portas = criarPortas(mundo);
      const confirma = intencao({ confirmacao: "confirma" });

      const primeira = await aplicarIntencao({ ctx: CTX_FALSO, intencao: confirma, config: FLUXO_PEDIDO_CONFIG_PADRAO, portas });
      const segunda = await aplicarIntencao({ ctx: CTX_FALSO, intencao: confirma, config: FLUXO_PEDIDO_CONFIG_PADRAO, portas });
      const terceira = await aplicarIntencao({ ctx: CTX_FALSO, intencao: confirma, config: FLUXO_PEDIDO_CONFIG_PADRAO, portas });

      if (!primeira.pedidoCriadoAgora) return "a primeira confirmação não criou o pedido";
      if (mundo.pedidosCriados.length !== 1) return `esperado 1 pedido, obtido ${mundo.pedidosCriados.length}`;
      if (segunda.pedidoCriadoAgora || terceira.pedidoCriadoAgora) return "uma confirmação repetida voltou a criar pedido";
      if (segunda.estadoFinal !== "pedido_criado") return `estado após repetição errado: ${segunda.estadoFinal}`;
      return null;
    },
  },
  {
    nome: "TESTE 7: mesmo chamando criar_pedido de novo com o mesmo carrinho, a validação devolve o pedido existente em vez de criar outro",
    rodar: () => {
      const pedido = { ...pedidoProntoPraFechar(), carrinho_confirmado: true };
      const ultimo: UltimoPedidoCriado = {
        pedido_id: "pedido-1",
        hash: calcularHashConfirmacao(pedido),
        criado_em: new Date().toISOString(),
      };
      const resultado = validarPreRequisitosDeCriacao({
        pedido,
        confirmacao: confirmacaoValidaPara(pedido),
        ultimoPedidoCriado: ultimo,
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
      });
      if (resultado.situacao !== "ja_criado") return `esperado "ja_criado", obtido "${resultado.situacao}"`;
      return resultado.pedido_id === "pedido-1" ? null : "devolveu um pedido_id diferente do existente";
    },
  },

  // ======================= VALIDAÇÃO DE BACKEND =======================
  {
    nome: "criar_pedido recusa quando a confirmação não está persistida no estado, mesmo com resumo pendente válido",
    rodar: () => {
      const pedido = pedidoProntoPraFechar(); // carrinho_confirmado: false
      const resultado = validarPreRequisitosDeCriacao({
        pedido,
        confirmacao: confirmacaoValidaPara(pedido),
        ultimoPedidoCriado: null,
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
      });
      if (resultado.situacao !== "recusado") return `esperado recusa, obtido "${resultado.situacao}"`;
      return resultado.motivo === "confirmacao_nao_registrada" ? null : `motivo errado: ${resultado.motivo}`;
    },
  },
  {
    nome: "criar_pedido recusa quando o carrinho mudou depois do resumo confirmado (hash não bate mais)",
    rodar: () => {
      const original = pedidoProntoPraFechar();
      const confirmacao = confirmacaoValidaPara(original);
      const alterado = { ...original, carrinho_confirmado: true, itens: [item("X-Bacon", 32.9, 5)] };
      const resultado = validarPreRequisitosDeCriacao({
        pedido: alterado,
        confirmacao,
        ultimoPedidoCriado: null,
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
      });
      if (resultado.situacao !== "recusado") return `esperado recusa, obtido "${resultado.situacao}"`;
      return resultado.motivo === "confirmacao_expirada_ou_invalida" ? null : `motivo errado: ${resultado.motivo}`;
    },
  },
  {
    nome: "criar_pedido recusa por pedido incompleto e devolve exatamente o que falta",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)], carrinho_confirmado: true };
      const resultado = validarPreRequisitosDeCriacao({
        pedido,
        confirmacao: confirmacaoValidaPara(pedido),
        ultimoPedidoCriado: null,
        config: FLUXO_PEDIDO_CONFIG_PADRAO,
      });
      if (resultado.situacao !== "recusado") return `esperado recusa, obtido "${resultado.situacao}"`;
      if (resultado.motivo !== "pedido_incompleto") return `motivo errado: ${resultado.motivo}`;
      return resultado.pendencias?.includes("tipo_entrega") ? null : "não listou as pendências reais";
    },
  },

  // ======================= SINCRONIZAÇÃO DO RESUMO =======================
  {
    nome: "sincronizarConfirmacaoPendente: carrinho pronto passa a ter resumo aguardando confirmação (sem depender do LLM chamar nada)",
    rodar: async () => {
      const mundo = criarMundo(pedidoProntoPraFechar());
      const portas = criarPortas(mundo);
      const resultado = await sincronizarConfirmacaoPendente({ ctx: CTX_FALSO, config: FLUXO_PEDIDO_CONFIG_PADRAO, portas });

      if (!resultado.apresentouResumo) return "não registrou o resumo apresentado";
      if (resultado.estado !== "aguardando_confirmacao") return `estado errado: ${resultado.estado}`;
      return mundo.confirmacao !== null ? null : "confirmação pendente não foi persistida";
    },
  },
  {
    nome: "sincronizarConfirmacaoPendente: carrinho que deixou de estar pronto descarta o resumo antigo",
    rodar: async () => {
      const completo = pedidoProntoPraFechar();
      const mundo = criarMundo({ ...completo, forma_pagamento: null }, confirmacaoValidaPara(completo));
      const portas = criarPortas(mundo);
      const resultado = await sincronizarConfirmacaoPendente({ ctx: CTX_FALSO, config: FLUXO_PEDIDO_CONFIG_PADRAO, portas });

      if (mundo.confirmacao !== null) return "manteve um resumo pendente pra um carrinho incompleto";
      return resultado.estado === "montando_carrinho" ? null : `estado errado: ${resultado.estado}`;
    },
  },
  {
    nome: "sincronizarConfirmacaoPendente: resumo válido já existente não é recriado a cada turno",
    rodar: async () => {
      const pedido = pedidoProntoPraFechar();
      const confirmacaoOriginal = confirmacaoValidaPara(pedido);
      const mundo = criarMundo(pedido, confirmacaoOriginal);
      const portas = criarPortas(mundo);
      const resultado = await sincronizarConfirmacaoPendente({ ctx: CTX_FALSO, config: FLUXO_PEDIDO_CONFIG_PADRAO, portas });

      if (resultado.apresentouResumo) return "recriou um resumo que já estava válido";
      return mundo.confirmacao === confirmacaoOriginal ? null : "substituiu a confirmação pendente sem necessidade";
    },
  },

  // ======================= REGEX AMPLIADA (SEGUNDA BARREIRA) =======================
  {
    nome: "regex ampliada reconhece linguagem natural de pedido já finalizado (não só o vocabulário formal)",
    rodar: () => {
      const frases = [
        "Beleza, seu pedido já está com a gente.",
        "Já mandei seu pedido pra cozinha.",
        "Pode deixar que já está confirmado.",
        "Seu pedido já está na cozinha.",
        "Já foi.",
        "Já está indo.",
      ];
      const falhas = frases.filter((f) => !afirmaPedidoConfirmado(f));
      return falhas.length === 0 ? null : `não reconheceu: ${JSON.stringify(falhas)}`;
    },
  },
  {
    nome: "regex ampliada não gera falso positivo em fala legítima de carrinho em construção",
    rodar: () => {
      const frases = [
        "Já adicionei o X-Bacon no seu carrinho.",
        "Anotei aqui que é entrega.",
        "Você prefere Pix ou cartão?",
        "Posso confirmar assim?",
        "Seu carrinho está com 2 itens.",
      ];
      const falsos = frases.filter((f) => afirmaPedidoConfirmado(f));
      return falsos.length === 0 ? null : `falso positivo em: ${JSON.stringify(falsos)}`;
    },
  },
  {
    nome: "regex ampliada não bloqueia dizer o que NÃO aconteceu ('seu pedido ainda não foi fechado')",
    rodar: () => {
      const frases = [
        "Seu pedido ainda não foi fechado — falta definir a forma de pagamento.",
        "Seu pedido ainda não foi confirmado.",
        "Ainda não está sendo preparado, preciso da sua confirmação antes.",
        "Nenhum pedido foi registrado ainda.",
      ];
      const falsos = frases.filter((f) => afirmaPedidoConfirmado(f));
      return falsos.length === 0 ? null : `bloqueou frase negativa legítima: ${JSON.stringify(falsos)}`;
    },
  },
  {
    nome: "a guarda de negação não abre brecha: negação depois da alegação continua sendo afirmação",
    rodar: () => {
      return afirmaPedidoConfirmado("Seu pedido foi confirmado, não se preocupe.")
        ? null
        : "deixou passar uma afirmação real só porque a frase tinha um 'não' depois";
    },
  },
  {
    nome: "afirmaHandoffRealizado reconhece transferência afirmada, mas não a pergunta de oferecer",
    rodar: () => {
      if (!afirmaHandoffRealizado("Já chamei um atendente pra te ajudar.")) return "não reconheceu afirmação de handoff";
      if (afirmaHandoffRealizado("Quer que eu chame um atendente humano?")) return "confundiu pergunta com afirmação";
      return null;
    },
  },

  // ======================= FATOS VERIFICADOS =======================
  {
    nome: "fatosParaAfirmacoes nunca afirma nada sem evidência real de ferramenta",
    rodar: () => {
      const fatos = montarFatosVerificados({
        estado: "montando_carrinho",
        pedido: { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)] },
        pendencias: ["tipo_entrega"],
      });
      const afirmacoes = fatosParaAfirmacoes(fatos, []);
      return afirmacoes.length === 0 ? null : `afirmou ${afirmacoes.length} coisa(s) sem nenhuma evidência`;
    },
  },
  {
    nome: "fatosParaAfirmacoes cita a execução real como fonte de cada fato do carrinho",
    rodar: () => {
      const pedido = { ...pedidoVazio(), itens: [item("X-Bacon", 32.9)], tipo_entrega: "retirada" as const };
      const evidencias: EvidenciaColetada[] = [
        { execucaoId: "exec-real", toolNome: "consultar_carrinho", output: resumoPedidoIa(pedido) },
      ];
      const fatos = montarFatosVerificados({
        estado: "montando_carrinho",
        pedido,
        pendencias: informacoesPendentes(pedido),
      });
      const afirmacoes = fatosParaAfirmacoes(fatos, evidencias);
      if (afirmacoes.length === 0) return "não gerou nenhuma afirmação com evidência disponível";
      const semFonte = afirmacoes.filter((a) => a.fonte_tool_execucao_id !== "exec-real");
      return semFonte.length === 0 ? null : `${semFonte.length} afirmação(ões) sem a fonte real`;
    },
  },
];
