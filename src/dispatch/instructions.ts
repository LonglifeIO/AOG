import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AgentId } from "../agents/types.js";

/**
 * Generate per-CLI instruction files for a worker worktree.
 * Kept minimal to reduce token overhead on spawned agents.
 */

export interface InstructionContext {
  taskId: string;
  task: string;
  agent: AgentId;
  scopedFiles: string[];
  readOnlyContext: string[];
  outputFormat: string;
  worktreePath: string;
  projectContext?: string;
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
  const lines: string[] = [`# Task ${ctx.taskId}`, "", ctx.task, ""];

  if (ctx.scopedFiles.length > 0) {
    lines.push("## Scope", "Only modify:", ...ctx.scopedFiles.map(f => `- ${f}`), "");
  }

  if (ctx.readOnlyContext.length > 0) {
    lines.push("## Context (read-only)", ...ctx.readOnlyContext.map(f => `- ${f}`), "");
  }

  lines.push(
    "## Rules",
    "- Do NOT commit — orchestrator handles git",
    "- Do NOT modify .aog/, .worktrees/, or .git/",
    ""
  );

  return lines.join("\n");
}

/**
 * Read the project-level instruction file if it exists.
 */
export async function readProjectInstructions(
  projectRoot: string,
  agent: AgentId
): Promise<string | undefined> {
  const filename = INSTRUCTION_FILES[agent];
  const filePath = join(projectRoot, filename);

  try {
    const { readFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    if (!existsSync(filePath)) return undefined;
    return await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
