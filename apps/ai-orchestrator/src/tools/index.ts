// Importar por efeito colateral registra cada ferramenta no registry.
// Todo módulo de tools novo (pedido de escrita — Passo do MVP 2) precisa ser
// importado aqui pra existir de verdade.
import "./conhecimento.js";
import "./catalogo.js";
import "./cliente.js";
import "./pedido.js";
import "./carrinho.js";
import "./operacao.js";

export { executeTool, getToolDefinitionsForLlm, getToolsForEmpresa, getRiscoFerramenta, registerTool } from "./registry.js";
export type { ToolContext, ToolDefinicao, ResultadoExecucaoTool } from "./registry.js";
