import type { ComportamentoJson, MotivoBloqueioAcao } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { criarHandoff } from "../handoffs.js";
import type { ChatMessage } from "../llm/types.js";
import type { ToolContext } from "../tools/index.js";
import { getRiscoFerramenta, executeTool } from "../tools/index.js";
import { investigar, criarPedidoDisponivel, type EvidenciaColetada } from "./investigador.js";
import { carregarSessao, atualizarSessaoComEvidencias, carregarPedidoEmConstrucao, carregarConfirmacaoPendente } from "./sessao.js";
import { redigir } from "./atendente.js";
import { computeConfianca } from "./confianca.js";
import { decidir } from "./decisao.js";
import {
  contemValorNaoVerificado,
  contemPromessaNaoSuportada,
  contemProdutoNaoVerificado,
  pedeCodigoDePedido,
  contemConfirmacaoDePedidoNaoVerificada,
} from "./verificacao.js";
import { sanitizarFormatacaoWhatsapp } from "./sanitizacao.js";
import { mensagemDePedidoConfirmado, type ResumoPedidoConfirmado } from "./confirmacao-pedido.js";
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
  confirmaResumoPendente,
} from "./deteccao.js";
import type {
  RelatorioInvestigacao,
  Confianca,
  AcaoDecidida,
  Risco,
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

  // Gate determinístico da etapa de confirmação final (motor de etapas,
  // tasks/0056/0077/0078) — resolve o episódio real que motivou este bloco:
  // cliente respondeu só "Sim" a um resumo já apresentado, e o Investigador
  // (LLM) simplesmente não chamou "criar_pedido" nesta rodada, deixando o
  // Atendente escrever "Pedido confirmado!" sem nenhuma criação real ter
  // acontecido — só a verificação anti-alucinação pegou isso, tarde demais
  // (handoff mudo em vez de fechar o pedido). Mesmo padrão determinístico
  // dos 3 blocos acima, aplicado à ação mais crítica do sistema: trata a
  // etapa `confirmacao_final` como um "slot" preenchido por reconhecimento
  // determinístico, não por interpretação livre do LLM a cada turno (mesmo
  // padrão consolidado pela indústria pra IA conversacional transacional —
  // Rasa CALM, ver nota de pesquisa no plano desta tarefa). Só dispara
  // quando já existe uma confirmação pendente válida pro resumo mostrado
  // (`criarPedidoDisponivel` — mesmo gate de exposição usado dentro de
  // `investigar()`), então nunca cria um pedido "por engano" a partir de um
  // "sim"/"ok" solto sem relação com pedido nenhum.
  if (confirmaResumoPendente(pergunta)) {
    const pedidoAtual = await carregarPedidoEmConstrucao(ctx);
    const confirmacaoPendente = await carregarConfirmacaoPendente(ctx);

    if (criarPedidoDisponivel(pedidoAtual, confirmacaoPendente, ctx.fluxoPedido)) {
      const execucao = await executeTool("criar_pedido", {}, ctx);
      const output = execucao.sucesso ? (execucao.output as Record<string, unknown>) : null;

      if (output?.pedido_criado === true) {
        // Mesma mensagem fixa (nunca escrita livre pelo Atendente) usada
        // pelo caminho normal mais abaixo neste arquivo (pedidoConfirmadoAgora).
        const resumo = output as unknown as ResumoPedidoConfirmado;
        const texto = mensagemDePedidoConfirmado(resumo, params.usaEmoji);
        const relatorioVazio: RelatorioInvestigacao = {
          sem_investigacao: false,
          afirmacoes: [],
          ambiguidade: { tipo: "nenhuma" },
          ferramentasChamadas: 1,
        };
        await registrarDecisao({ ctx, confianca: "alta", cobertura: 0, acao: "responder", relatorio: relatorioVazio, risco: "alto" });
        return { acao: "responder", respostaTexto: texto, confianca: "alta" };
      }

      if (output?.erro === "confirmacao_humana_necessaria") {
        const detalhe = output as { motivo: MotivoBloqueioAcao; total?: number };
        const relatorioVazio: RelatorioInvestigacao = {
          sem_investigacao: false,
          afirmacoes: [],
          ambiguidade: { tipo: "nenhuma" },
          ferramentasChamadas: 1,
        };
        await registrarDecisao({ ctx, confianca: "alta", cobertura: 0, acao: "handoff", relatorio: relatorioVazio, risco: "alto" });
        await criarHandoff(ctx.empresaId, {
          atendimento_id: ctx.atendimentoId,
          origem: "alto_risco",
          motivo: motivoBloqueioParaTexto("criar_pedido", detalhe),
          resumo: `Cliente confirmou o pedido ("${pergunta}"), mas a execução automática foi bloqueada pela configuração de risco da empresa (CLAUDE.md regra 6 — ação irreversível ou de alto impacto).`,
          acao_sugerida: "Revisar no painel e executar manualmente, ou aprovar com o cliente antes.",
          prioridade: "alta",
        });
        return { acao: "handoff", respostaTexto: null, confianca: "alta" };
      }

      // erro: "pedido_incompleto" / "confirmacao_expirada_ou_invalida" (ou
      // qualquer outra coisa inesperada) — pode ser falso positivo do regex,
      // ou o carrinho mudou entre o resumo e esta mensagem. Nunca trata como
      // confirmação real: cai pro fluxo normal de `investigar()` como se
      // este bloco não tivesse rodado — as redes de segurança já existentes
      // (`sintetizarAfirmacaoDePedidoIncompleto`/
      // `sintetizarAfirmacaoDeConfirmacaoExpirada`) cuidam de reapresentar o
      // resumo atualizado.
    }
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

  // Veto determinístico, ANTES de qualquer decisão (mesmo espírito do guard
  // de prompt injection abaixo): se QUALQUER tool de escrita (tarefa 0023 —
  // generaliza o que a 0055 fez só pra "criar_pedido") recusou agir por
  // exigência da própria empresa configurada em `ia_permissoes`
  // (`avaliarRiscoAcao`, packages/shared/src/risco-acao.ts — exige
  // confirmação humana, valor acima do limite, ou status de pedido não
  // permitido, CLAUDE.md regra 6), isso é definitivo — nunca deixa o resto
  // da pipeline (LLM decidindo relatório/resposta) tentar "resolver" ou
  // insistir. Handoff sempre, sem depender do modelo perceber isso sozinho.
  // Qualquer tool futura (cancelar_pedido, alterar_item) que devolva o
  // mesmo formato `{erro:"confirmacao_humana_necessaria", motivo, ...}` é
  // coberta automaticamente aqui, sem precisar editar este arquivo de novo.
  const bloqueioAcaoAltoRisco = evidencias.find(
    (e) =>
      e.output &&
      typeof e.output === "object" &&
      (e.output as Record<string, unknown>).erro === "confirmacao_humana_necessaria",
  );
  if (bloqueioAcaoAltoRisco) {
    const detalhe = bloqueioAcaoAltoRisco.output as { motivo: MotivoBloqueioAcao; total?: number };
    const relatorioVazio: RelatorioInvestigacao = {
      sem_investigacao: false,
      afirmacoes: [],
      ambiguidade: { tipo: "nenhuma" },
      ferramentasChamadas: relatorio.ferramentasChamadas,
    };
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "handoff",
      relatorio: relatorioVazio,
      risco: "alto",
    });
    await criarHandoff(ctx.empresaId, {
      atendimento_id: ctx.atendimentoId,
      origem: "alto_risco",
      motivo: motivoBloqueioParaTexto(bloqueioAcaoAltoRisco.toolNome, detalhe),
      resumo: `Cliente confirmou uma ação (${bloqueioAcaoAltoRisco.toolNome}), mas a execução automática foi bloqueada pela configuração de risco da empresa (CLAUDE.md regra 6 — ação irreversível ou de alto impacto).`,
      acao_sugerida: "Revisar no painel e executar manualmente, ou aprovar com o cliente antes.",
      prioridade: "alta",
    });
    return { acao: "handoff", respostaTexto: null, confianca: "alta" };
  }

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

  // Confirmação de pedido criado (CLAUDE.md regra 6) — desvia do Atendente
  // (LLM) inteiramente: a mensagem final pro cliente é montada em código só
  // a partir do retorno real de "criar_pedido", nunca escrita livre por um
  // segundo LLM que poderia omitir/errar um item ou, no episódio real que
  // motivou isto, afirmar uma confirmação que nunca aconteceu de verdade
  // (ver agent/confirmacao-pedido.ts). Mesmo padrão de curto-circuito
  // determinístico já usado acima neste arquivo pros outros casos críticos.
  const pedidoConfirmadoAgora = evidencias.find(
    (e) =>
      e.toolNome === "criar_pedido" &&
      e.output &&
      typeof e.output === "object" &&
      (e.output as Record<string, unknown>).pedido_criado === true,
  );
  if (pedidoConfirmadoAgora) {
    const resumo = pedidoConfirmadoAgora.output as unknown as ResumoPedidoConfirmado;
    const texto = mensagemDePedidoConfirmado(resumo, params.usaEmoji);
    await registrarDecisao({
      ctx,
      confianca: "alta",
      cobertura: 0,
      acao: "responder",
      relatorio,
      risco: "alto",
    });
    return { acao: "responder", respostaTexto: texto, confianca: "alta" };
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
    risco: calcularRiscoMaximo(evidencias),
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
  const confirmacaoNaoVerificada = contemConfirmacaoDePedidoNaoVerificada(texto, evidencias);
  if (valorNaoVerificado || produtoNaoVerificado || promessaNaoSuportada || pedeCodigo || confirmacaoNaoVerificada) {
    const causa = valorNaoVerificado
      ? "continha um valor monetário não presente na evidência real coletada"
      : produtoNaoVerificado
        ? "citava em negrito um nome de produto que não bate com nenhum resultado real de busca no cardápio"
        : promessaNaoSuportada
          ? "prometia um formato/canal (PDF, arquivo, imagem, link) que o sistema não suporta"
          : pedeCodigo
            ? "pedia um número/código de pedido ao cliente, algo que o sistema resolve sozinho e o cliente não tem como fornecer"
            : "afirmava que o pedido foi confirmado/criado sem nenhuma chamada real de \"criar_pedido\" bem-sucedida nesta rodada";
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

  return { acao: decisao.acao, respostaTexto: texto, confianca };
}
