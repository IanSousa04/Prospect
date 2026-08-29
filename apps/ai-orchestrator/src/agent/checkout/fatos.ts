// Fatos verificados — a ÚNICA coisa que o Atendente pode afirmar. Tudo aqui
// é derivado do estado relido do banco e de execuções reais de ferramenta;
// nada vem de paráfrase de modelo, e nenhuma afirmação é gerada sem uma linha
// de `ia_execucoes` por trás (CLAUDE.md regra 1).
//
// Nasceu no checkout (tarefa 0081) e na 0082 passou a cobrir a conversa
// inteira: itens que o cliente citou e não existem no cardápio, assuntos
// perguntados sem resposta cadastrada, e o que a loja de fato oferece
// (`consultar_opcoes_atendimento`). É esse conjunto que o gate de lastro
// (agent/lastro.ts) usa para decidir se o texto pode sair.
import type {
  EnderecoEntrega,
  EstadoCheckout,
  FormaPagamento,
  InformacaoPendente,
  OrderContext,
  TipoEntrega,
} from "@prospect/shared";
import { calcularSubtotal } from "@prospect/shared";
import type { EvidenciaColetada } from "../investigador.js";
import type { Afirmacao } from "../types.js";
import type { DadoNaoAproveitado } from "./transicoes.js";
import type { FalhaDeFerramenta } from "../portas.js";
import type { AssuntoPerguntado } from "../interpretacao/mensagem.js";
import type { ResultadoResolucaoItens } from "../interpretacao/itens.js";
import type { FatoParaLastro } from "../lastro.js";

export interface FatosVerificados {
  estado_checkout: EstadoCheckout;
  pedido_criado: boolean;
  /** Identificador interno do pedido real. NUNCA aparece na mensagem ao
   * cliente (CLAUDE.md regra 3) — existe pra provar, dentro do sistema, que
   * a criação aconteceu. */
  pedido_id: string | null;
  handoff_realizado: boolean;
  handoff_id: string | null;
  itens: Array<{ nome_produto: string; quantidade: number }>;
  subtotal: number;
  tipo_entrega: TipoEntrega | null;
  endereco: EnderecoEntrega | null;
  forma_pagamento: FormaPagamento | null;
  pendencias: InformacaoPendente[];
  falhas_de_ferramenta: FalhaDeFerramenta[];
  dados_nao_aproveitados: DadoNaoAproveitado[];
  /** Itens que o cliente citou e que NÃO existem no cardápio (tarefa 0082).
   * Vira fato explícito — foi a ausência dele que deixou a IA responder
   * "temos várias opções" logo depois de uma busca vazia. */
  itens_inexistentes: string[];
  /** Citados e ambíguos: mais de um produto plausível, com os nomes reais
   * pra pergunta de esclarecimento. */
  itens_ambiguos: Array<{ texto: string; candidatos: string[] }>;
  /** Adicionais citados que não existem no produto escolhido. */
  adicionais_inexistentes: string[];
  /** Assuntos perguntados cuja ferramenta rodou e não trouxe nada — é o que
   * autoriza a IA a admitir a lacuna honestamente (decisão do usuário na
   * tarefa 0082), em vez de improvisar. */
  assuntos_sem_resposta: AssuntoPerguntado[];
  /** O que a loja oferece, lido da configuração via
   * `consultar_opcoes_atendimento`. Fonte da verdade sobre disponibilidade. */
  opcoes_atendimento: { tipos_entrega: TipoEntrega[]; formas_pagamento: FormaPagamento[] } | null;
}

/** Descrição em português de cada pendência — reaproveitada tanto pelas
 * afirmações passadas ao Atendente quanto pela mensagem determinística de
 * fallback do TransactionTruthGate. */
export const NOME_PENDENCIA: Record<InformacaoPendente, string> = {
  produtos: "escolher os produtos do pedido",
  tipo_entrega: "dizer se é entrega ou retirada",
  endereco: "informar o endereço de entrega",
  forma_pagamento: "definir a forma de pagamento",
  confirmacao_final: "confirmar o resumo final do pedido",
};

const NOME_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  dinheiro: "dinheiro",
  cartao_credito: "cartão de crédito",
  cartao_debito: "cartão de débito",
  pix: "Pix",
  outro: "a forma combinada",
};

/** Tradução dos erros técnicos de ferramenta para linguagem de atendimento —
 * nenhum código de erro cru pode chegar ao cliente (CLAUDE.md regra 3). */
const EXPLICACAO_FALHA: Record<string, string> = {
  tipo_entrega_nao_oferecido: "o tipo de entrega escolhido não é oferecido por esta loja",
  forma_pagamento_nao_aceita: "a forma de pagamento escolhida não é aceita por esta loja",
  confirmacao_expirada_ou_invalida: "o resumo anterior do pedido não vale mais e precisa ser mostrado de novo",
  confirmacao_nao_registrada: "a confirmação do pedido não foi registrada",
  pedido_incompleto: "ainda falta informação para fechar o pedido",
  estado_nao_mudou: "o sistema não conseguiu registrar essa informação",
  ferramenta_nao_permitida: "esta loja não autorizou essa ação automática",
};

function formatarReal(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

function formatarEndereco(endereco: EnderecoEntrega): string {
  const complemento = endereco.complemento ? `, ${endereco.complemento}` : "";
  return `${endereco.rua}, ${endereco.numero}${complemento} - ${endereco.bairro}, ${endereco.cidade}`;
}

/** Lê `consultar_opcoes_atendimento` das evidências desta rodada. É a fonte
 * da verdade sobre disponibilidade (decisão do usuário, tarefa 0082) — sem a
 * ferramenta ter rodado, o fato simplesmente não existe e a IA não pode
 * afirmar nada sobre o que a loja oferece. */
function opcoesDeAtendimento(evidencias: EvidenciaColetada[]): FatosVerificados["opcoes_atendimento"] {
  for (let i = evidencias.length - 1; i >= 0; i--) {
    const e = evidencias[i]!;
    if (e.toolNome !== "consultar_opcoes_atendimento" || !e.output || typeof e.output !== "object") continue;
    const out = e.output as Record<string, unknown>;
    const tipos = Array.isArray(out.tipos_entrega_oferecidos) ? (out.tipos_entrega_oferecidos as TipoEntrega[]) : [];
    const formas = Array.isArray(out.formas_pagamento_aceitas) ? (out.formas_pagamento_aceitas as FormaPagamento[]) : [];
    return { tipos_entrega: tipos, formas_pagamento: formas };
  }
  return null;
}

export function montarFatosVerificados(params: {
  estado: EstadoCheckout;
  pedido: OrderContext;
  pendencias: InformacaoPendente[];
  pedidoId?: string | null;
  handoffId?: string | null;
  falhas?: FalhaDeFerramenta[];
  dadosNaoAproveitados?: DadoNaoAproveitado[];
  itensResolvidos?: ResultadoResolucaoItens | null;
  assuntosSemResposta?: AssuntoPerguntado[];
  evidencias?: EvidenciaColetada[];
}): FatosVerificados {
  const pedidoId = params.pedidoId ?? null;
  const handoffId = params.handoffId ?? null;
  const itensResolvidos = params.itensResolvidos ?? null;

  return {
    itens_inexistentes: itensResolvidos?.naoEncontrados ?? [],
    itens_ambiguos: itensResolvidos?.ambiguos ?? [],
    adicionais_inexistentes: (itensResolvidos?.adicionados ?? []).flatMap((i) => i.adicionais_ignorados),
    assuntos_sem_resposta: params.assuntosSemResposta ?? [],
    opcoes_atendimento: opcoesDeAtendimento(params.evidencias ?? []),
    estado_checkout: params.estado,
    pedido_criado: pedidoId !== null,
    pedido_id: pedidoId,
    handoff_realizado: handoffId !== null,
    handoff_id: handoffId,
    itens: params.pedido.itens.map((item) => ({ nome_produto: item.nome_produto, quantidade: item.quantidade })),
    subtotal: calcularSubtotal(params.pedido.itens),
    tipo_entrega: params.pedido.tipo_entrega,
    endereco: params.pedido.endereco,
    forma_pagamento: params.pedido.forma_pagamento,
    pendencias: params.pendencias,
    falhas_de_ferramenta: params.falhas ?? [],
    dados_nao_aproveitados: params.dadosNaoAproveitados ?? [],
  };
}

/** Evidência real que sustenta os fatos de carrinho desta rodada — a mais
 * recente entre consulta e mutações. `null` quando nenhuma ferramenta de
 * carrinho rodou: nesse caso simplesmente não afirmamos nada sobre o
 * carrinho, em vez de afirmar sem fonte. */
function evidenciaDeCarrinho(evidencias: EvidenciaColetada[]): EvidenciaColetada | null {
  const relevantes = new Set([
    "consultar_carrinho",
    "adicionar_ao_carrinho",
    "remover_do_carrinho",
    "atualizar_item_carrinho",
    "definir_tipo_entrega",
    "definir_endereco_entrega",
    "definir_forma_pagamento",
  ]);
  for (let i = evidencias.length - 1; i >= 0; i--) {
    const evidencia = evidencias[i]!;
    if (relevantes.has(evidencia.toolNome)) return evidencia;
  }
  return null;
}

/** Evidência mais recente de uma ferramenta específica — usada pelos fatos
 * que nascem fora do carrinho (catálogo, configuração, operação). */
function evidenciaDe(evidencias: EvidenciaColetada[], toolNome: string): EvidenciaColetada | null {
  for (let i = evidencias.length - 1; i >= 0; i--) {
    if (evidencias[i]!.toolNome === toolNome) return evidencias[i]!;
  }
  return null;
}

const NOME_ASSUNTO: Record<AssuntoPerguntado, string> = {
  cardapio: "o cardápio",
  preco: "preço",
  adicionais: "adicionais deste produto",
  combos: "combos",
  recomendacao: "recomendações para este produto",
  horario: "horário de funcionamento",
  taxa_entrega: "taxa de entrega",
  area_entrega: "área de entrega",
  opcoes_atendimento: "formas de entrega e pagamento",
  prazo_entrega: "prazo de entrega",
  politica: "políticas da loja",
  status_pedido: "status do pedido",
  historico: "histórico de pedidos",
  dados_do_cliente: "cadastro do cliente",
  outro: "isso",
};

function evidenciaDeCriacao(evidencias: EvidenciaColetada[]): EvidenciaColetada | null {
  for (let i = evidencias.length - 1; i >= 0; i--) {
    const evidencia = evidencias[i]!;
    if (
      evidencia.toolNome === "criar_pedido" &&
      evidencia.output &&
      typeof evidencia.output === "object" &&
      (evidencia.output as Record<string, unknown>).pedido_criado === true
    ) {
      return evidencia;
    }
  }
  return null;
}

/**
 * Converte os fatos verificados em `Afirmacao[]` — o formato que o Atendente
 * já consome (agent/atendente.ts), sem mudar a interface dele. Toda
 * afirmação carrega o `fonte_tool_execucao_id` de uma execução real; sem
 * evidência correspondente, o fato simplesmente não é afirmado.
 */
export function fatosParaAfirmacoes(fatos: FatosVerificados, evidencias: EvidenciaColetada[]): Afirmacao[] {
  const afirmacoes: Afirmacao[] = [];
  const carrinho = evidenciaDeCarrinho(evidencias);
  const criacao = evidenciaDeCriacao(evidencias);

  // Fatos que vêm de fora do carrinho (tarefa 0082). Vêm PRIMEIRO porque são
  // os que impedem as duas alucinações mais graves observadas: afirmar que um
  // produto inexistente existe, e afirmar uma regra de disponibilidade que
  // contradiz a configuração da loja.
  const buscaCatalogo = evidenciaDe(evidencias, "buscar_produtos") ?? evidenciaDe(evidencias, "buscar_combos");
  if (buscaCatalogo) {
    for (const texto of fatos.itens_inexistentes) {
      afirmacoes.push({
        texto: `Não existe nenhum produto chamado "${texto}" no cardápio desta loja.`,
        tipo: "disponibilidade",
        fonte_tool: buscaCatalogo.toolNome,
        fonte_tool_execucao_id: buscaCatalogo.execucaoId,
      });
    }
    for (const ambiguo of fatos.itens_ambiguos) {
      afirmacoes.push({
        texto: `Existe mais de um produto que pode ser "${ambiguo.texto}": ${ambiguo.candidatos.join(", ")}. É preciso o cliente escolher qual.`,
        tipo: "disponibilidade",
        fonte_tool: buscaCatalogo.toolNome,
        fonte_tool_execucao_id: buscaCatalogo.execucaoId,
      });
    }
  }

  const adicionais = evidenciaDe(evidencias, "buscar_adicionais");
  if (adicionais && fatos.adicionais_inexistentes.length > 0) {
    afirmacoes.push({
      texto: `Estes adicionais não existem para o produto escolhido: ${fatos.adicionais_inexistentes.join(", ")}.`,
      tipo: "disponibilidade",
      fonte_tool: adicionais.toolNome,
      fonte_tool_execucao_id: adicionais.execucaoId,
    });
  }

  const opcoes = evidenciaDe(evidencias, "consultar_opcoes_atendimento");
  if (opcoes && fatos.opcoes_atendimento) {
    const tipos = fatos.opcoes_atendimento.tipos_entrega;
    if (tipos.length > 0) {
      afirmacoes.push({
        texto: `Esta loja atende por: ${tipos.map((t) => (t === "entrega" ? "entrega" : "retirada no local")).join(" e ")}.`,
        tipo: "politica",
        fonte_tool: opcoes.toolNome,
        fonte_tool_execucao_id: opcoes.execucaoId,
      });
    }
    const formas = fatos.opcoes_atendimento.formas_pagamento;
    if (formas.length > 0) {
      afirmacoes.push({
        texto: `Formas de pagamento aceitas por esta loja: ${formas.map((f) => NOME_FORMA_PAGAMENTO[f]).join(", ")}. O pagamento é feito na entrega ou na retirada, nunca por aqui.`,
        tipo: "politica",
        fonte_tool: opcoes.toolNome,
        fonte_tool_execucao_id: opcoes.execucaoId,
      });
    }
  }

  // Assunto perguntado cuja ferramenta rodou e não trouxe nada. Vira fato
  // explícito pra IA admitir a lacuna (decisão do usuário) em vez de
  // improvisar uma resposta plausível.
  for (const assunto of fatos.assuntos_sem_resposta) {
    const fonte = evidenciaDe(evidencias, "buscar_conhecimento") ?? buscaCatalogo ?? carrinho;
    if (!fonte) continue;
    afirmacoes.push({
      texto: `Não há informação cadastrada nesta loja sobre ${NOME_ASSUNTO[assunto]} — o sistema consultou e não encontrou nada.`,
      tipo: "generico",
      fonte_tool: fonte.toolNome,
      fonte_tool_execucao_id: fonte.execucaoId,
    });
  }

  if (criacao && fatos.pedido_criado) {
    const resumoItens = fatos.itens.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(", ");
    afirmacoes.push({
      texto: `O pedido foi criado de verdade no sistema e já está registrado para a operação${
        resumoItens ? ` (${resumoItens})` : ""
      }.`,
      tipo: "generico",
      fonte_tool: criacao.toolNome,
      fonte_tool_execucao_id: criacao.execucaoId,
    });
    return afirmacoes;
  }

  if (carrinho) {
    if (fatos.itens.length > 0) {
      const resumoItens = fatos.itens.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(", ");
      afirmacoes.push({
        texto: `O carrinho do pedido em construção tem: ${resumoItens}. Subtotal: R$ ${formatarReal(fatos.subtotal)}.`,
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }

    if (fatos.tipo_entrega) {
      afirmacoes.push({
        texto:
          fatos.tipo_entrega === "entrega"
            ? "Já está registrado que este pedido é para entrega."
            : "Já está registrado que este pedido é para retirada no local.",
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }

    if (fatos.endereco) {
      afirmacoes.push({
        texto: `O endereço de entrega já registrado é: ${formatarEndereco(fatos.endereco)}.`,
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }

    if (fatos.forma_pagamento) {
      afirmacoes.push({
        texto: `A forma de pagamento já registrada para este pedido é ${NOME_FORMA_PAGAMENTO[fatos.forma_pagamento]}.`,
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }

    const pendenciasReais = fatos.pendencias.filter((p) => p !== "confirmacao_final");
    if (pendenciasReais.length > 0) {
      afirmacoes.push({
        texto: `Para fechar o pedido ainda falta: ${pendenciasReais.map((p) => NOME_PENDENCIA[p]).join(", ")}.`,
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    } else if (fatos.pendencias.includes("confirmacao_final")) {
      afirmacoes.push({
        texto: "O pedido está completo e só falta o cliente confirmar este resumo — nada foi criado ainda.",
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }

    for (const falha of fatos.falhas_de_ferramenta) {
      const explicacao = EXPLICACAO_FALHA[falha.erro];
      if (!explicacao) continue;
      afirmacoes.push({
        texto: `Não foi possível concluir essa etapa agora: ${explicacao}.`,
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }

    for (const dado of fatos.dados_nao_aproveitados) {
      afirmacoes.push({
        texto:
          dado === "endereco_incompleto"
            ? "O endereço informado está incompleto — faltam rua, número, bairro ou cidade."
            : "O pedido é para retirada no local, então nenhum endereço de entrega é necessário.",
        tipo: "generico",
        fonte_tool: carrinho.toolNome,
        fonte_tool_execucao_id: carrinho.execucaoId,
      });
    }
  }

  return afirmacoes;
}

/**
 * Mensagem montada 100% em código a partir dos fatos — último recurso do
 * TransactionTruthGate quando o Atendente insiste em afirmar algo sem
 * evidência. Nunca afirma criação de pedido (se houvesse `pedido_id`, o
 * caminho seria a mensagem fixa de confirmação); só diz o que de fato falta,
 * pra o cliente nunca ficar sem resposta (o handoff mudo que esta tarefa
 * elimina).
 */
export function mensagemDeterministicaDeFallback(fatos: FatosVerificados, usaEmoji: boolean): string {
  const pendenciasReais = fatos.pendencias.filter((p) => p !== "confirmacao_final");

  let base: string;
  if (fatos.itens.length === 0) {
    base = "Ainda não tem nenhum item no seu pedido. Me diz o que você quer que eu já começo a montar!";
  } else if (pendenciasReais.length > 0) {
    base = `Seu pedido ainda não foi fechado — falta ${pendenciasReais
      .map((p) => NOME_PENDENCIA[p])
      .join(" e ")}. Me passa isso que eu finalizo pra você.`;
  } else {
    const resumoItens = fatos.itens.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(", ");
    base = `Seu pedido ainda não foi confirmado. Ficou assim: ${resumoItens}, total de R$ ${formatarReal(
      fatos.subtotal,
    )}. Posso confirmar?`;
  }

  return usaEmoji ? `${base} 🙂` : base;
}


/**
 * Lista de fatos como o gate de lastro (agent/lastro.ts) precisa dela: o
 * texto de cada afirmação verificada, mais os marcadores determinísticos de
 * inexistência, que permitem detectar contradição sem gastar LLM.
 */
export function fatosParaLastro(fatos: FatosVerificados, afirmacoes: Afirmacao[]): FatoParaLastro[] {
  const lista: FatoParaLastro[] = afirmacoes.map((a) => ({ texto: a.texto }));

  for (const texto of fatos.itens_inexistentes) {
    lista.push({
      texto: `Não existe nenhum produto chamado "${texto}" no cardápio desta loja.`,
      negaExistenciaDe: texto,
    });
  }

  return lista;
}
