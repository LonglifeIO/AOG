import { randomUUID } from "node:crypto";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, AgentResult, TaskType } from "../agents/types.js";
import { routeTask } from "../router/index.js";
import { extractChanges } from "../worktree/diff.js";

interface DelegateArgs {
  task: string;
  task_type?: TaskType;
  preferred_agent?: AgentId;
  use_worktree?: boolean;
  model?: string;
  max_turns?: number;
  max_budget_usd?: number;
  timeout?: number;
}

interface DelegateResult {
  taskId: string;
  mode: "delegate";
  agent: AgentId;
  status: string;
  result: AgentResult;
}

export async function handleDelegate(
  args: DelegateArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager
): Promise<DelegateResult> {
  const taskId = randomUUID().slice(0, 8);
  const available = agentManager.getAvailableAgents();

  if (available.length === 0) {
    throw new Error("No CLI agents available. Install claude, codex, or gemini CLI.");
  }

  const agent = args.preferred_agent && agentManager.isAvailable(args.preferred_agent)
    ? args.preferred_agent
    : routeTask(args.task_type ?? "IMPLEMENT", available);

  let cwd = process.cwd();
  let branch: string | undefined;

  if (args.use_worktree) {
    const wt = await worktreeManager.create(taskId, agent);
    cwd = wt.path;
    branch = wt.branch;
  }

  try {
    const result = await agentManager.spawn(agent, {
      prompt: args.task,
      cwd,
      taskId,
      model: args.model,
      maxTurns: args.max_turns,
      maxBudgetUsd: args.max_budget_usd,
      timeout: args.timeout,
    });

    if (branch) {
      result.changes = await extractChanges(cwd, branch);
    }

    return { taskId, mode: "delegate", agent, status: result.status, result };
  } catch (error) {
    if (args.use_worktree) {
      await worktreeManager.remove(taskId, agent).catch(() => {});
    }
    throw error;
  }
}
