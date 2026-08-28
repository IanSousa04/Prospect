import { env } from "../lib/env.js";
import { createDeepSeekChatModel } from "./deepseek.js";
import type { ChatModel } from "./types.js";

// Ponto único de configuração do provedor de LLM. Trocar de provedor no
// futuro significa mudar só este arquivo — nenhum outro módulo conhece
// "DeepSeek" diretamente (ver ADR implícita no plano da camada de IA).
let instancia: ChatModel | null = null;

/** Acumulador de uso de tokens — nenhuma tool de produção lia isso antes
 * (a API já devolvia `usage` por chamada, mas nada somava). Existe pra
 * scripts de eval/simulação medirem custo real de uma rodada
 * (`resetUsoAcumulado`/`lerUsoAcumulado`); não afeta o comportamento do
 * pipeline real, só observa. */
let usoAcumulado = { promptTokens: 0, completionTokens: 0 };

export function resetUsoAcumulado(): void {
  usoAcumulado = { promptTokens: 0, completionTokens: 0 };
}

export function lerUsoAcumulado(): { promptTokens: number; completionTokens: number } {
  return { ...usoAcumulado };
}

export function getChatModel(): ChatModel {
  if (!instancia) {
    const modeloReal = createDeepSeekChatModel({
      apiKey: env.deepseekApiKey,
      baseUrl: env.deepseekBaseUrl,
    });
    instancia = {
      async chatCompletion(messages, opts) {
        const resultado = await modeloReal.chatCompletion(messages, opts);
        if (resultado.usage) {
          usoAcumulado.promptTokens += resultado.usage.promptTokens;
          usoAcumulado.completionTokens += resultado.usage.completionTokens;
        }
        return resultado;
      },
    };
  }
  return instancia;
}

export type { ChatModel, ChatMessage, ChatCompletionOptions, ChatCompletionResult, ToolDefinitionForLlm, ToolCallRequest } from "./types.js";
