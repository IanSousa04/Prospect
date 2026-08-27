// Interface de provedor de LLM — trocável por design. Nenhum outro módulo
// deste app deve chamar a API de um provedor específico diretamente; sempre
// através de um ChatModel obtido aqui.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  nome: string;
  argumentosJson: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Só presente quando role === 'assistant' e o modelo decidiu chamar tools. */
  toolCalls?: ToolCallRequest[];
  /** Só presente quando role === 'tool' — id do ToolCallRequest respondido. */
  toolCallId?: string;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinitionForLlm {
  nome: string;
  descricao: string;
  parametros: ToolParameterSchema;
}

export interface ChatCompletionOptions {
  tools?: ToolDefinitionForLlm[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Força o modelo a responder só com um objeto JSON (sem tools). Usado
   * pelo Investigador para produzir o relatório estruturado final. */
  jsonMode?: boolean;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCallRequest[] | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export interface ChatModel {
  chatCompletion(messages: ChatMessage[], opts?: ChatCompletionOptions): Promise<ChatCompletionResult>;
}
