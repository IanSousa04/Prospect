import { query } from "@anthropic-ai/claude-agent-sdk";

export interface ExecutionResult {
  finalMessage: string;
  totalCostUsd: number | null;
  numTurns: number | null;
}

/**
 * Roda uma sessão programática do Claude Agent SDK, do zero (sem histórico),
 * com permissão para editar arquivos e rodar bash — spike local, sem worktree
 * isolado ainda, então roda direto no `cwd` do repositório real.
 */
export async function executeTask(prompt: string, repoRoot: string): Promise<ExecutionResult> {
  let finalMessage = "";
  let totalCostUsd: number | null = null;
  let numTurns: number | null = null;

  for await (const message of query({
    prompt,
    options: {
      cwd: repoRoot,
      permissionMode: "acceptEdits",
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") finalMessage += block.text;
      }
    }
    if (message.type === "result") {
      totalCostUsd = "total_cost_usd" in message ? (message.total_cost_usd as number) : null;
      numTurns = "num_turns" in message ? (message.num_turns as number) : null;
    }
  }

  return { finalMessage, totalCostUsd, numTurns };
}
