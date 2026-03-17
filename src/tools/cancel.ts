import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineState } from "../agents/types.js";

interface CancelArgs {
  task_id: string;
  force?: boolean;
}

export async function handleCancel(
  args: CancelArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager
): Promise<{ taskId: string; status: "cancelled"; cleaned_up: { processes_killed: number; worktrees_removed: number } }> {
  let processesKilled = 0;
  let worktreesRemoved = 0;

  try {
    await agentManager.killAll(args.task_id);
    processesKilled++;
  } catch {
    // Best effort
  }

  const agents = ["claude", "codex", "gemini"] as const;
  for (const agent of agents) {
    try {
      await worktreeManager.remove(args.task_id, agent);
      worktreesRemoved++;
    } catch {
      // Worktree may not exist
    }
  }

  try {
    const sessionFile = join(process.cwd(), ".aog", "sessions", `${args.task_id}.json`);
    const data = await readFile(sessionFile, "utf-8");
    const state: PipelineState = JSON.parse(data);
    state.status = "cancelled";
    state.updatedAt = new Date().toISOString();
    await writeFile(sessionFile, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Session file may not exist
  }

  return {
    taskId: args.task_id,
    status: "cancelled",
    cleaned_up: { processes_killed: processesKilled, worktrees_removed: worktreesRemoved },
  };
}
