import { randomUUID } from "node:crypto";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, TaskType } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { routeTask } from "../router/index.js";
import { extractChanges } from "../worktree/diff.js";
import { saveSession } from "../utils/session.js";
import { resolveTask } from "../utils/task-file.js";
import { buildTokenEstimate, tokenLoggingEnabled } from "../utils/tokens.js";

interface DelegateArgs {
  task?: string;
  task_file?: string;
  task_type?: TaskType;
  preferred_agent?: AgentId;
  use_worktree?: boolean;
  model?: string;
  max_turns?: number;
  max_budget_usd?: number;
  timeout?: number;
}

export async function handleDelegate(
  args: DelegateArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const taskId = randomUUID().slice(0, 8);
  const task = await resolveTask(args);
  const available = agentManager.getAvailableAgents();

  if (available.length === 0) {
    throw new Error("No CLI agents available. Install claude, codex, or gemini CLI.");
  }

  const agent = args.preferred_agent && agentManager.isAvailable(args.preferred_agent)
    ? args.preferred_agent
    : routeTask(args.task_type ?? "IMPLEMENT", available);

  if (progress) {
    await progress.delegateStarted(agent);
  }

  let cwd = process.cwd();
  let branch: string | undefined;

  if (args.use_worktree) {
    const wt = await worktreeManager.create(taskId, agent);
    cwd = wt.path;
    branch = wt.branch;
    if (progress) {
      await progress.delegateWorktreeCreated(agent);
    }
  }

  try {
    const result = await agentManager.spawn(agent, {
      prompt: task,
      cwd,
      taskId,
      model: args.model,
      maxTurns: args.max_turns,
      maxBudgetUsd: args.max_budget_usd,
      timeout: args.timeout,
      // When using a worktree, the worktree IS the sandbox — allow writes
      // When not using a worktree, defer to config (default: false)
      ...(branch ? { allowPermissionBypass: true } : {}),
    });

    if (branch) {
      result.changes = await extractChanges(cwd, branch);
    }

    const filesChanged = result.changes
      ? result.changes.diff_summary.split("\n").map((l: string) => l.split("|")[0].trim()).filter(Boolean)
      : [];

    const sessionPath = `.aog/sessions/${taskId}.json`;

    // Persist full result + optional token estimates
    const sessionData: Record<string, unknown> = { mode: "delegate", agent, fullResult: result };
    if (tokenLoggingEnabled()) {
      sessionData.token_estimates = buildTokenEstimate({
        prompt: task,
        response: result.result,
      });
    }
    await saveSession(taskId, sessionData);

    if (progress) {
      await progress.agentCompleted(agent, result.duration_ms / 1000, filesChanged.length || undefined);
    }

    // Compact response — under 500 chars
    return {
      taskId,
      status: result.status,
      summary: `${agent} completed in ${(result.duration_ms / 1000).toFixed(1)}s`,
      files_changed: filesChanged,
      duration_ms: result.duration_ms,
      session_path: sessionPath,
    };
  } catch (error) {
    if (args.use_worktree) {
      await worktreeManager.remove(taskId, agent).catch(() => {});
    }
    throw error;
  }
}
