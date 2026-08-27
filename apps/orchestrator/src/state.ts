import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface OrchestratorState {
  currentTask: string | null;
  completed: string[];
  updatedAt: string;
}

function emptyState(): OrchestratorState {
  return { currentTask: null, completed: [], updatedAt: new Date().toISOString() };
}

function statePath(orchestratorRoot: string): string {
  return join(orchestratorRoot, ".agent", "state.json");
}

export function loadState(orchestratorRoot: string): OrchestratorState {
  const path = statePath(orchestratorRoot);
  if (!existsSync(path)) return emptyState();
  return JSON.parse(readFileSync(path, "utf-8")) as OrchestratorState;
}

export function saveState(orchestratorRoot: string, state: OrchestratorState): void {
  const path = statePath(orchestratorRoot);
  mkdirSync(dirname(path), { recursive: true });
  const toSave: OrchestratorState = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(toSave, null, 2) + "\n", "utf-8");
}
