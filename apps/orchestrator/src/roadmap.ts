import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RoadmapTask {
  done: boolean;
  priority: "P0" | "P1" | "P2" | null;
  title: string;
  taskFile: string;
  line: string;
}

const TASK_LINE = /^- \[([ x])\] \*\*(?:\[(P\d)\]\s*)?(.*?)\*\*\s*(?:`SP:\s*\d+`\s*)?\(\[detalhes\]\((tasks\/[^)]+\.md)\)\)/;

export function parseRoadmap(repoRoot: string): RoadmapTask[] {
  const raw = readFileSync(join(repoRoot, "ROADMAP.md"), "utf-8");
  const tasks: RoadmapTask[] = [];
  for (const line of raw.split("\n")) {
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    const [, checkbox, priority, title, taskFile] = match;
    if (!title || !taskFile) continue;
    tasks.push({
      done: checkbox === "x",
      priority: (priority as RoadmapTask["priority"]) ?? null,
      title: title.trim(),
      taskFile,
      line,
    });
  }
  return tasks;
}

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

export function selectNextTask(tasks: RoadmapTask[], completed: string[]): RoadmapTask | null {
  const pending = tasks.filter((t) => !t.done && !completed.includes(t.taskFile));
  if (pending.length === 0) return null;

  return pending.reduce((best, current) => {
    const bestRank = best.priority ? (PRIORITY_ORDER[best.priority] ?? 99) : 99;
    const currentRank = current.priority ? (PRIORITY_ORDER[current.priority] ?? 99) : 99;
    return currentRank < bestRank ? current : best;
  });
}

export function markTaskDone(repoRoot: string, task: RoadmapTask): void {
  const path = join(repoRoot, "ROADMAP.md");
  const raw = readFileSync(path, "utf-8");
  const doneLine = task.line.replace("- [ ]", "- [x]");
  const updated = raw.replace(task.line, doneLine);
  writeFileSync(path, updated, "utf-8");
}
