// Portas do pipeline determinístico — todo acesso a estado e toda execução
// de ferramenta passam por aqui.
//
// Existe por um motivo só: permitir rodar o pipeline inteiro (resolução de
// itens, mutações de checkout, roteamento de perguntas, criação de pedido)
// no gabarito determinístico, sem banco, sem LLM e sem rede. Em produção é
// sempre `PORTAS_REAIS`.
//
// Vive num módulo neutro, e não dentro de `checkout/`, porque agora tem dois
// consumidores em pastas diferentes (`checkout/transicoes.ts` e
// `interpretacao/`) — deixá-lo em um dos dois criaria dependência circular
// entre eles.
import type { AguardandoConfirmacao, NomeFerramenta, OrderContext, UltimoPedidoCriado } from "@prospect/shared";
import { executeTool, type ResultadoExecucaoTool, type ToolContext } from "../tools/index.js";
import {
  carregarPedidoEmConstrucao,
  salvarPedidoEmConstrucao,
  carregarConfirmacaoPendente,
  salvarConfirmacaoPendente,
  carregarUltimoPedidoCriado,
} from "./sessao.js";
import { registrarInvariante, type EventoInvariante } from "./checkout/invariantes.js";

export interface PortasDoWorkflow {
  executar: (nome: NomeFerramenta, input: unknown, ctx: ToolContext) => Promise<ResultadoExecucaoTool>;
  carregarPedido: (ctx: ToolContext) => Promise<OrderContext>;
  carregarConfirmacao: (ctx: ToolContext) => Promise<AguardandoConfirmacao | null>;
  carregarUltimoPedidoCriado: (ctx: ToolContext) => Promise<UltimoPedidoCriado | null>;
  salvarPedido: (ctx: ToolContext, pedido: OrderContext) => Promise<void>;
  salvarConfirmacao: (ctx: ToolContext, confirmacao: AguardandoConfirmacao | undefined) => Promise<void>;
  registrarInvariante: (ctx: ToolContext, evento: EventoInvariante, detalhe: Record<string, unknown>) => Promise<void>;
  agora: () => Date;
}

export const PORTAS_REAIS: PortasDoWorkflow = {
  executar: executeTool,
  carregarPedido: carregarPedidoEmConstrucao,
  carregarConfirmacao: carregarConfirmacaoPendente,
  carregarUltimoPedidoCriado,
  salvarPedido: salvarPedidoEmConstrucao,
  salvarConfirmacao: salvarConfirmacaoPendente,
  registrarInvariante,
  agora: () => new Date(),
};

/** Erro de negócio devolvido por uma ferramenta (ela roda com sucesso e
 * devolve `{erro: "..."}`) ou falha de execução. `null` quando deu tudo
 * certo. Usado por todas as etapas do pipeline pra decidir se podem
 * avançar. */
export function erroDaExecucao(execucao: ResultadoExecucaoTool): string | null {
  if (!execucao.sucesso) return execucao.erro ?? "erro_desconhecido";
  const output = execucao.output;
  if (output && typeof output === "object" && typeof (output as Record<string, unknown>).erro === "string") {
    return (output as Record<string, unknown>).erro as string;
  }
  return null;
}

export interface FalhaDeFerramenta {
  tool: NomeFerramenta;
  erro: string;
}
