import { randomUUID } from "node:crypto";
import { execa } from "execa";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, CouncilResult } from "../agents/types.js";
import { fanOut } from "../council/fanout.js";
import { crossReview } from "../council/review.js";
import { synthesize } from "../council/synthesis.js";

interface CouncilArgs {
  task: string;
  agents?: AgentId[];
  chairman?: AgentId | "best-scorer";
  run_tests?: boolean;
  test_command?: string;
  timeout?: number;
}

export async function handleCouncil(
  args: CouncilArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager
): Promise<CouncilResult> {
  const taskId = randomUUID().slice(0, 8);
  const startTime = Date.now();
  const available = agentManager.getAvailableAgents();

  const agents = (args.agents ?? available).filter((a) => agentManager.isAvailable(a));
  if (agents.length < 2) {
    throw new Error(
      `Council mode requires at least 2 agents. Available: ${available.join(", ")}`
    );
  }

  const chairman = (args.chairman === "best-scorer" ? undefined : args.chairman) ?? agents[0];

  try {
    // Phase 1: Fan-out — parallel implementation
    const implementations = await fanOut({
      taskId,
      task: args.task,
      agents,
      agentManager,
      worktreeManager,
      timeout: args.timeout,
    });

    // Phase 2: Run tests
    if (args.run_tests !== false) {
      const testCmd = args.test_command ?? "npm test";
      for (const [, impl] of Object.entries(implementations)) {
        if (impl.status === "completed" && impl.worktreePath) {
          try {
            const { stdout, stderr, exitCode } = await execa("sh", ["-c", testCmd], {
              cwd: impl.worktreePath,
              timeout: 120_000,
              reject: false,
            });
            impl.testResults = {
              passed: exitCode === 0,
              exit_code: exitCode ?? 1,
              stdout: stdout.slice(0, 5000),
              stderr: stderr.slice(0, 5000),
            };
          } catch {
            impl.testResults = { passed: false, exit_code: 1, stdout: "", stderr: "Test execution failed" };
          }
        }
      }
    }

    // Phase 3: Cross-review with anonymized diffs
    const reviews = await crossReview({ taskId, implementations, agents, agentManager });

    // Phase 4: Chairman synthesis
    const synthesis = await synthesize({
      taskId,
      implementations,
      reviews,
      chairman: chairman!,
      agentManager,
      worktreeManager,
    });

    const duration_ms = Date.now() - startTime;

    const agentResults: CouncilResult["agents"] = {};
    for (const [agentId, impl] of Object.entries(implementations)) {
      agentResults[agentId] = {
        taskId,
        agent: agentId as AgentId,
        model: "",
        status: impl.status === "completed" ? "completed" : "failed",
        duration_ms: 0,
        result: impl.diff ?? "",
        cost: { usd: null, tokens_in: null, tokens_out: null },
        changes: impl.diff ? {
          branch: impl.branch,
          files_changed: 0,
          insertions: 0,
          deletions: 0,
          diff_summary: impl.diffSummary ?? "",
          diff: impl.diff,
        } : null,
        tests: impl.testResults ?? null,
        session: { id: taskId, resumable: false },
      };
    }

    return {
      taskId,
      mode: "council",
      status: synthesis ? "success" : "partial",
      duration_ms,
      agents: agentResults,
      synthesis: synthesis ?? undefined,
    };
  } finally {
    for (const agent of agents) {
      await worktreeManager.remove(taskId, agent).catch(() => {});
    }
  }
}
