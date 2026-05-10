import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, TaskType } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { runCouncilPipeline } from "../council/pipeline.js";
import { saveSession } from "../utils/session.js";
import { resolveTask } from "../utils/task-file.js";
import { noticeOnce } from "../utils/notices.js";
import { handleDelegate } from "./delegate.js";

interface BuildArgs {
  task?: string;
  task_file?: string;

  // Mode
  mode?: "council" | "solo";

  // Council params
  agents?: AgentId[];
  chairman?: AgentId | "best-scorer";
  synthesis_strategy?: "best-wins" | "chairman-merge" | "auto";
  run_tests?: boolean;
  test_command?: string;

  // Solo params
  agent?: AgentId;
  task_type?: TaskType;

  // Shared
  use_worktree?: boolean;
  model?: string;
  max_turns?: number;
  max_budget_usd?: number;
  timeout?: number;
}

/**
 * aog_build — implement / fix / refactor a task.
 *
 * Council by default: every available CLI works the task in parallel
 * worktrees, cross-reviews anonymized diffs, and a chairman synthesizes
 * the merged result. Pass `mode: "solo"` to fall back to single-agent
 * routing-by-strength.
 */
export async function handleBuild(
  args: BuildArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const defaultMode = agentManager.getConfig()?.defaults.mode ?? "council";
  const mode = args.mode ?? defaultMode;

  if (mode === "solo") {
    return runSoloBuild(args, agentManager, worktreeManager, progress);
  }
  return runCouncilBuild(args, agentManager, worktreeManager, progress);
}

async function runCouncilBuild(
  args: BuildArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const available = agentManager.getAvailableAgents();
  if (available.length === 0) {
    throw new Error("No CLI agents available. Install claude, codex, or gemini.");
  }

  const requested = args.agents ?? available;
  const agents = requested.filter((a) => agentManager.isAvailable(a));

  // Single-CLI graceful degradation
  if (agents.length < 2) {
    const only = agents[0] ?? available[0];
    noticeOnce(
      "council-fallback-build",
      `[aog] Council mode requires 2+ CLIs; running solo with ${only}.`
    );
    return runSoloBuild({ ...args, agent: only }, agentManager, worktreeManager, progress);
  }

  if (args.use_worktree === false) {
    noticeOnce(
      "council-worktree-force",
      `[aog] Council mode requires worktree isolation; ignoring use_worktree: false.`
    );
  }

  const taskId = randomUUID().slice(0, 8);
  const task = await resolveTask(args);

  // Auto-detect run_tests: default true if package.json exists, else false.
  const runTests =
    args.run_tests !== undefined ? args.run_tests : existsSync(join(process.cwd(), "package.json"));

  const outcome = await runCouncilPipeline({
    taskId,
    task,
    operation: "build",
    agents,
    chairman: args.chairman,
    synthesisStrategy: args.synthesis_strategy,
    runTests,
    testCommand: args.test_command,
    timeout: args.timeout,
    agentManager,
    worktreeManager,
    progress,
  });

  const sessionPath = `.aog/sessions/${taskId}.json`;
  await saveSession(taskId, {
    mode: "council",
    operation: "build",
    chairman: outcome.chairman,
    participated: outcome.participated,
    failed: outcome.failed,
    implementations: Object.fromEntries(
      Object.entries(outcome.implementations).map(([id, impl]) => [
        id,
        {
          status: impl.status,
          branch: impl.branch,
          diff: impl.diff,
          diffSummary: impl.diffSummary,
          testResults: impl.testResults,
          // Persist the agent's result text for failed agents so the
          // error message survives. Capped at 2KB. (ADR-014)
          ...(impl.status !== "completed" && impl.result
            ? { result_excerpt: impl.result.slice(0, 2048) }
            : {}),
        },
      ])
    ),
    reviews: outcome.reviews,
    synthesis: outcome.synthesis,
    duration_ms: outcome.durationMs,
  });

  return {
    taskId,
    mode: "council",
    status: outcome.status,
    summary: buildSummary(outcome.status, outcome.participated, outcome.failed, outcome.chairman),
    chairman: outcome.chairman,
    participated: outcome.participated,
    failed: outcome.failed,
    files_changed: outcome.filesChanged,
    merged_from: outcome.mergedFrom,
    branch: outcome.branch,
    duration_ms: outcome.durationMs,
    session_path: sessionPath,
  };
}

async function runSoloBuild(
  args: BuildArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const result = await handleDelegate(
    {
      task: args.task,
      task_file: args.task_file,
      task_type: args.task_type,
      preferred_agent: args.agent,
      use_worktree: args.use_worktree,
      model: args.model,
      max_turns: args.max_turns,
      max_budget_usd: args.max_budget_usd,
      timeout: args.timeout,
    },
    agentManager,
    worktreeManager,
    progress
  );

  return { ...result, mode: "solo" };
}

function buildSummary(
  status: "success" | "partial" | "failed",
  participated: string[],
  failed: string[],
  chairman: string
): string {
  const total = participated.length + failed.length;
  const verb = status === "success" ? "Council built" : status === "partial" ? "Council partial" : "Council failed";
  const fails = failed.length > 0 ? `; failed: ${failed.join(", ")}` : "";
  return `${verb} (${participated.length}/${total} agents). Chairman: ${chairman}${fails}.`;
}
