import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AgentId } from "../agents/types.js";

/**
 * Worker environment setup. Called after worktree creation, before
 * agent spawn. Copies project skills into the worktree and (optionally)
 * registers an MCP callback. The per-task prompt is passed directly to
 * the CLI via -p; we do not write per-CLI instruction files into the
 * worktree (ADR-014: the duplicate file polluted diffs and obscured
 * the gemini diagnosis).
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
  // Copy skills to worktree (if enabled and available)
  if (options.installSkills !== false) {
    await installSkillsInWorktree(options.worktreePath, options.projectRoot);
  }

  // MCP callback registration (v2 prep — disabled by default)
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
