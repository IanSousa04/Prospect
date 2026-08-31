import type { ComportamentoJson } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { criarHandoff } from "../handoffs.js";
import type { ChatMessage } from "../llm/types.js";
import type { ToolContext } from "../tools/index.js";
import { investigar, type EvidenciaColetada } from "./investigador.js";
import { carregarSessao, atualizarSessaoComEvidencias } from "./sessao.js";
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
import {
  interpretarMensagem,
  type AssuntoPerguntado,
} from "./interpretacao/mensagem.js";
import { resolverPerguntas } from "./interpretacao/roteamento.js";
import { instrucaoDeCorrecaoDeLastro, verificarLastro, type FatoParaLastro } from "./lastro.js";
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
  mensagemPedidoPeloLink,
  mensagemCardapioPeloLink,
  trechoLinkPublico,
} from "./deteccao.js";
import type { RelatorioInvestigacao, Confianca, AcaoDecidida, Afirmacao } from "./types.js";

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
   * valer comportamento_json". */
  comportamento: ComportamentoJson;
  /** URL do link público desta loja (montada a partir do slug + base URL).
   * null quando a base URL não está configurada — a IA redireciona pro
   * "cardápio online" sem prometer um link que não existe. */
  linkPublico: string | null;
}

export interface ResultadoOrquestracao {
  acao: AcaoDecidida;
  /** null quando acao === 'handoff' (o humano assume via Kanban, sem
   * mensagem automática) — EXCETO no handoff por pedido explícito do
   * cliente, que sempre carrega uma confirmação de transferência. */
  respostaTexto: string | null;
  confianca: Confianca;
}

async function registrarDecisao(params: {
  ctx: ToolContext;
  confianca: Confianca;
  cobertura: number;
  acao: AcaoDecidida;
  relatorio: RelatorioInvestigacao;
}): Promise<void> {
  await supabaseAdmin.from("ia_decisoes").insert({
    empresa_id: params.ctx.empresaId,
    atendimento_id: params.ctx.atendimentoId,
    mensagem_id: params.ctx.mensagemId,
    confianca: params.confianca,
    risco: "baixo",
    cobertura_ferramentas: params.cobertura,
    acao_decidida: params.acao,
    justificativa_estruturada_json: params.relatorio as unknown as object,
  });
}

/** Log de invariante — situação que, por desenho, não deveria acontecer
 * (ex.: pergunta de negócio respondida sem nenhuma ferramenta). Append-only
 * em `ia_invariantes` (mesmo padrão de ia_decisoes/ia_execucoes). */
async function registrarInvariante(
  ctx: ToolContext,
  evento: "handoff_without_handoff_id" | "business_claim_without_evidence" | "claim_contradicts_evidence" | "question_without_tool_call",
  detalhe: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin.from("ia_invariantes").insert({
    empresa_id: ctx.empresaId,
    atendimento_id: ctx.atendimentoId,
    mensagem_id: ctx.mensagemId,
    evento,
    detalhe_json: detalhe,
  });
}

function relatorioDeterministico(ferramentasChamadas: number): RelatorioInvestigacao {
  return { afirmacoes: [], ambiguidade: { tipo: "nenhuma" }, ferramentasChamadas };
}

/** Ferramentas que respondem sobre o catálogo (produtos/combos) — quando a
 * investigação usou alguma delas, a resposta sobre produto/cardápio carrega o
 * rodapé com o link público. As tools de "cardápio por categoria" foram
 * removidas (task 0083 obsoleta): só restam as de busca do catálogo. */
const FERRAMENTAS_CATALOGO = new Set<string>([
  "buscar_produtos",
  "buscar_combos",
  "buscar_opcoes",
  "buscar_adicionais",
  "buscar_recomendacoes",
]);

/** Última mensagem que o próprio sistema enviou — dá sentido a uma resposta
 * curta ("tudo certo" responde O QUÊ?). */
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
 * Fluxo (arquitetura atual — IA assistente, pedido no link público):
 *
 *   gates fixos → interpretar (LLM só rotula) → redirecionar pedido pro link
 *   → rotear perguntas (código escolhe a tool) → investigar (LLM, só leitura)
 *   → redigir → gate de lastro + verificações anti-alucinação.
 *
 * A IA nunca muta estado transacional: não há carrinho, não há criação,
 * não há alteração/cancelamento de pedido.
 */
export async function processarMensagem(
  params: ProcessarMensagemParams,
): Promise<ResultadoOrquestracao> {
  const { pergunta, historico, ctx } = params;

  // Checagem determinística, ANTES de qualquer chamada ao LLM.
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

  // ================= 1. INTERPRETAR (LLM rotula, código decide) =================
  const sessao = await carregarSessao(ctx);
  const intencao = await interpretarMensagem({
    pergunta,
    ultimaPerguntaDoSistema: ultimaPerguntaDoSistema(historico),
  });

  // ================= 2. PEDIR PEDIDO → REDIRECIONAR PRO LINK =================
  // Quem monta/cria/altera/cancela pedido é o cliente, no link público. A IA
  // nunca tenta agir — responde com um redirecionamento determinístico (texto
  // fixo, nunca gerado pelo Atendente).
  if (intencao.quer_pedido) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioDeterministico(0),
    });
    return {
      acao: "responder",
      respostaTexto: mensagemPedidoPeloLink(params.linkPublico, params.usaEmoji),
      confianca: "alta",
    };
  }

  // ================= 2b. PEDIR CARDÁPIO → REDIRECIONAR PRO LINK ==============
  // A IA não lista itens: quem "pede o cardápio" (genérico ou por categoria)
  // é direcionado ao cardápio online, onde monta o pedido. Texto fixo, nunca
  // gerado pelo Atendente — mesmo padrão do quer_pedido acima.
  if (intencao.perguntas.includes("cardapio")) {
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioDeterministico(0),
    });
    return {
      acao: "responder",
      respostaTexto: mensagemCardapioPeloLink(params.linkPublico, params.usaEmoji),
      confianca: "alta",
    };
  }

  // ================= 3. ROTEAR PERGUNTAS (código escolhe a tool) =================
  const roteamento = await resolverPerguntas({
    perguntas: intencao.perguntas,
    ctx,
    produtoDeReferencia: sessao?.ultimo_produto_mencionado?.id ?? null,
    termoLivre: pergunta,
  });

  if (intencao.perguntas.length > 0 && roteamento.evidencias.length === 0) {
    await registrarInvariante(ctx, "question_without_tool_call", { assuntos: intencao.perguntas });
  }

  // ================= 4. INVESTIGAR (aditivo, só leitura) =================
  const contextoSessao = sessao?.ultimo_produto_mencionado
    ? `Contexto de sessão: o cliente mencionou por último o produto/combo "${sessao.ultimo_produto_mencionado.nome}" (id: ${sessao.ultimo_produto_mencionado.id}). Use isso só se a pergunta atual claramente se referir a ele por pronome/referência implícita (ex.: "esse", "ele", "o mesmo") — nunca para responder sobre um produto diferente.`
    : null;

  let relatorio: RelatorioInvestigacao = relatorioDeterministico(0);
  let evidenciasDaRodada: EvidenciaColetada[] = roteamento.evidencias;

  if (!intencao.social) {
    const investigacao = await investigar(
      pergunta,
      historico,
      ctx,
      params.comportamento,
      contextoSessao,
      roteamento.evidencias,
    );
    relatorio = investigacao.relatorio;
    evidenciasDaRodada = investigacao.evidencias;
    await atualizarSessaoComEvidencias(ctx, investigacao.evidencias);
  }

  // ================= 5. GUARD CONTRA PROMPT INJECTION =================
  const camposComInjection = evidenciasDaRodada.flatMap((e) => buscarPromptInjectionEmEvidencia(e.output));
  if (camposComInjection.length > 0) {
    const textoRelatorio = JSON.stringify(relatorio.afirmacoes.map((a) => a.texto));
    const checkObediencia = relatorioObedeceuInjection(textoRelatorio, evidenciasDaRodada);
    const trechosCopiados = detectarCopiaLiteralDeInjection(textoRelatorio, evidenciasDaRodada);

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

  // ================= 6. DECIDIR =================
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
  });

  if (decisao.acao === "handoff") {
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
  const afirmacoesVerificadas: Afirmacao[] = relatorio.afirmacoes.filter(
    (a) => a.fonte_tool_execucao_id !== null,
  );

  const opcoesDeRedacao = {
    pergunta,
    historico,
    afirmacoes: afirmacoesVerificadas,
    acao: decisao.acao as Extract<AcaoDecidida, "responder" | "pedir_esclarecimento">,
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
  // Toda afirmação sobre o negócio precisa estar ancorada num fato verificado
  // desta rodada — é o que fecha a classe inteira de invenção.
  const fatosDoLastro: FatoParaLastro[] = afirmacoesVerificadas.map((a) => ({ texto: a.texto }));
  const lastro = await verificarLastro({ texto, fatos: fatosDoLastro });
  if (!lastro.aprovado) {
    const contradiz = lastro.semLastro.some((a) => a.motivo === "contradiz_evidencia");
    await registrarInvariante(ctx, contradiz ? "claim_contradicts_evidence" : "business_claim_without_evidence", {
      frases: lastro.semLastro.map((a) => a.frase),
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
          texto_descartado: texto,
          segunda_tentativa: true,
        },
      );
      return { acao: "handoff", respostaTexto: null, confianca: "baixa" };
    }
  }

  // ================= 9. VERIFICAÇÕES ESPECÍFICAS =================
  const valorNaoVerificado = contemValorNaoVerificado(texto, evidenciasDaRodada);
  const produtoNaoVerificado = contemProdutoNaoVerificado(texto, evidenciasDaRodada);
  const promessaNaoSuportada = contemPromessaNaoSuportada(texto);
  const pedeCodigo = pedeCodigoDePedido(texto);
  if (valorNaoVerificado || produtoNaoVerificado || promessaNaoSuportada || pedeCodigo) {
    const causa = valorNaoVerificado
      ? "continha um valor monetário não presente na evidência real coletada"
      : produtoNaoVerificado
        ? "citava em negrito um nome de produto que não bate com nenhum resultado real de busca no cardápio"
        : promessaNaoSuportada
          ? "prometia um formato/canal (PDF, arquivo, imagem, link) que o sistema não suporta"
          : "pedia um número/código de pedido ao cliente, algo que o sistema resolve sozinho";

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

  // Rodapé do link público: na primeira mensagem da conversa (cumprimento) e em
  // respostas sobre catálogo/produtos — o cliente sempre é lembrado de que o
  // pedido é feito pelo cardápio online. Anexado DEPOIS de todos os gates
  // (texto fixo determinístico, nunca gerado/checado pelo LLM).
  const respostaTemLink =
    historico.length === 0 ||
    evidenciasDaRodada.some((e) => FERRAMENTAS_CATALOGO.has(e.toolNome));
  const respostaFinal = respostaTemLink
    ? `${texto}${trechoLinkPublico(params.linkPublico)}`
    : texto;

  return { acao: decisao.acao, respostaTexto: respostaFinal, confianca };
}
