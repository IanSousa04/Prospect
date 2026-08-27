import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

import { executeTask } from "./claude-executor.js";
import { appendHistory } from "./history.js";
import { markTaskDone, parseRoadmap, selectNextTask } from "./roadmap.js";
import { loadState, saveState } from "./state.js";
import { runValidation } from "./validation.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const orchestratorRoot = resolve(currentDir, "..");
const repoRoot = resolve(orchestratorRoot, "..", "..");

function buildPrompt(repoRootPath: string, taskFile: string): string {
  const claudeMd = readFileSync(join(repoRootPath, "CLAUDE.md"), "utf-8");
  const taskDoc = readFileSync(join(repoRootPath, taskFile), "utf-8");
  return [
    "Você está implementando uma tarefa do ROADMAP.md deste repositório.",
    "Siga rigorosamente as regras abaixo (CLAUDE.md do projeto):",
    "---",
    claudeMd,
    "---",
    "Tarefa a implementar (arquivo de detalhes):",
    "---",
    taskDoc,
    "---",
    "Implemente esta tarefa completamente. Se ela envolver comportamento da IA de atendimento,",
    "ferramentas/orquestrador, permissões, catálogo semântico, handoff ou mensageria WhatsApp,",
    "rode a skill `food-ai-guardrails` antes de considerar a tarefa concluída.",
  ].join("\n");
}

async function main() {
  const state = loadState(orchestratorRoot);
  const roadmap = parseRoadmap(repoRoot);
  const task = selectNextTask(roadmap, state.completed);

  if (!task) {
    appendHistory(orchestratorRoot, "NO_TASK_AVAILABLE");
    console.log("Nenhuma tarefa pendente encontrada no ROADMAP.md.");
    return;
  }

  console.log(`Tarefa selecionada: [${task.priority ?? "sem prioridade"}] ${task.title}`);
  console.log(`Detalhes: ${task.taskFile}`);
  appendHistory(orchestratorRoot, "TASK_SELECTED", { taskFile: task.taskFile, title: task.title });

  state.currentTask = task.taskFile;
  saveState(orchestratorRoot, state);

  const prompt = buildPrompt(repoRoot, task.taskFile);

  appendHistory(orchestratorRoot, "EXECUTION_STARTED", { taskFile: task.taskFile });
  const result = await executeTask(prompt, repoRoot);
  appendHistory(orchestratorRoot, "EXECUTION_FINISHED", {
    taskFile: task.taskFile,
    totalCostUsd: result.totalCostUsd,
    numTurns: result.numTurns,
  });
  console.log("Execução concluída. Resumo do agente:");
  console.log(result.finalMessage);

  console.log("Rodando validação (npm run typecheck)...");
  const validation = runValidation(repoRoot);

  if (!validation.passed) {
    appendHistory(orchestratorRoot, "VALIDATION_FAILED", { taskFile: task.taskFile, output: validation.output });
    console.error("Validação falhou. Tarefa NÃO marcada como concluída. Saída:");
    console.error(validation.output);
    state.currentTask = null;
    saveState(orchestratorRoot, state);
    process.exitCode = 1;
    return;
  }

  appendHistory(orchestratorRoot, "VALIDATION_PASSED", { taskFile: task.taskFile });
  markTaskDone(repoRoot, task);

  state.completed.push(task.taskFile);
  state.currentTask = null;
  saveState(orchestratorRoot, state);

  appendHistory(orchestratorRoot, "TASK_COMPLETED", { taskFile: task.taskFile });
  console.log(`Tarefa concluída e validada: ${task.taskFile}`);
}

main().catch((error) => {
  console.error("Erro fatal no orchestrator:", error);
  process.exitCode = 1;
});
