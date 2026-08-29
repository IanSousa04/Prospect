// Roteamento de perguntas (tarefa 0082) — o LLM rotula o ASSUNTO, o código
// escolhe e executa a ferramenta.
//
// Motivação direta: numa conversa real, o cliente disse "É para entrega" e a
// IA respondeu "no momento a gente não tá fazendo entregas" com ZERO
// ferramentas chamadas naquele turno — enquanto a configuração da empresa
// oferecia entrega. Não foi um erro de raciocínio; foi ausência de qualquer
// obrigação de consultar antes de afirmar.
//
// Com o roteamento, nenhuma pergunta de negócio é respondida sem pelo menos
// uma execução real por trás. Se a ferramenta rodar e vier vazia, isso vira
// um fato ("não há X cadastrado") e a IA admite a lacuna — nunca improvisa.
import type { NomeFerramenta } from "@prospect/shared";
import type { ToolContext } from "../../tools/index.js";
import type { EvidenciaColetada } from "../investigador.js";
import { erroDaExecucao, type FalhaDeFerramenta, type PortasDoWorkflow } from "../portas.js";
import type { AssuntoPerguntado } from "./mensagem.js";

/** Ferramentas obrigatórias por assunto. Nunca é o modelo que escolhe.
 *
 * Duas decisões que valem comentário:
 *
 * - `area_entrega` consulta `consultar_regiao` E `consultar_taxa`. As duas
 *   leem `conhecimento_itens` filtrando por categoria fixa, e a empresa real
 *   cadastrou a área de entrega na categoria `entrega` (que é a de
 *   `consultar_taxa`), não em `regiao`. Consultar só uma devolvia vazio pra
 *   uma informação que existia.
 * - `opcoes_atendimento` consulta SÓ a configuração, e de propósito: ela é a
 *   fonte da verdade sobre o que a loja oferece (decisão do usuário na
 *   tarefa 0082). Incluir `buscar_conhecimento` aqui traria de volta o texto
 *   livre que hoje contradiz a config sobre formas de pagamento. */
export const TOOLS_POR_ASSUNTO: Record<AssuntoPerguntado, NomeFerramenta[]> = {
  cardapio: ["buscar_produtos", "buscar_combos"],
  preco: ["buscar_produtos"],
  adicionais: ["buscar_adicionais"],
  combos: ["buscar_combos"],
  recomendacao: ["buscar_recomendacoes"],
  horario: ["consultar_horario"],
  taxa_entrega: ["consultar_taxa"],
  area_entrega: ["consultar_regiao", "consultar_taxa"],
  opcoes_atendimento: ["consultar_opcoes_atendimento"],
  prazo_entrega: ["consultar_prazo_entrega"],
  politica: ["consultar_politica"],
  status_pedido: ["consultar_pedido"],
  historico: ["consultar_historico"],
  dados_do_cliente: ["consultar_cliente"],
  outro: ["buscar_conhecimento"],
};

/** Ferramentas que exigem um produto de referência — sem ele não há o que
 * consultar, e o assunto fica sem resposta em vez de ser chamado com um id
 * inventado. */
const EXIGEM_PRODUTO = new Set<NomeFerramenta>(["buscar_adicionais", "buscar_recomendacoes"]);

export interface ResultadoRoteamento {
  evidencias: EvidenciaColetada[];
  falhas: FalhaDeFerramenta[];
  /** Assuntos cuja ferramenta rodou mas não trouxe nada, ou que não puderam
   * ser consultados. Viram o fato "não tenho essa informação cadastrada",
   * que é o que autoriza a IA a admitir a lacuna honestamente. */
  assuntosSemResposta: AssuntoPerguntado[];
}

function saidaEhVazia(output: unknown): boolean {
  if (!output || typeof output !== "object") return true;
  const obj = output as Record<string, unknown>;
  if (typeof obj.erro === "string") return true;
  for (const campo of ["resultados", "grupos", "recomendacoes", "pedidos"]) {
    if (campo in obj && Array.isArray(obj[campo])) return (obj[campo] as unknown[]).length === 0;
  }
  return false;
}

function entradaPara(tool: NomeFerramenta, produtoDeReferencia: string | null, termoLivre: string): unknown {
  if (EXIGEM_PRODUTO.has(tool)) return { produto_id: produtoDeReferencia };
  if (tool === "buscar_conhecimento") return { termo: termoLivre };
  // As demais listam tudo que está ativo (sem termo) ou não têm parâmetro —
  // listar o cardápio inteiro garante evidência pra qualquer pergunta sobre
  // produto, inclusive preço de um item que o cliente citou só de passagem.
  return {};
}

/**
 * Executa, para cada assunto perguntado, as ferramentas obrigatórias dele.
 * Ferramenta repetida entre assuntos roda uma vez só.
 */
export async function resolverPerguntas(params: {
  perguntas: AssuntoPerguntado[];
  ctx: ToolContext;
  portas: PortasDoWorkflow;
  /** Produto para os assuntos que precisam de um (`adicionais`,
   * `recomendacao`) — último item adicionado, item do carrinho ou
   * `ultimo_produto_mencionado` da sessão. */
  produtoDeReferencia?: string | null;
  /** Texto da mensagem do cliente, usado como termo de `buscar_conhecimento`
   * no assunto `outro`. */
  termoLivre: string;
}): Promise<ResultadoRoteamento> {
  const { perguntas, ctx, portas, termoLivre } = params;
  const produtoDeReferencia = params.produtoDeReferencia ?? null;

  const resultado: ResultadoRoteamento = { evidencias: [], falhas: [], assuntosSemResposta: [] };
  if (perguntas.length === 0) return resultado;

  const jaExecutadas = new Map<NomeFerramenta, unknown>();

  for (const assunto of perguntas) {
    let assuntoTeveResposta = false;

    for (const tool of TOOLS_POR_ASSUNTO[assunto]) {
      if (EXIGEM_PRODUTO.has(tool) && !produtoDeReferencia) continue;

      if (jaExecutadas.has(tool)) {
        if (!saidaEhVazia(jaExecutadas.get(tool))) assuntoTeveResposta = true;
        continue;
      }

      const execucao = await portas.executar(tool, entradaPara(tool, produtoDeReferencia, termoLivre), ctx);
      if (execucao.sucesso && execucao.execucaoId) {
        resultado.evidencias.push({ execucaoId: execucao.execucaoId, toolNome: tool, output: execucao.output });
      }
      const erro = erroDaExecucao(execucao);
      if (erro) {
        resultado.falhas.push({ tool, erro });
        jaExecutadas.set(tool, { erro });
        continue;
      }

      jaExecutadas.set(tool, execucao.output);
      if (!saidaEhVazia(execucao.output)) assuntoTeveResposta = true;
    }

    if (!assuntoTeveResposta) resultado.assuntosSemResposta.push(assunto);
  }

  return resultado;
}
