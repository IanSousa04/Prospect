// Orquestrador determinístico do checkout (tarefa 0081) — o coração da
// inversão de autoridade: a LLM interpreta a mensagem (intencao.ts), mas
// QUEM decide o que acontece com o estado transacional é este arquivo, em
// código, sempre na mesma ordem:
//
//   decidir mutações → EXECUTAR (tool real, auditada) → RELER o estado
//   persistido → VALIDAR → só então avançar de etapa
//
// Nada aqui confia no retorno que a própria tool montou em memória: toda
// decisão seguinte é tomada sobre o estado relido do banco (CLAUDE.md
// regra 1 aplicada ao próprio estado do pedido, não só a preço).
import type {
  AguardandoConfirmacao,
  EnderecoEntrega,
  EstadoCheckout,
  FluxoPedidoConfig,
  InformacaoPendente,
  MotivoBloqueioAcao,
  NomeFerramenta,
  OrderContext,
  UltimoPedidoCriado,
} from "@prospect/shared";
import {
  calcularHashConfirmacao,
  confirmacaoPendenteValida,
  construirResumoTexto,
  derivarEstadoCheckout,
  informacoesPendentes,
} from "@prospect/shared";
import type { ToolContext } from "../../tools/index.js";
import type { EvidenciaColetada } from "../investigador.js";
import { erroDaExecucao, PORTAS_REAIS, type FalhaDeFerramenta, type PortasDoWorkflow } from "../portas.js";
import type { IntencaoTransacional } from "../interpretacao/mensagem.js";

export { PORTAS_REAIS, type PortasDoWorkflow, type FalhaDeFerramenta } from "../portas.js";

/** Tempo de validade de um resumo apresentado (tarefa 0022) — passou disso,
 * o cliente precisa ver o resumo de novo antes de confirmar. Morava em
 * tools/carrinho.ts, dentro de `consultar_carrinho`; mudou pra cá junto com
 * a responsabilidade de apresentar o resumo. */
const MINUTOS_EXPIRACAO_CONFIRMACAO = 10;

/** Campo do pedido que uma mutação planejada deve preencher — usado pra
 * validar, depois de reler o estado, se a ferramenta realmente teve efeito
 * (invariante `tool_success_without_state_change`). */
export type CampoDeSlot = "tipo_entrega" | "endereco" | "forma_pagamento";

export interface MutacaoPlanejada {
  tool: NomeFerramenta;
  input: Record<string, unknown>;
  campo: CampoDeSlot;
}

/** Motivos pelos quais um dado veio na mensagem mas não pôde virar mutação —
 * viram fato verificado pro Atendente pedir exatamente o que falta, em vez
 * de o cliente ficar sem entender por que nada aconteceu. */
export type DadoNaoAproveitado = "endereco_incompleto" | "endereco_ignorado_em_retirada";

const CAMPOS_ENDERECO_OBRIGATORIOS = ["rua", "numero", "bairro", "cidade"] as const;

export function enderecoEstaCompleto(endereco: Partial<EnderecoEntrega> | null): endereco is EnderecoEntrega {
  if (!endereco) return false;
  return CAMPOS_ENDERECO_OBRIGATORIOS.every((campo) => {
    const valor = endereco[campo];
    return typeof valor === "string" && valor.trim().length > 0;
  });
}

/**
 * Função PURA que traduz "o cliente disse X" em "estas mutações precisam
 * rodar" — o ponto exato onde a especificação inverte a autoridade (itens 6
 * e 7): a LLM produz os dados estruturados, o código determina quais
 * ferramentas são obrigatórias. Nunca depende de o modelo "lembrar" de
 * chamar a tool.
 *
 * Ordem importa e é fixa: tipo de entrega antes de endereço (escolher
 * "retirada" limpa endereço; `definir_endereco_entrega` força "entrega"),
 * pagamento por último. Uma mutação que não mudaria nada é omitida — além
 * de ser desperdício, toda mutação zera `carrinho_confirmado`, e repetir
 * uma escolha idêntica não pode invalidar uma confirmação legítima.
 */
export function decidirMutacoes(
  pedido: OrderContext,
  intencao: IntencaoTransacional,
  config: FluxoPedidoConfig,
): { mutacoes: MutacaoPlanejada[]; dadosNaoAproveitados: DadoNaoAproveitado[] } {
  const mutacoes: MutacaoPlanejada[] = [];
  const dadosNaoAproveitados: DadoNaoAproveitado[] = [];

  // Sem itens no carrinho não existe pedido pra configurar — informar
  // "entrega" antes de escolher qualquer produto não muta nada (a pergunta
  // certa continua sendo o que o cliente quer comer).
  if (pedido.itens.length === 0) return { mutacoes, dadosNaoAproveitados };

  if (intencao.tipo_entrega && intencao.tipo_entrega !== pedido.tipo_entrega) {
    mutacoes.push({
      tool: "definir_tipo_entrega",
      input: { tipo_entrega: intencao.tipo_entrega },
      campo: "tipo_entrega",
    });
  }

  const tipoFinal = intencao.tipo_entrega ?? pedido.tipo_entrega;
  if (intencao.endereco) {
    if (tipoFinal === "retirada") {
      dadosNaoAproveitados.push("endereco_ignorado_em_retirada");
    } else if (enderecoEstaCompleto(intencao.endereco)) {
      mutacoes.push({ tool: "definir_endereco_entrega", input: { ...intencao.endereco }, campo: "endereco" });
    } else {
      dadosNaoAproveitados.push("endereco_incompleto");
    }
  }

  if (intencao.forma_pagamento && intencao.forma_pagamento !== pedido.forma_pagamento) {
    if (config.perguntar_forma_pagamento) {
      mutacoes.push({
        tool: "definir_forma_pagamento",
        input: { forma_pagamento: intencao.forma_pagamento },
        campo: "forma_pagamento",
      });
    }
  }

  return { mutacoes, dadosNaoAproveitados };
}

export interface ResultadoTransicao {
  estadoInicial: EstadoCheckout;
  estadoFinal: EstadoCheckout;
  /** Estado REAL relido do banco depois de todas as mutações. */
  pedido: OrderContext;
  pendencias: InformacaoPendente[];
  confirmacao: AguardandoConfirmacao | null;
  ultimoPedidoCriado: UltimoPedidoCriado | null;
  /** Só `true` quando o workflow reconheceu uma confirmação válida NESTA
   * rodada, com resumo pendente batendo — nunca porque o texto pareceu um
   * "sim". */
  confirmacaoRecebida: boolean;
  pedidoCriadoAgora: { pedido_id: string; idempotente: boolean } | null;
  bloqueioDeRisco: { motivo: MotivoBloqueioAcao; total?: number } | null;
  falhas: FalhaDeFerramenta[];
  dadosNaoAproveitados: DadoNaoAproveitado[];
  /** Evidência real (linhas de `ia_execucoes`) de tudo que rodou aqui —
   * alimenta as afirmações do Atendente e a verificação anti-alucinação. */
  evidencias: EvidenciaColetada[];
  /** Saída completa da última execução de `criar_pedido` bem-sucedida —
   * é dela que a mensagem fixa de confirmação é montada. */
  saidaCriacao: Record<string, unknown> | null;
}

/**
 * A mutação de fato pegou? Compara o estado RELIDO com o valor que a mutação
 * pretendia gravar — não basta "o campo não está nulo": um
 * `definir_tipo_entrega("entrega")` que falhasse em silêncio sobre um pedido
 * que já era "retirada" deixaria o campo preenchido com o valor ERRADO, e
 * uma checagem de nulidade não veria nada de errado nisso.
 */
function mutacaoTeveEfeito(pedido: OrderContext, mutacao: MutacaoPlanejada): boolean {
  if (mutacao.campo === "tipo_entrega") return pedido.tipo_entrega === mutacao.input.tipo_entrega;
  if (mutacao.campo === "forma_pagamento") return pedido.forma_pagamento === mutacao.input.forma_pagamento;
  return pedido.endereco?.rua === mutacao.input.rua && pedido.endereco?.numero === mutacao.input.numero;
}

export interface ParamsAplicarIntencao {
  ctx: ToolContext;
  intencao: IntencaoTransacional;
  config: FluxoPedidoConfig;
  portas?: PortasDoWorkflow;
}

/**
 * Fase 1 do turno transacional, ANTES de qualquer investigação: aplica no
 * estado real tudo que a mensagem do cliente autorizou, e — só se o estado
 * relido comprovar que dá — cria o pedido.
 */
export async function aplicarIntencao(params: ParamsAplicarIntencao): Promise<ResultadoTransicao> {
  const portas = params.portas ?? PORTAS_REAIS;
  const { ctx, intencao, config } = params;
  const evidencias: EvidenciaColetada[] = [];
  const falhas: FalhaDeFerramenta[] = [];

  const pedidoInicial = await portas.carregarPedido(ctx);
  const confirmacaoInicial = await portas.carregarConfirmacao(ctx);
  const ultimoInicial = await portas.carregarUltimoPedidoCriado(ctx);
  const estadoInicial = derivarEstadoCheckout(pedidoInicial, confirmacaoInicial, ultimoInicial, config, portas.agora());

  const { mutacoes, dadosNaoAproveitados } = decidirMutacoes(pedidoInicial, intencao, config);

  // ---- MUTATE: toda mutação decidida aqui é obrigatória, não sugestão ----
  for (const mutacao of mutacoes) {
    const execucao = await portas.executar(mutacao.tool, mutacao.input, ctx);
    if (execucao.sucesso && execucao.execucaoId) {
      evidencias.push({ execucaoId: execucao.execucaoId, toolNome: mutacao.tool, output: execucao.output });
    }
    const erro = erroDaExecucao(execucao);
    if (erro) falhas.push({ tool: mutacao.tool, erro });
  }

  // ---- READ: o banco é a fonte da verdade, nunca o retorno da tool ----
  let pedido = await portas.carregarPedido(ctx);

  // ---- VALIDATE: a mutação realmente aconteceu? ----
  for (const mutacao of mutacoes) {
    const jaFalhou = falhas.some((f) => f.tool === mutacao.tool);
    if (jaFalhou) continue;
    if (!mutacaoTeveEfeito(pedido, mutacao)) {
      await portas.registrarInvariante(ctx, "tool_success_without_state_change", {
        tool: mutacao.tool,
        campo: mutacao.campo,
        input: mutacao.input,
      });
      falhas.push({ tool: mutacao.tool, erro: "estado_nao_mudou" });
    }
  }

  // Dado identificado na mensagem que, no fim de tudo, não está no estado
  // real e nem sequer virou tentativa de mutação — é exatamente o episódio
  // "Barbara" (cliente informou entrega e pagamento, nada foi executado).
  if (intencao.tipo_entrega && !mutacoes.some((m) => m.campo === "tipo_entrega") && pedido.tipo_entrega !== intencao.tipo_entrega) {
    await portas.registrarInvariante(ctx, "tool_expected_but_not_called", {
      campo: "tipo_entrega",
      valor: intencao.tipo_entrega,
      estado_atual: pedido.tipo_entrega,
    });
  }
  if (
    intencao.forma_pagamento &&
    !mutacoes.some((m) => m.campo === "forma_pagamento") &&
    pedido.forma_pagamento !== intencao.forma_pagamento &&
    config.perguntar_forma_pagamento
  ) {
    await portas.registrarInvariante(ctx, "tool_expected_but_not_called", {
      campo: "forma_pagamento",
      valor: intencao.forma_pagamento,
      estado_atual: pedido.forma_pagamento,
    });
  }

  let confirmacao = await portas.carregarConfirmacao(ctx);
  let ultimoPedidoCriado = await portas.carregarUltimoPedidoCriado(ctx);
  let estadoAtual = derivarEstadoCheckout(pedido, confirmacao, ultimoPedidoCriado, config, portas.agora());

  let confirmacaoRecebida = false;
  let pedidoCriadoAgora: { pedido_id: string; idempotente: boolean } | null = null;
  let bloqueioDeRisco: { motivo: MotivoBloqueioAcao; total?: number } | null = null;
  let saidaCriacao: Record<string, unknown> | null = null;

  // ---- CONFIRMAÇÃO: única porta pra ação irreversível ----
  // Só existe confirmação a receber quando o resumo apresentado ainda
  // descreve o carrinho atual. Se a própria mensagem mudou algo (ex.: "isso,
  // mas troca pra pix"), o hash já não bate e o estado deixou de ser
  // `aguardando_confirmacao` — o cliente confirmou um resumo que não existe
  // mais, e o certo é reapresentar, nunca criar.
  if (intencao.confirmacao === "confirma" && estadoAtual === "aguardando_confirmacao") {
    confirmacaoRecebida = true;

    // Grava a confirmação no estado persistido ANTES de criar: é ela que
    // `criar_pedido` exige como prova de que o cliente autorizou (nunca uma
    // variável em memória, nunca a opinião de um modelo).
    await portas.salvarPedido(ctx, { ...pedido, carrinho_confirmado: true });
    pedido = await portas.carregarPedido(ctx);

    if (!pedido.carrinho_confirmado) {
      await portas.registrarInvariante(ctx, "state_mutation_without_tool", {
        campo: "carrinho_confirmado",
        esperado: true,
        obtido: pedido.carrinho_confirmado,
      });
      falhas.push({ tool: "criar_pedido", erro: "confirmacao_nao_persistida" });
    } else {
      const execucao = await portas.executar("criar_pedido", {}, ctx);
      if (execucao.sucesso && execucao.execucaoId) {
        evidencias.push({ execucaoId: execucao.execucaoId, toolNome: "criar_pedido", output: execucao.output });
      }
      const output = (execucao.sucesso ? execucao.output : null) as Record<string, unknown> | null;

      if (output?.pedido_criado === true && typeof output.pedido_id === "string") {
        pedidoCriadoAgora = { pedido_id: output.pedido_id, idempotente: output.idempotente === true };
        saidaCriacao = output;
      } else if (output?.erro === "confirmacao_humana_necessaria") {
        bloqueioDeRisco = output as unknown as { motivo: MotivoBloqueioAcao; total?: number };
      } else {
        const erro = erroDaExecucao(execucao) ?? "criacao_sem_pedido";
        falhas.push({ tool: "criar_pedido", erro });
        // Confirmação válida reconhecida que não virou pedido e nem foi
        // bloqueada por risco: isso não deveria ser possível depois de
        // todas as validações acima.
        await portas.registrarInvariante(ctx, "confirmation_without_order", { erro, estado: estadoAtual });
      }

      // ---- READ final: nada é assumido, nem o sucesso da criação ----
      pedido = await portas.carregarPedido(ctx);
      confirmacao = await portas.carregarConfirmacao(ctx);
      ultimoPedidoCriado = await portas.carregarUltimoPedidoCriado(ctx);

      if (pedidoCriadoAgora && !ultimoPedidoCriado) {
        await portas.registrarInvariante(ctx, "state_mutation_without_tool", {
          campo: "ultimo_pedido_criado",
          pedido_id: pedidoCriadoAgora.pedido_id,
        });
      }
    }

    estadoAtual = derivarEstadoCheckout(pedido, confirmacao, ultimoPedidoCriado, config, portas.agora());
  }

  return {
    estadoInicial,
    estadoFinal: estadoAtual,
    pedido,
    pendencias: informacoesPendentes(pedido, config),
    confirmacao,
    ultimoPedidoCriado,
    confirmacaoRecebida,
    pedidoCriadoAgora,
    bloqueioDeRisco,
    falhas,
    dadosNaoAproveitados,
    evidencias,
    saidaCriacao,
  };
}

export interface ResultadoSincronizacao {
  pedido: OrderContext;
  pendencias: InformacaoPendente[];
  confirmacao: AguardandoConfirmacao | null;
  ultimoPedidoCriado: UltimoPedidoCriado | null;
  estado: EstadoCheckout;
  /** true quando ESTE turno passou a ter um resumo válido aguardando
   * confirmação (o resumo está prestes a ser apresentado ao cliente). */
  apresentouResumo: boolean;
  evidencias: EvidenciaColetada[];
}

/**
 * Fase 2 do turno, DEPOIS da investigação: o Investigador pode ter mudado os
 * itens do carrinho (é ele quem resolve produto no catálogo), então a etapa
 * do checkout é recalculada sobre o estado real e o resumo pendente é
 * sincronizado com ele.
 *
 * Até a tarefa 0080 isso era efeito colateral de `consultar_carrinho` — ou
 * seja, um estado transacional que só nascia se o modelo resolvesse chamar
 * uma consulta. Agora roda em todo turno, independentemente do que a LLM
 * decidiu fazer.
 */
export async function sincronizarConfirmacaoPendente(params: {
  ctx: ToolContext;
  config: FluxoPedidoConfig;
  portas?: PortasDoWorkflow;
}): Promise<ResultadoSincronizacao> {
  const portas = params.portas ?? PORTAS_REAIS;
  const { ctx, config } = params;
  const evidencias: EvidenciaColetada[] = [];

  const pedido = await portas.carregarPedido(ctx);
  const confirmacaoAtual = await portas.carregarConfirmacao(ctx);
  const ultimoPedidoCriado = await portas.carregarUltimoPedidoCriado(ctx);
  const pendencias = informacoesPendentes(pedido, config);
  const prontoPraFechar = pendencias.length === 1 && pendencias[0] === "confirmacao_final";
  const agora = portas.agora();

  let confirmacao = confirmacaoAtual;
  let apresentouResumo = false;

  if (prontoPraFechar) {
    if (!confirmacaoPendenteValida(pedido, confirmacaoAtual, agora)) {
      confirmacao = {
        hash: calcularHashConfirmacao(pedido),
        expiraEm: new Date(agora.getTime() + MINUTOS_EXPIRACAO_CONFIRMACAO * 60_000).toISOString(),
        resumoTexto: construirResumoTexto(pedido),
      };
      await portas.salvarConfirmacao(ctx, confirmacao);
      apresentouResumo = true;
    }
  } else if (confirmacaoAtual) {
    // O carrinho deixou de estar pronto (item novo, dado apagado): um resumo
    // antigo aguardando confirmação não faz mais sentido nenhum.
    await portas.salvarConfirmacao(ctx, undefined);
    confirmacao = null;
  }

  // Evidência fresca do carrinho pra esta rodada — é ela que sustenta as
  // afirmações de itens/subtotal que o Atendente vai usar, e que a
  // verificação anti-alucinação compara contra o texto final.
  if (pedido.itens.length > 0) {
    const execucao = await portas.executar("consultar_carrinho", {}, ctx);
    if (execucao.sucesso && execucao.execucaoId) {
      evidencias.push({ execucaoId: execucao.execucaoId, toolNome: "consultar_carrinho", output: execucao.output });
    }
  }

  return {
    pedido,
    pendencias,
    confirmacao,
    ultimoPedidoCriado,
    estado: derivarEstadoCheckout(pedido, confirmacao, ultimoPedidoCriado, config, agora),
    apresentouResumo,
    evidencias,
  };
}
