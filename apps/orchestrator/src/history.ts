import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type HistoryEvent =
  | "TASK_SELECTED"
  | "EXECUTION_STARTED"
  | "EXECUTION_FINISHED"
  | "VALIDATION_PASSED"
  | "VALIDATION_FAILED"
  | "TASK_COMPLETED"
  | "NO_TASK_AVAILABLE";

export function appendHistory(
  orchestratorRoot: string,
  event: HistoryEvent,
  data: Record<string, unknown> = {},
): void {
  const path = join(orchestratorRoot, ".agent", "history.jsonl");
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}
