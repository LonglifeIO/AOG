import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AgentId } from "../agents/types.js";

/**
 * Per-CLI auto-loaded instruction files at the project root. Each CLI
 * reads its own file automatically when started in that directory.
 * Used by readProjectInstructions to surface project-level guidance
 * (separate from the per-task prompt, which is passed via -p).
 */
const PROJECT_INSTRUCTION_FILES: Record<AgentId, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: ".gemini/GEMINI.md",
};

/**
 * Read the project-level instruction file if it exists. Returns the
 * file content for inclusion as context, or undefined if missing.
 */
export async function readProjectInstructions(
  projectRoot: string,
  agent: AgentId
): Promise<string | undefined> {
  const filename = PROJECT_INSTRUCTION_FILES[agent];
  const filePath = join(projectRoot, filename);
  if (!existsSync(filePath)) return undefined;
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
