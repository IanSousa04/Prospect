import { execSync } from "node:child_process";

export interface ValidationResult {
  passed: boolean;
  output: string;
}

export function runValidation(repoRoot: string): ValidationResult {
  try {
    const output = execSync("npm run typecheck", { cwd: repoRoot, encoding: "utf-8" });
    return { passed: true, output };
  } catch (error) {
    const output =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout: unknown }).stdout) + String((error as { stderr?: unknown }).stderr ?? "")
        : String(error);
    return { passed: false, output };
  }
}
