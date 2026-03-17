import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { AgentId } from "../agents/types.js";

/**
 * Generate per-CLI instruction files for a worker worktree.
 * Each agent gets a task-specific instruction file in its expected location.
 */

export interface InstructionContext {
  taskId: string;
  task: string;
  agent: AgentId;
  scopedFiles: string[];
  readOnlyContext: string[];
  outputFormat: string; // Expected output format
  worktreePath: string;
  projectContext?: string; // Optional project-level context to include
}

const INSTRUCTION_FILES: Record<AgentId, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: ".gemini/GEMINI.md",
};

export async function writeWorkerInstructions(ctx: InstructionContext): Promise<void> {
  const filename = INSTRUCTION_FILES[ctx.agent];
  const filePath = join(ctx.worktreePath, filename);

  await mkdir(dirname(filePath), { recursive: true });

  const content = buildInstructionContent(ctx);
  await writeFile(filePath, content, "utf-8");
}

function buildInstructionContent(ctx: InstructionContext): string {
  const sections: string[] = [];

  sections.push(`# AOG Worker Task: ${ctx.taskId}\n`);
  sections.push(`## Task\n\n${ctx.task}\n`);

  // File scope
  if (ctx.scopedFiles.length > 0) {
    sections.push(`## File Scope\n`);
    sections.push(`You should ONLY modify these files:\n`);
    for (const f of ctx.scopedFiles) {
      sections.push(`- ${f}`);
    }
    sections.push("");
  }

  if (ctx.readOnlyContext.length > 0) {
    sections.push(`## Read-Only Context\n`);
    sections.push(`You may READ these files for context but should NOT modify them:\n`);
    for (const f of ctx.readOnlyContext) {
      sections.push(`- ${f}`);
    }
    sections.push("");
  }

  // Output expectations
  sections.push(`## Expected Output\n`);
  sections.push(`When you complete the task:`);
  sections.push(`1. Make all code changes in the working directory`);
  sections.push(`2. Ensure the code compiles and tests pass`);
  sections.push(`3. Do NOT commit changes — the orchestrator handles git operations`);
  sections.push(`4. Output format: ${ctx.outputFormat}\n`);

  // Constraints
  sections.push(`## Constraints\n`);
  sections.push(`- This is an isolated worktree — changes here do not affect the main branch`);
  sections.push(`- Do NOT modify files in \`.aog/\`, \`.worktrees/\`, or \`.git/\``);
  sections.push(`- Focus on the task described above`);
  sections.push(`- Be thorough but concise\n`);

  // Project context
  if (ctx.projectContext) {
    sections.push(`## Project Context\n\n${ctx.projectContext}\n`);
  }

  return sections.join("\n");
}

/**
 * Read the project-level instruction file if it exists.
 * This provides shared context across all workers.
 */
export async function readProjectInstructions(
  projectRoot: string,
  agent: AgentId
): Promise<string | undefined> {
  const filename = INSTRUCTION_FILES[agent];
  const filePath = join(projectRoot, filename);

  if (!existsSync(filePath)) return undefined;

  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
