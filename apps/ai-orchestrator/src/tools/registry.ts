import { isPermitido, type ComportamentoJson, type IaPermissao, type NomeFerramenta } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import type { ToolDefinitionForLlm } from "../llm/client.js";

export interface ToolContext {
  empresaId: string;
  atendimentoId: string;
  clienteId: string;
  permissoes: Map<NomeFerramenta, IaPermissao>;
  /** Mensagem do cliente que originou este ciclo — usada só para auditoria
   * (ia_execucoes.mensagem_id), nunca para lógica de negócio da tool. */
  mensagemId: string | null;
  /** `ia_configuracoes.comportamento_json` desta empresa, já parseado —
   * mesmo objeto que chega ao Investigador. Tools de leitura de baixo risco
   * que decidem incluir/omitir um campo proativo (ex.: produto favorito em
   * `consultar_cliente`) consultam aqui em vez de reimplementar a busca. */
  comportamento: ComportamentoJson;
}

export interface ToolDefinicao<TInput = any, TOutput = any> {
  nome: NomeFerramenta;
  descricao: string;
  parametrosJsonSchema: ToolDefinitionForLlm["parametros"];
  risco: "baixo" | "medio" | "alto";
  /** Nunca chamar diretamente — sempre via executeTool(), que garante a
   * checagem de permissão e o log de auditoria. */
  executor: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

export interface ResultadoExecucaoTool {
  sucesso: boolean;
  output?: unknown;
  erro?: string;
  /** id da linha em ia_execucoes — usado pelo Investigador para citar a
   * fonte exata de cada afirmação (fonte_tool_execucao_id). null só quando o
   * próprio insert de auditoria falha (nunca deveria acontecer em operação normal). */
  execucaoId: string | null;
}

const registro = new Map<NomeFerramenta, ToolDefinicao>();

/** Registra uma ferramenta. Chamado uma vez por módulo de tools no boot do
 * processo (ver src/tools/index.ts) — nunca em runtime por requisição. */
export function registerTool(tool: ToolDefinicao): void {
  if (registro.has(tool.nome)) {
    throw new Error(`Ferramenta '${tool.nome}' já registrada — nome duplicado é erro de programação.`);
  }
  registro.set(tool.nome, tool);
}

/** Ferramentas visíveis ao Investigador nesta empresa — já filtradas por
 * permissão (CLAUDE.md regra 2: ausência de permissão = nem aparece como
 * opção pro modelo, não é só "recusada se chamada"). */
export function getToolsForEmpresa(permissoes: Map<NomeFerramenta, IaPermissao>): ToolDefinicao[] {
  return Array.from(registro.values()).filter((tool) => isPermitido(permissoes, tool.nome));
}

export function getToolDefinitionsForLlm(permissoes: Map<NomeFerramenta, IaPermissao>): ToolDefinitionForLlm[] {
  return getToolsForEmpresa(permissoes).map((tool) => ({
    nome: tool.nome,
    descricao: tool.descricao,
    parametros: tool.parametrosJsonSchema,
  }));
}

async function logExecucao(params: {
  ctx: ToolContext;
  toolNome: string;
  input: unknown;
  output: unknown;
  sucesso: boolean;
  erro: string | null;
  duracaoMs: number;
}): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("ia_execucoes")
    .insert({
      empresa_id: params.ctx.empresaId,
      atendimento_id: params.ctx.atendimentoId,
      mensagem_id: params.ctx.mensagemId,
      fase: "execucao",
      tool_nome: params.toolNome,
      tool_input_json: params.input as object,
      tool_output_json: params.output as object,
      sucesso: params.sucesso,
      erro: params.erro,
      duracao_ms: params.duracaoMs,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * Único ponto de execução de uma ferramenta. Garante, sempre, nesta ordem:
 * 1. a ferramenta existe;
 * 2. está permitida para esta empresa (isPermitido — nunca `?? true`);
 * 3. a execução é auditada em ia_execucoes, sucesso ou falha.
 *
 * Nenhum outro caminho de código deve chamar `tool.executor` diretamente.
 */
export async function executeTool(
  nome: NomeFerramenta,
  input: unknown,
  ctx: ToolContext,
): Promise<ResultadoExecucaoTool> {
  const inicio = Date.now();
  const tool = registro.get(nome);

  if (!tool || !isPermitido(ctx.permissoes, nome)) {
    const execucaoId = await logExecucao({
      ctx,
      toolNome: nome,
      input,
      output: null,
      sucesso: false,
      erro: "ferramenta_nao_permitida",
      duracaoMs: Date.now() - inicio,
    });
    return { sucesso: false, erro: "ferramenta_nao_permitida", execucaoId };
  }

  try {
    const output = await tool.executor(input, ctx);
    const execucaoId = await logExecucao({
      ctx,
      toolNome: nome,
      input,
      output,
      sucesso: true,
      erro: null,
      duracaoMs: Date.now() - inicio,
    });
    return { sucesso: true, output, execucaoId };
  } catch (erro) {
    const mensagemErro = erro instanceof Error ? erro.message : "erro_desconhecido";
    const execucaoId = await logExecucao({
      ctx,
      toolNome: nome,
      input,
      output: null,
      sucesso: false,
      erro: mensagemErro,
      duracaoMs: Date.now() - inicio,
    });
    return { sucesso: false, erro: mensagemErro, execucaoId };
  }
}
