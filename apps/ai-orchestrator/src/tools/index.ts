// Importar por efeito colateral registra cada ferramenta no registry.
// A IA agora é só leitura: catálogo, cliente, pedido (status), operação,
// conhecimento e prazo — nenhuma ferramenta muta estado transacional.
import "./conhecimento.js";
import "./catalogo.js";
import "./cliente.js";
import "./pedido.js";
import "./operacao.js";
import "./prazo.js";

export { executeTool, getToolDefinitionsForLlm, getToolsForEmpresa, registerTool } from "./registry.js";
export type { ToolContext, ToolDefinicao, ResultadoExecucaoTool } from "./registry.js";
