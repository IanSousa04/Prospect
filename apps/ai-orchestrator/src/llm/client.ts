import { env } from "../lib/env.js";
import { createDeepSeekChatModel } from "./deepseek.js";
import type { ChatModel } from "./types.js";

// Ponto único de configuração do provedor de LLM. Trocar de provedor no
// futuro significa mudar só este arquivo — nenhum outro módulo conhece
// "DeepSeek" diretamente (ver ADR implícita no plano da camada de IA).
let instancia: ChatModel | null = null;

export function getChatModel(): ChatModel {
  if (!instancia) {
    instancia = createDeepSeekChatModel({
      apiKey: env.deepseekApiKey,
      baseUrl: env.deepseekBaseUrl,
    });
  }
  return instancia;
}

export type { ChatModel, ChatMessage, ChatCompletionOptions, ChatCompletionResult, ToolDefinitionForLlm, ToolCallRequest } from "./types.js";
