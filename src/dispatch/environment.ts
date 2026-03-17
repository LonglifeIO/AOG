import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AgentId } from "../agents/types.js";
import { writeWorkerInstructions, readProjectInstructions, type InstructionContext } from "./instructions.js";

/**
 * Full worker environment setup.
 * Called after worktree creation, before agent spawn.
 * Sets up: instruction files + skills + optional MCP callback config.
 */

export interface WorkerEnvironmentOptions {
  taskId: string;
  task: string;
  agent: AgentId;
  worktreePath: string;
  projectRoot: string;
  scopedFiles?: string[];
  readOnlyContext?: string[];
  installSkills?: boolean;
  registerMcpCallback?: boolean; // v2: register AOG as callback server
}

export async function setupWorkerEnvironment(options: WorkerEnvironmentOptions): Promise<void> {
  // 1. Write task-specific instruction file
  const projectContext = await readProjectInstructions(options.projectRoot, options.agent);

  const ctx: InstructionContext = {
    taskId: options.taskId,
    task: options.task,
    agent: options.agent,
    scopedFiles: options.scopedFiles ?? [],
    readOnlyContext: options.readOnlyContext ?? [],
    outputFormat: "structured text with code changes",
    worktreePath: options.worktreePath,
    projectContext,
  };

  await writeWorkerInstructions(ctx);

  // 2. Copy skills to worktree (if enabled and available)
  if (options.installSkills !== false) {
    await installSkillsInWorktree(options.worktreePath, options.projectRoot);
  }

  // 3. MCP callback registration (v2 prep — disabled by default)
  if (options.registerMcpCallback) {
    const { registerMcpCallback } = await import("./mcp-registration.js");
    await registerMcpCallback(options.worktreePath, options.agent);
  }
}

/**
 * Copy skills from the project's skills/ directory to the worktree.
 */
async function installSkillsInWorktree(
  worktreePath: string,
  projectRoot: string
): Promise<void> {
  const skillsSource = join(projectRoot, "skills");
  if (!existsSync(skillsSource)) return;

  const skillsDest = join(worktreePath, "skills");

  try {
    await mkdir(skillsDest, { recursive: true });
    await cp(skillsSource, skillsDest, { recursive: true });
  } catch {
    // Skills installation is best-effort
  }
}
