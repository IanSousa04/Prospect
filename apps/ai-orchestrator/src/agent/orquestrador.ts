import type { ComportamentoJson, MotivoBloqueioAcao } from "@prospect/shared";
import { derivarEstadoCheckout, informacoesPendentes } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { criarHandoff } from "../handoffs.js";
import type { ChatMessage } from "../llm/types.js";
import type { ToolContext } from "../tools/index.js";
import { getRiscoFerramenta } from "../tools/index.js";
import { investigar, type EvidenciaColetada } from "./investigador.js";
import {
  carregarSessao,
  atualizarSessaoComEvidencias,
  carregarPedidoEmConstrucao,
  carregarConfirmacaoPendente,
  carregarUltimoPedidoCriado,
} from "./sessao.js";
import { redigir } from "./atendente.js";
import { computeConfianca } from "./confianca.js";
import { decidir } from "./decisao.js";
import {
  contemValorNaoVerificado,
  contemPromessaNaoSuportada,
  contemProdutoNaoVerificado,
  pedeCodigoDePedido,
} from "./verificacao.js";
import { sanitizarFormatacaoWhatsapp } from "./sanitizacao.js";
import { mensagemDePedidoConfirmado, type ResumoPedidoConfirmado } from "./confirmacao-pedido.js";
import {
  interpretarMensagem,
  type AssuntoPerguntado,
  type IntencaoDaMensagem,
} from "./interpretacao/mensagem.js";
import { resolverItensMencionados, type ResultadoResolucaoItens } from "./interpretacao/itens.js";
import { resolverPerguntas } from "./interpretacao/roteamento.js";
import { PORTAS_REAIS } from "./portas.js";
import { instrucaoDeCorrecaoDeLastro, verificarLastro } from "./lastro.js";
import { aplicarIntencao, sincronizarConfirmacaoPendente } from "./checkout/transicoes.js";
import {
  fatosParaAfirmacoes,
  fatosParaLastro,
  mensagemDeterministicaDeFallback,
  montarFatosVerificados,
  type FatosVerificados,
} from "./checkout/fatos.js";
import { avaliarRespostaTransacional, instrucaoDeCorrecao } from "./checkout/truth-gate.js";
import { registrarInvariante } from "./checkout/invariantes.js";
import {
  buscarPromptInjectionEmEvidencia,
  relatorioObedeceuInjection,
  detectarCopiaLiteralDeInjection,
} from "./sanitizacao-prompt-injection.js";
import {
  clientePediuHumano,
  mensagemDeTransferencia,
  pedeTempoReal,
  mensagemSemTempoReal,
  pedeIdentidade,
  mensagemDeIdentidade,
} from "./deteccao.js";
import type { RelatorioInvestigacao, Confianca, AcaoDecidida, Risco, Afirmacao } from "./types.js";

export interface ProcessarMensagemParams {
  pergunta: string;
  historico: ChatMessage[];
  ctx: ToolContext;
  tomDeVoz: "formal" | "neutro" | "amigavel" | "descontraido";
  usaEmoji: boolean;
  /** Nome/persona configurado pela empresa — ver deteccao.ts,
   * mensagemDeIdentidade. null = usa texto genérico honesto. */
  nomeAssistente: string | null;
  /** `ia_configuracoes.comportamento_json` — ver docs/ROADMAP.md §1 "Fazer
   * valer comportamento_json". Sempre parseado com ComportamentoJsonSchema
   * antes de chegar aqui (nunca confiar no shape cru do banco). */
  comportamento: ComportamentoJson;
}

export interface ResultadoOrquestracao {
  acao: AcaoDecidida;
  /** Normalmente null quando acao === 'handoff' (o humano assume via
   * Kanban, sem mensagem automática) — EXCETO no handoff por pedido
   * explícito do cliente, que sempre carrega uma confirmação de
   * transferência (texto fixo, nunca gerado pelo LLM — ver deteccao.ts). */
  respostaTexto: string | null;
  confianca: Confianca;
}

async function registrarDecisao(params: {
  ctx: ToolContext;
  confianca: Confianca;
  cobertura: number;
  acao: AcaoDecidida;
  relatorio: RelatorioInvestigacao;
  /** Risco real desta rodada (tarefa 0023) — default "baixo" pros caminhos
   * determinísticos que nunca chamam tool nenhuma (pedido de humano, hora,
   * identidade). No caminho real de investigação, vem de
   * `calcularRiscoMaximo(evidencias)`. */
  risco?: Risco;
}): Promise<void> {
  await supabaseAdmin.from("ia_decisoes").insert({
    empresa_id: params.ctx.empresaId,
    atendimento_id: params.ctx.atendimentoId,
    mensagem_id: params.ctx.mensagemId,
    confianca: params.confianca,
    risco: params.risco ?? "baixo",
    cobertura_ferramentas: params.cobertura,
    acao_decidida: params.acao,
    justificativa_estruturada_json: params.relatorio as unknown as object,
  });
}

const ORDEM_RISCO: Record<Risco, number> = { baixo: 0, medio: 1, alto: 2 };

/** Risco real desta rodada (tarefa 0023) — o mais alto entre todas as
 * tools de fato chamadas, via `getRiscoFerramenta` (ToolDefinicao.risco,
 * declarado em cada tool mas nunca consultado antes desta tarefa). Função
 * pura, testável sem banco. */
export function calcularRiscoMaximo(evidencias: EvidenciaColetada[]): Risco {
  let maior: Risco = "baixo";
  for (const evidencia of evidencias) {
    const risco = getRiscoFerramenta(evidencia.toolNome as Parameters<typeof getRiscoFerramenta>[0]);
    if (ORDEM_RISCO[risco] > ORDEM_RISCO[maior]) maior = risco;
  }
  return maior;
}

/** Texto de handoff pro veto de alto risco — extraído em função pura pra
 * ficar testável no gabarito sem precisar rodar a pipeline inteira. Cobre
 * os 3 motivos de `avaliarRiscoAcao` (risco-acao.ts, tarefa 0023) de forma
 * genérica por tool, não mais hardcoded pra "criar_pedido". */
export function motivoBloqueioParaTexto(
  toolNome: string,
  detalhe: { motivo: MotivoBloqueioAcao; total?: number },
): string {
  switch (detalhe.motivo) {
    case "empresa_exige_confirmacao_humana":
      return `Empresa configurou que a ação "${toolNome}" pela IA sempre exige confirmação humana`;
    case "valor_acima_do_limite_sem_handoff":
      return `Valor envolvido (R$ ${(detalhe.total ?? 0).toFixed(2)}) acima do limite configurado pra "${toolNome}" sem handoff`;
    case "status_pedido_nao_permitido":
      return `Status atual do pedido não permite executar "${toolNome}" automaticamente, conforme configuração da empresa`;
  }
}

function relatorioDeterministico(ferramentasChamadas: number): RelatorioInvestigacao {
  return { afirmacoes: [], ambiguidade: { tipo: "nenhuma" }, ferramentasChamadas };
}

/** Última mensagem que o próprio sistema enviou — é o contexto que dá
 * sentido a uma resposta curta ("tudo certo" responde O QUÊ?). Sem isso a
 * classificação de intenção volta a ser feita sobre texto isolado, que é
 * exatamente o erro que esta tarefa elimina (item 4 da especificação). */
function ultimaPerguntaDoSistema(historico: ChatMessage[]): string | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    const mensagem = historico[i]!;
    if (mensagem.role === "assistant" && mensagem.content.trim().length > 0) return mensagem.content;
  }
  return null;
}

/**
 * Ponto de entrada por mensagem do cliente.
 *
 * Ordem (tarefa 0081 — a LLM interpreta, o workflow decide, o backend
 * executa, o banco confirma, o workflow autoriza, a LLM comunica):
 *
 *   gates fixos → estado real do checkout → intenção (LLM só rotula) →
 *   mutações obrigatórias + criação (código) → investigação (LLM, sem poder
 *   mexer em estado transacional) → sincronização do resumo → fatos
 *   verificados → redação → TransactionTruthGate.
 */
export async function processarMensagem(
  params: ProcessarMensagemParams,
): Promise<ResultadoOrquestracao> {
  const { pergunta, historico, ctx } = params;

  // Checagem determinística, ANTES de qualquer chamada ao LLM — nunca deixa
  // essa decisão na mão do modelo (ver agent/deteccao.ts: um caso real de
  // produção mostrou a IA negando ser IA quando o cliente pediu humano).
  if (clientePediuHumano(pergunta)) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioDeterministico(0),
    });
    await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "cliente_solicitou",
      motivo: "Cliente pediu para falar com um atendente humano",
      resumo: `Cliente disse: "${pergunta}"`,
      acao_sugerida: "Assumir a conversa e continuar o atendimento diretamente.",
      prioridade: "alta",
    });
    return { acao: "handoff", respostaTexto: mensagemDeTransferencia(params.usaEmoji), confianca: "alta" };
  }

  // Hora/data atual ("que horas são?") — DETERMINÍSTICA, antes de qualquer
  // chamada ao LLM, resposta fixa nunca gerada pelo modelo (mesmo motivo de
  // `clientePediuHumano` acima: o LLM "inventa" um horário plausível).
  if (pedeTempoReal(pergunta)) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioDeterministico(0),
    });
    return { acao: "responder", respostaTexto: mensagemSemTempoReal(params.usaEmoji), confianca: "alta" };
  }

  // Identidade da IA ("quem é você?", "você é um robô?") — DETERMINÍSTICA,
  // mesmo motivo dos dois blocos acima: episódio real de produção mostrou a
  // IA afirmando ser humana quando perguntada.
  if (pedeIdentidade(pergunta)) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioDeterministico(0),
    });
    return {
      acao: "responder",
      respostaTexto: mensagemDeIdentidade(params.nomeAssistente, params.usaEmoji),
      confianca: "alta",
    };
  }

  // ================= 1. INTERPRETAR (LLM, sempre) =================
  // Roda em TODA mensagem, não só dentro do checkout. Foi a condição "só
  // quando já existe carrinho" que deixou o pipeline da 0081 inerte numa
  // conversa inteira: sem item, nada disso ligava, e a decisão de chamar
  // ferramenta voltava a ser do modelo.
  const [pedidoAntes, confirmacaoAntes, ultimoPedidoAntes, sessao] = await Promise.all([
    carregarPedidoEmConstrucao(ctx),
    carregarConfirmacaoPendente(ctx),
    carregarUltimoPedidoCriado(ctx),
    carregarSessao(ctx),
  ]);
  const estadoAntes = derivarEstadoCheckout(pedidoAntes, confirmacaoAntes, ultimoPedidoAntes, ctx.fluxoPedido);

  const intencao: IntencaoDaMensagem = await interpretarMensagem({
    pergunta,
    estado: estadoAntes,
    pendencias: informacoesPendentes(pedidoAntes, ctx.fluxoPedido),
    ultimaPerguntaDoSistema: ultimaPerguntaDoSistema(historico),
    config: ctx.fluxoPedido,
  });

  // ================= 2. RESOLVER ITENS (código) =================
  // Cada item citado vira busca real no catálogo e, com match único,
  // `adicionar_ao_carrinho` executado pelo código. Zero resultados vira fato
  // negativo explícito. Nunca depende de o modelo lembrar de chamar a tool.
  const itensResolvidos: ResultadoResolucaoItens = await resolverItensMencionados({
    itens: intencao.itens,
    ctx,
    portas: PORTAS_REAIS,
  });

  // ================= 3. MUTAR SLOTS + CONFIRMAÇÃO (código) =================
  const transicao = await aplicarIntencao({ ctx, intencao, config: ctx.fluxoPedido });

  // Pedido criado de verdade: mensagem montada em código a partir do retorno
  // real de `criar_pedido`, nunca escrita pelo Atendente.
  if (transicao.pedidoCriadoAgora && transicao.saidaCriacao) {
    const texto = mensagemDePedidoConfirmado(
      transicao.saidaCriacao as unknown as ResumoPedidoConfirmado,
      params.usaEmoji,
    );
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioDeterministico(transicao.evidencias.length),
      risco: "alto",
    });
    return { acao: "responder", respostaTexto: texto, confianca: "alta" };
  }

  // Confirmação bloqueada pela configuração de risco da empresa (CLAUDE.md
  // regra 6) — handoff estruturado, com evidência de handoff.
  if (transicao.bloqueioDeRisco) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioDeterministico(transicao.evidencias.length),
      risco: "alto",
    });
    const handoffId = await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "alto_risco",
      motivo: motivoBloqueioParaTexto("criar_pedido", transicao.bloqueioDeRisco),
      resumo: `Cliente confirmou o pedido ("${pergunta}"), mas a execução automática foi bloqueada pela configuração de risco da empresa (CLAUDE.md regra 6 — ação irreversível ou de alto impacto).`,
      acao_sugerida: "Revisar no painel e executar manualmente, ou aprovar com o cliente antes.",
      prioridade: "alta",
    });
    if (!handoffId) await registrarInvariante(ctx, "handoff_without_handoff_id", { origem: "alto_risco" });
    return { acao: "handoff", respostaTexto: null, confianca: "alta" };
  }

  // Cancelar um pedido REAL não tem ferramenta (tasks/0058) — nunca fingir
  // que cancelou nem deixar o Atendente improvisar: handoff estruturado.
  if (intencao.quer_cancelar && estadoAntes === "pedido_criado") {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioDeterministico(transicao.evidencias.length),
      risco: "alto",
    });
    const handoffId = await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "acao_sem_permissao",
      motivo: "Cliente pediu para cancelar um pedido já criado",
      resumo: `Cliente disse: "${pergunta}". Existe um pedido real criado nesta conversa e a IA não tem ferramenta de cancelamento.`,
      acao_sugerida: "Avaliar o cancelamento no painel e responder ao cliente.",
      prioridade: "alta",
    });
    if (!handoffId) await registrarInvariante(ctx, "handoff_without_handoff_id", { origem: "acao_sem_permissao" });
    return { acao: "handoff", respostaTexto: null, confianca: "alta" };
  }

  // Ferramenta de escrita NEGADA pela empresa (CLAUDE.md regra 2) — a IA está
  // estruturalmente impedida de concluir o pedido. Continuar conversando é o
  // pior desfecho: o gabarito flagrou o Atendente improvisando uma lista
  // inventada de formas de pagamento pra justificar a recusa.
  const ferramentaNegada = [...transicao.falhas, ...itensResolvidos.falhas].find(
    (f) => f.erro === "ferramenta_nao_permitida",
  );
  if (ferramentaNegada) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioDeterministico(transicao.evidencias.length),
      risco: "alto",
    });
    const handoffId = await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "acao_sem_permissao",
      motivo: `A IA não tem permissão configurada para "${ferramentaNegada.tool}"`,
      resumo: `Cliente disse: "${pergunta}", o que exige a ação "${ferramentaNegada.tool}" — não permitida em ia_permissoes para esta empresa. O pedido não pode ser fechado automaticamente.`,
      acao_sugerida: `Assumir a conversa e concluir no painel, ou liberar "${ferramentaNegada.tool}" nas permissões da IA.`,
      prioridade: "alta",
    });
    if (!handoffId) await registrarInvariante(ctx, "handoff_without_handoff_id", { origem: "acao_sem_permissao" });
    return { acao: "handoff", respostaTexto: null, confianca: "alta" };
  }

  // ================= 4. ROTEAR PERGUNTAS (código escolhe a tool) =================
  // O modelo rotulou o assunto; quem escolhe e executa a ferramenta é o
  // código. Garante que nenhuma pergunta de negócio é respondida sem pelo
  // menos uma execução real por trás.
  const assuntos: AssuntoPerguntado[] = [...intencao.perguntas];
  // Informar entrega/retirada/pagamento também exige a configuração como
  // fato: é ela que impede afirmar "não fazemos entrega" numa loja que faz.
  if (intencao.tipo_entrega || intencao.forma_pagamento || intencao.endereco) {
    if (!assuntos.includes("opcoes_atendimento")) assuntos.push("opcoes_atendimento");
  }

  const produtoDeReferencia =
    itensResolvidos.adicionados[itensResolvidos.adicionados.length - 1]?.produto_id ??
    sessao?.ultimo_produto_mencionado?.id ??
    null;

  const roteamento = await resolverPerguntas({
    perguntas: assuntos,
    ctx,
    portas: PORTAS_REAIS,
    produtoDeReferencia,
    termoLivre: pergunta,
  });

  if (intencao.perguntas.length > 0 && roteamento.evidencias.length === 0) {
    await registrarInvariante(ctx, "question_without_tool_call", { assuntos: intencao.perguntas });
  }

  const evidenciasDeterministicas = [
    ...transicao.evidencias,
    ...itensResolvidos.evidencias,
    ...roteamento.evidencias,
  ];

  // ================= 5. INVESTIGAR (aditivo) =================
  const contextoSessao = sessao?.ultimo_produto_mencionado
    ? `Contexto de sessão: o cliente mencionou por último o produto/combo "${sessao.ultimo_produto_mencionado.nome}" (id: ${sessao.ultimo_produto_mencionado.id}). Use isso só se a pergunta atual claramente se referir a ele por pronome/referência implícita (ex.: "esse", "ele", "o mesmo") — nunca para responder sobre um produto diferente.`
    : null;

  let relatorio: RelatorioInvestigacao = relatorioDeterministico(0);
  let evidenciasDaRodada = evidenciasDeterministicas;

  if (!intencao.social) {
    const investigacao = await investigar(
      pergunta,
      historico,
      ctx,
      params.comportamento,
      contextoSessao,
      evidenciasDeterministicas,
    );
    relatorio = investigacao.relatorio;
    evidenciasDaRodada = investigacao.evidencias;
    await atualizarSessaoComEvidencias(ctx, investigacao.evidencias);
  }

  // ================= 6. RELER, SINCRONIZAR E MONTAR FATOS =================
  const sincronizacao = await sincronizarConfirmacaoPendente({ ctx, config: ctx.fluxoPedido });
  const evidenciasTotais = [...evidenciasDaRodada, ...sincronizacao.evidencias];

  // Veto determinístico (tarefa 0023): tool de escrita recusada por exigência
  // da própria empresa é definitivo — handoff, sem deixar o resto da pipeline
  // tentar "resolver".
  const bloqueioAcaoAltoRisco = evidenciasTotais.find(
    (e) =>
      e.output &&
      typeof e.output === "object" &&
      (e.output as Record<string, unknown>).erro === "confirmacao_humana_necessaria",
  );
  if (bloqueioAcaoAltoRisco) {
    const detalhe = bloqueioAcaoAltoRisco.output as { motivo: MotivoBloqueioAcao; total?: number };
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioDeterministico(relatorio.ferramentasChamadas),
      risco: "alto",
    });
    const handoffId = await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "alto_risco",
      motivo: motivoBloqueioParaTexto(bloqueioAcaoAltoRisco.toolNome, detalhe),
      resumo: `Cliente confirmou uma ação (${bloqueioAcaoAltoRisco.toolNome}), mas a execução automática foi bloqueada pela configuração de risco da empresa (CLAUDE.md regra 6 — ação irreversível ou de alto impacto).`,
      acao_sugerida: "Revisar no painel e executar manualmente, ou aprovar com o cliente antes.",
      prioridade: "alta",
    });
    if (!handoffId) await registrarInvariante(ctx, "handoff_without_handoff_id", { origem: "alto_risco" });
    return { acao: "handoff", respostaTexto: null, confianca: "alta" };
  }

  // Guard contra prompt injection via conhecimento/ferramentas (tarefa 0010).
  const camposComInjection = evidenciasTotais.flatMap((e) => buscarPromptInjectionEmEvidencia(e.output));
  if (camposComInjection.length > 0) {
    const textoRelatorio = JSON.stringify(relatorio.afirmacoes.map((a) => a.texto));
    const checkObediencia = relatorioObedeceuInjection(textoRelatorio, evidenciasTotais);
    const trechosCopiados = detectarCopiaLiteralDeInjection(textoRelatorio, evidenciasTotais);

    if (checkObediencia.obedeceu || trechosCopiados.length > 0) {
      await registrarDecisao({
        ctx,
        confianca: "baixa",
        cobertura: 0,
        acao: "handoff",
        relatorio: relatorioDeterministico(relatorio.ferramentasChamadas),
      });
      await criarHandoff(ctx.empresaId, {
        atendimento_id: ctx.atendimentoId,
        origem: "falha_conhecimento",
        motivo: "Detectado prompt injection em dados externos (conhecimento/ferramenta)",
        resumo: `Cliente perguntou: "${pergunta}". Dados retornados por ferramentas continham padrões suspeitos de prompt injection e o relatório do Investigador reproduziu instruções embutidas. Campos afetados: ${camposComInjection.map((c) => c.caminho).join(", ")}`,
        acao_sugerida:
          "URGENTE: Revisar manualmente o conteúdo de conhecimento_itens e descrições de produtos. Possível tentativa de manipulação da IA via dados maliciosos.",
        prioridade: "alta",
      });
      return { acao: "handoff", respostaTexto: null, confianca: "baixa" };
    }
  }

  // `pedido_id` só vale como evidência quando o pedido foi criado NESTA
  // rodada ou o checkout ainda está em `pedido_criado` — assim que o cliente
  // começa um carrinho novo, o ponteiro antigo deixa de sustentar afirmação.
  const pedidoIdVerificado =
    transicao.pedidoCriadoAgora?.pedido_id ??
    (sincronizacao.estado === "pedido_criado" ? sincronizacao.ultimoPedidoCriado?.pedido_id ?? null : null);

  const fatos: FatosVerificados = montarFatosVerificados({
    estado: sincronizacao.estado,
    pedido: sincronizacao.pedido,
    pendencias: sincronizacao.pendencias,
    pedidoId: pedidoIdVerificado,
    handoffId: null,
    falhas: [...transicao.falhas, ...itensResolvidos.falhas, ...roteamento.falhas],
    dadosNaoAproveitados: transicao.dadosNaoAproveitados,
    itensResolvidos,
    assuntosSemResposta: roteamento.assuntosSemResposta,
    evidencias: evidenciasTotais,
  });
  const afirmacoesDoWorkflow = fatosParaAfirmacoes(fatos, evidenciasTotais);

  const confianca = computeConfianca(relatorio);
  const decisao = decidir(relatorio, confianca);
  const cobertura = new Set(
    relatorio.afirmacoes.map((a) => a.fonte_tool).filter((t): t is string => t !== null),
  ).size;

  await registrarDecisao({
    ctx,
    confianca,
    cobertura,
    acao: decisao.acao,
    relatorio,
    risco: calcularRiscoMaximo(evidenciasTotais),
  });

  // Handoff por confiança baixa nunca acontece com fato verificado na mão —
  // seria abandonar o cliente tendo o que dizer.
  const temFatoDoWorkflow = afirmacoesDoWorkflow.length > 0;
  const acaoFinal: AcaoDecidida = decisao.acao === "handoff" && temFatoDoWorkflow ? "responder" : decisao.acao;

  if (acaoFinal === "handoff") {
    await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "falha_conhecimento",
      motivo: "IA não conseguiu responder com confiança suficiente",
      resumo: `Cliente perguntou: "${pergunta}". A investigação não reuniu evidência suficiente para responder com segurança.`,
      acao_sugerida: "Verificar manualmente e responder ao cliente.",
      prioridade: "normal",
    });
    return { acao: "handoff", respostaTexto: null, confianca };
  }

  // ================= 7. REDIGIR (LLM) =================
  const afirmacoesVerificadas: Afirmacao[] = [
    ...afirmacoesDoWorkflow,
    ...relatorio.afirmacoes.filter((a) => a.fonte_tool_execucao_id !== null),
  ];

  const opcoesDeRedacao = {
    pergunta,
    historico,
    afirmacoes: afirmacoesVerificadas,
    acao: acaoFinal as Extract<AcaoDecidida, "responder" | "pedir_esclarecimento">,
    opcoesEsclarecimento: relatorio.ambiguidade.opcoes,
    tomDeVoz: params.tomDeVoz,
    usaEmoji: params.usaEmoji,
    comportamento: params.comportamento,
    primeiraMensagem: historico.length === 0,
  };

  const redigirCom = async (instrucao: string | null) =>
    sanitizarFormatacaoWhatsapp(await redigir({ ...opcoesDeRedacao, instrucaoDeCorrecao: instrucao }));

  let texto = await redigirCom(null);

  // ================= 8. GATE DE LASTRO =================
  // Camada A (transacional): regex determinística + classificador semântico
  // na janela de risco — pedido, handoff e cancelamento.
  const veredictoTransacional = await avaliarRespostaTransacional({ texto, fatos });
  if (!veredictoTransacional.aprovado) {
    await registrarInvariante(ctx, "transactional_claim_without_evidence", {
      motivo: veredictoTransacional.motivo,
      detectado_por: veredictoTransacional.detectadoPor,
      estado: fatos.estado_checkout,
      texto_descartado: texto,
    });
    texto = await redigirCom(instrucaoDeCorrecao(fatos, veredictoTransacional.motivo!));

    const segundo = await avaliarRespostaTransacional({ texto, fatos });
    if (!segundo.aprovado) {
      await registrarInvariante(ctx, "transactional_claim_without_evidence", {
        motivo: segundo.motivo,
        estado: fatos.estado_checkout,
        texto_descartado: texto,
        segunda_tentativa: true,
      });
      return {
        acao: "responder",
        respostaTexto: mensagemDeterministicaDeFallback(fatos, params.usaEmoji),
        confianca: "alta",
      };
    }
  }

  // Camada B (lastro): toda afirmação SOBRE O NEGÓCIO precisa estar ancorada
  // num fato desta rodada. É o que fecha a classe inteira de invenção — não
  // só as frases que alguma regex previu.
  const fatosDoLastro = fatosParaLastro(fatos, afirmacoesVerificadas);
  const lastro = await verificarLastro({ texto, fatos: fatosDoLastro });
  if (!lastro.aprovado) {
    const contradiz = lastro.semLastro.some((a) => a.motivo === "contradiz_evidencia");
    await registrarInvariante(ctx, contradiz ? "claim_contradicts_evidence" : "business_claim_without_evidence", {
      frases: lastro.semLastro.map((a) => a.frase),
      estado: fatos.estado_checkout,
      texto_descartado: texto,
    });

    texto = await redigirCom(instrucaoDeCorrecaoDeLastro(lastro));

    const segundoLastro = await verificarLastro({ texto, fatos: fatosDoLastro });
    if (!segundoLastro.aprovado) {
      await registrarInvariante(
        ctx,
        segundoLastro.semLastro.some((a) => a.motivo === "contradiz_evidencia")
          ? "claim_contradicts_evidence"
          : "business_claim_without_evidence",
        {
          frases: segundoLastro.semLastro.map((a) => a.frase),
          estado: fatos.estado_checkout,
          texto_descartado: texto,
          segunda_tentativa: true,
        },
      );
      return {
        acao: "responder",
        respostaTexto: mensagemDeterministicaDeFallback(fatos, params.usaEmoji),
        confianca: "alta",
      };
    }

    // O texto que saiu da regeneração de lastro precisa passar de novo pela
    // camada transacional: consertar o lastro pode introduzir uma afirmação
    // de pedido/handoff que a primeira passada não tinha. Aqui não há nova
    // regeneração — já foram duas — então a reprovação cai direto no texto
    // determinístico.
    const transacionalDepoisDoLastro = await avaliarRespostaTransacional({ texto, fatos });
    if (!transacionalDepoisDoLastro.aprovado) {
      await registrarInvariante(ctx, "transactional_claim_without_evidence", {
        motivo: transacionalDepoisDoLastro.motivo,
        estado: fatos.estado_checkout,
        texto_descartado: texto,
        apos_regeneracao_de_lastro: true,
      });
      return {
        acao: "responder",
        respostaTexto: mensagemDeterministicaDeFallback(fatos, params.usaEmoji),
        confianca: "alta",
      };
    }
  }

  // Verificações específicas que continuam valendo (valor monetário, nome de
  // produto em negrito, promessa de capacidade inexistente, pedido de código).
  const valorNaoVerificado = contemValorNaoVerificado(texto, evidenciasTotais);
  const produtoNaoVerificado = contemProdutoNaoVerificado(texto, evidenciasTotais);
  const promessaNaoSuportada = contemPromessaNaoSuportada(texto);
  const pedeCodigo = pedeCodigoDePedido(texto);
  if (valorNaoVerificado || produtoNaoVerificado || promessaNaoSuportada || pedeCodigo) {
    const causa = valorNaoVerificado
      ? "continha um valor monetário não presente na evidência real coletada"
      : produtoNaoVerificado
        ? "citava em negrito um nome de produto que não bate com nenhum resultado real de busca no cardápio"
        : promessaNaoSuportada
          ? "prometia um formato/canal (PDF, arquivo, imagem, link) que o sistema não suporta"
          : "pedia um número/código de pedido ao cliente, algo que o sistema resolve sozinho e o cliente não tem como fornecer";

    if (temFatoDoWorkflow) {
      await registrarInvariante(ctx, "business_claim_without_evidence", {
        motivo: "verificacao_anti_alucinacao",
        causa,
        texto_descartado: texto,
      });
      return {
        acao: "responder",
        respostaTexto: mensagemDeterministicaDeFallback(fatos, params.usaEmoji),
        confianca: "alta",
      };
    }

    await criarHandoff(
      ctx.empresaId,
      {
        atendimento_id: ctx.atendimentoId,
        origem: "falha_conhecimento",
        motivo: "Verificação anti-alucinação reprovou a resposta gerada",
        resumo: `Cliente perguntou: "${pergunta}". A resposta gerada ${causa} — descartada antes do envio.`,
        acao_sugerida: "Responder manualmente.",
        prioridade: "alta",
      },
      texto,
    );
    return { acao: "handoff", respostaTexto: null, confianca: "baixa" };
  }

  return { acao: acaoFinal, respostaTexto: texto, confianca };
}
