// Formato do "relatório interno" que o Investigador produz e o Atendente
// consome — ver plano da camada de IA, seção "Investigador/Atendente".
// Estruturado (JSON), não texto livre com citação arquivo:linha como no
// Eddy: aqui o domínio é transacional, function-calling estruturado é mais
// confiável do que regex sobre texto.

export type TipoAfirmacao =
  | "preco"
  | "disponibilidade"
  | "promocao"
  | "taxa"
  | "horario"
  | "politica"
  | "generico";

/** Tipos cujo dado é comercial/factual real — toda afirmação desses tipos
 * PRECISA de fonte_tool_execucao_id real, ou é tratada como possível
 * alucinação (ver confianca.ts). */
export const TIPOS_COMERCIAIS: ReadonlySet<TipoAfirmacao> = new Set([
  "preco",
  "disponibilidade",
  "promocao",
  "taxa",
  "horario",
  "politica",
]);

export interface Afirmacao {
  texto: string;
  tipo: TipoAfirmacao;
  /** Nome da ferramenta que embasou esta afirmação — null se não verificado. */
  fonte_tool: string | null;
  /** id real de uma linha em ia_execucoes — null se o Investigador citou um
   * id que não existia na lista de evidências reais (código nulifica, nunca
   * confia na palavra do modelo aqui). */
  fonte_tool_execucao_id: string | null;
}

export type TipoAmbiguidade = "nenhuma" | "multiplos_candidatos" | "informacao_insuficiente";

export interface RelatorioInvestigacao {
  // `sem_investigacao` foi REMOVIDO na tarefa 0082. Era um campo que o
  // próprio LLM preenchia e que, quando marcado, fazia early-return em todas
  // as redes de segurança e devolvia confiança "alta" com zero afirmações —
  // ou seja, o modelo podia desligar a pipeline inteira sozinho. Episódio
  // real: um "Sim" respondendo a uma pergunta do sistema foi classificado
  // como conversa social e a resposta saiu sem fato nenhum. Quem decide se a
  // mensagem é social agora é o interpretador, em código
  // (`ehSocial`, agent/interpretacao/mensagem.ts), e nesse caso a
  // investigação sequer é chamada.
  afirmacoes: Afirmacao[];
  ambiguidade: { tipo: TipoAmbiguidade; opcoes?: string[] };
  /** Quantas ferramentas foram de fato chamadas durante a investigação —
   * sinal determinístico (não depende do LLM se lembrar de marcar
   * ambiguidade) usado por computeConfianca para distinguir "conversa social,
   * nada a verificar" de "procurou e não achou nada". */
  ferramentasChamadas: number;
}

export type Confianca = "alta" | "media" | "baixa";

/** MVP 1 não tem tool de escrita — risco é sempre 'baixo' (ver plano,
 * Passo 5). O tipo já existe pra não precisar redesenhar quando o MVP 2
 * (criar_pedido etc) chegar. */
export type Risco = "baixo" | "medio" | "alto";

export type AcaoDecidida = "responder" | "pedir_esclarecimento" | "handoff";

export interface Decisao {
  acao: AcaoDecidida;
  motivoHandoff?: string;
}
