import type { ComportamentoJson } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { criarHandoff } from "../handoffs.js";
import type { ChatMessage } from "../llm/types.js";
import type { ToolContext } from "../tools/index.js";
import { investigar } from "./investigador.js";
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
import type {
  RelatorioInvestigacao,
  Confianca,
  AcaoDecidida,
} from "./types.js";

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
}): Promise<void> {
  await supabaseAdmin.from("ia_decisoes").insert({
    empresa_id: params.ctx.empresaId,
    atendimento_id: params.ctx.atendimentoId,
    mensagem_id: params.ctx.mensagemId,
    confianca: params.confianca,
    risco: "baixo", // MVP 1 nunca executa ação — risco real entra no MVP 2
    cobertura_ferramentas: params.cobertura,
    acao_decidida: params.acao,
    justificativa_estruturada_json: params.relatorio as unknown as object,
  });
}

/**
 * Ponto de entrada por mensagem do cliente. Orquestra Investigador →
 * confiança → decisão → Atendente → verificação anti-alucinação → (se
 * necessário) handoff. Não sabe nada sobre WhatsApp/polling — isso é do
 * chamador (Passo 6 do plano).
 */
export async function processarMensagem(
  params: ProcessarMensagemParams,
): Promise<ResultadoOrquestracao> {
  const { pergunta, historico, ctx } = params;

  // Checagem determinística, ANTES de qualquer chamada ao LLM — nunca deixa
  // essa decisão na mão do modelo (ver agent/deteccao.ts: um caso real de
  // produção mostrou a IA negando ser IA quando o cliente pediu humano).
  if (clientePediuHumano(pergunta)) {
    const relatorioVazio: RelatorioInvestigacao = {
      sem_investigacao: false,
      afirmacoes: [],
      ambiguidade: { tipo: "nenhuma" },
      ferramentasChamadas: 0,
    };
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioVazio,
    });
    await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "cliente_solicitou",
      motivo: "Cliente pediu para falar com um atendente humano",
      resumo: `Cliente disse: "${pergunta}"`,
      acao_sugerida:
        "Assumir a conversa e continuar o atendimento diretamente.",
      prioridade: "alta",
    });
    return {
      acao: "handoff",
      respostaTexto: mensagemDeTransferencia(params.usaEmoji),
      confianca: "alta",
    };
  }

  // Hora/data atual ("que horas são?") — DETERMINÍSTICA, antes de qualquer
  // chamada ao LLM, resposta fixa nunca gerada pelo modelo (mesmo motivo de
  // `clientePediuHumano` acima: o LLM "inventa" um horário plausível). Regra
  // zero-B do Eddy (SEM_TEMPO_REAL) traduzida pro idioma determinístico do
  // Prospect. Confiança alta e sem_investigacao=true no relatório porque não
  // é uma investigação de verdade.
  if (pedeTempoReal(pergunta)) {
    const relatorioVazio: RelatorioInvestigacao = {
      sem_investigacao: true,
      afirmacoes: [],
      ambiguidade: { tipo: "nenhuma" },
      ferramentasChamadas: 0,
    };
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioVazio,
    });
    return {
      acao: "responder",
      respostaTexto: mensagemSemTempoReal(params.usaEmoji),
      confianca: "alta",
    };
  }

  // Identidade da IA ("quem é você?", "você é um robô?") — DETERMINÍSTICA,
  // mesmo motivo dos dois blocos acima: episódio real de produção mostrou a
  // IA afirmando ser humana quando perguntada. Nunca deixa essa resposta na
  // mão livre do LLM, nem pra confirmar nem pra negar (ver deteccao.ts).
  if (pedeIdentidade(pergunta)) {
    const relatorioVazio: RelatorioInvestigacao = {
      sem_investigacao: true,
      afirmacoes: [],
      ambiguidade: { tipo: "nenhuma" },
      ferramentasChamadas: 0,
    };
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio: relatorioVazio,
    });
    return {
      acao: "responder",
      respostaTexto: mensagemDeIdentidade(params.nomeAssistente, params.usaEmoji),
      confianca: "alta",
    };
  }

  // Memória curta entre turnos (ver agent/sessao.ts) — carregada antes da
  // investigação pra dar contexto de "último produto mencionado" quando o
  // histórico bruto passado ao Investigador não cobre mais aquela mensagem.
  const sessao = await carregarSessao(ctx);
  const contextoSessao = sessao?.ultimo_produto_mencionado
    ? `Contexto de sessão: o cliente mencionou por último o produto/combo "${sessao.ultimo_produto_mencionado.nome}" (id: ${sessao.ultimo_produto_mencionado.id}). Use isso só se a pergunta atual claramente se referir a ele por pronome/referência implícita (ex.: "esse", "ele", "o mesmo") — nunca para responder sobre um produto diferente.`
    : null;

  const { relatorio, evidencias } = await investigar(pergunta, historico, ctx, params.comportamento, contextoSessao);
  // Não bloqueia a resposta ao cliente por causa de memória auxiliar —
  // atualiza depois de já ter as evidências, mas antes do retorno, pra não
  // perder o resultado de rodadas onde a IA acaba fazendo handoff.
  await atualizarSessaoComEvidencias(ctx, evidencias);

  // Guard contra prompt injection via conhecimento/ferramentas (ROADMAP.md §1,
  // tarefa 0010): checagem determinística ANTES de qualquer decisão. Se
  // alguma evidência contém padrão de injection E o relatório do Investigador
  // reproduz esse padrão (literal ou estrutural), isso indica que o modelo
  // "obedeceu" uma instrução embutida em vez de apenas citar um fato — veta e
  // força handoff humano (nunca tenta "corrigir" o dado, que pode ter sido
  // injetado maliciosamente no conhecimento).
  const camposComInjection = evidencias.flatMap((e) => buscarPromptInjectionEmEvidencia(e.output));
  if (camposComInjection.length > 0) {
    // Se evidência tinha injection, checa se o relatório obedeceu
    const textoRelatorio = JSON.stringify(relatorio.afirmacoes.map((a) => a.texto));
    const checkObediencia = relatorioObedeceuInjection(textoRelatorio, evidencias);
    const trechosCopiados = detectarCopiaLiteralDeInjection(textoRelatorio, evidencias);

    if (checkObediencia.obedeceu || trechosCopiados.length > 0) {
      const relatorioVazio: RelatorioInvestigacao = {
        sem_investigacao: false,
        afirmacoes: [],
        ambiguidade: { tipo: "nenhuma" },
        ferramentasChamadas: relatorio.ferramentasChamadas,
      };
      await registrarDecisao({
        ctx,
        confianca: "baixa",
        cobertura: 0,
        acao: "handoff",
        relatorio: relatorioVazio,
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
    // Se evidência tinha injection mas o relatório resistiu (não reproduziu),
    // continua — o modelo seguiu a regra 5 do prompt do Investigador.
  }

  const confianca = computeConfianca(relatorio);
  const decisao = decidir(relatorio, confianca);
  const cobertura = new Set(
    relatorio.afirmacoes
      .map((a) => a.fonte_tool)
      .filter((t): t is string => t !== null),
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

  // Nunca repassa uma afirmação sem fonte real verificada como se fosse
  // fato — antes só os tipos comerciais eram vetados (via confiança
  // baixa); `politica`/`generico` sem `fonte_tool_execucao_id` passavam
  // direto pro Atendente como se tivessem sido confirmadas (CLAUDE.md
  // regra 1). As afirmações sintéticas de resultado vazio (ver
  // investigador.ts) sempre têm fonte real, então continuam passando.
  const afirmacoesVerificadas = relatorio.afirmacoes.filter((a) => a.fonte_tool_execucao_id !== null);

  const textoGerado = await redigir({
    pergunta,
    historico,
    afirmacoes: afirmacoesVerificadas,
    acao: decisao.acao,
    opcoesEsclarecimento: relatorio.ambiguidade.opcoes,
    tomDeVoz: params.tomDeVoz,
    usaEmoji: params.usaEmoji,
    comportamento: params.comportamento,
    primeiraMensagem: historico.length === 0,
  });
  // Rede de segurança determinística: prompt sozinho não garante que o
  // Atendente nunca use Markdown — ver agent/sanitizacao.ts.
  const texto = sanitizarFormatacaoWhatsapp(textoGerado);

  // Roda pra QUALQUER ação que gere texto pro cliente (responder E
  // pedir_esclarecimento) — o episódio real que motivou estas duas
  // checagens (IA oferecendo "cardápio em PDF", que não existe) aconteceu
  // justamente num pedir_esclarecimento, que antes ficava de fora dessa
  // verificação. Nunca confia só no prompt (CLAUDE.md regra 1).
  const valorNaoVerificado = contemValorNaoVerificado(texto, evidencias);
  const produtoNaoVerificado = contemProdutoNaoVerificado(texto, evidencias);
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
    await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "falha_conhecimento",
      motivo: "Verificação anti-alucinação reprovou a resposta gerada",
      resumo: `Cliente perguntou: "${pergunta}". A resposta gerada ${causa} — descartada antes do envio.`,
      acao_sugerida: "Responder manualmente.",
      prioridade: "alta",
    });
    return { acao: "handoff", respostaTexto: null, confianca: "baixa" };
  }

  return { acao: decisao.acao, respostaTexto: texto, confianca };
}
