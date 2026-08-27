import type { ChatCompletionOptions, ChatCompletionResult, ChatMessage, ChatModel, ToolCallRequest } from "./types.js";

interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  modelo?: string;
}

interface DeepSeekChoiceMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

interface DeepSeekResponse {
  choices: Array<{ message: DeepSeekChoiceMessage; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function paraFormatoApi(msg: ChatMessage): Record<string, unknown> {
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: msg.content || null,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.nome, arguments: tc.argumentosJson },
      })),
    };
  }
  if (msg.role === "tool") {
    return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
  }
  return { role: msg.role, content: msg.content };
}

/** Implementação DeepSeek do ChatModel — via API compatível com OpenAI
 * (/chat/completions). Nenhum outro arquivo deve importar isto diretamente;
 * sempre via a factory em client.ts. */
export function createDeepSeekChatModel(config: DeepSeekConfig): ChatModel {
  const modelo = config.modelo ?? "deepseek-chat";

  return {
    async chatCompletion(messages: ChatMessage[], opts: ChatCompletionOptions = {}): Promise<ChatCompletionResult> {
      const body: Record<string, unknown> = {
        model: modelo,
        messages: messages.map(paraFormatoApi),
        temperature: opts.temperature ?? 0.2,
      };
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      if (opts.jsonMode) body.response_format = { type: "json_object" };
      if (opts.tools && opts.tools.length > 0) {
        body.tools = opts.tools.map((t) => ({
          type: "function",
          function: { name: t.nome, description: t.descricao, parameters: t.parametros },
        }));
      }

      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!response.ok) {
        const texto = await response.text().catch(() => "");
        throw new Error(`DeepSeek respondeu ${response.status}: ${texto.slice(0, 500)}`);
      }

      const dados = (await response.json()) as DeepSeekResponse;
      const escolha = dados.choices[0];
      if (!escolha) {
        throw new Error("DeepSeek não retornou nenhuma escolha (choices vazio)");
      }

      const toolCalls: ToolCallRequest[] | null =
        escolha.message.tool_calls?.map((tc) => ({
          id: tc.id,
          nome: tc.function.name,
          argumentosJson: tc.function.arguments,
        })) ?? null;

      return {
        content: escolha.message.content,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
        usage: dados.usage
          ? { promptTokens: dados.usage.prompt_tokens, completionTokens: dados.usage.completion_tokens }
          : null,
      };
    },
  };
}
