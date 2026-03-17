import { randomUUID } from "node:crypto";
import { execa } from "execa";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId } from "../agents/types.js";
import { fanOut } from "../council/fanout.js";
import { crossReview } from "../council/review.js";
import { synthesize } from "../council/synthesis.js";
import { saveSession } from "../utils/session.js";

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
): Promise<Record<string, unknown>> {
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
    // Phase 1: Fan-out
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

    // Phase 3: Cross-review
    const reviews = await crossReview({ taskId, implementations, agents, agentManager });

    // Phase 4: Synthesis
    const synthesis = await synthesize({
      taskId,
      implementations,
      reviews,
      chairman: chairman!,
      agentManager,
      worktreeManager,
    });

    const duration_ms = Date.now() - startTime;

    // Persist full data to session file
    await saveSession(taskId, {
      mode: "council",
      agents: Object.fromEntries(
        Object.entries(implementations).map(([id, impl]) => [id, {
          status: impl.status,
          branch: impl.branch,
          diff: impl.diff,
          diffSummary: impl.diffSummary,
          testResults: impl.testResults,
        }])
      ),
      reviews,
      synthesis,
      duration_ms,
    });

    // Build compact per-agent summaries
    const agentSummaries: Record<string, { status: string; files_changed: string[] }> = {};
    for (const [agentId, impl] of Object.entries(implementations)) {
      const files = impl.diffSummary
        ? impl.diffSummary.split("\n").map((l: string) => l.split("|")[0].trim()).filter(Boolean)
        : [];
      agentSummaries[agentId] = { status: impl.status, files_changed: files };
    }

    // Return compact summary
    return {
      taskId,
      mode: "council",
      status: synthesis ? "success" : "partial",
      summary: synthesis?.summary ?? `${Object.values(implementations).filter(i => i.status === "completed").length}/${agents.length} agents completed`,
      winner: synthesis?.branch ?? null,
      strategy: synthesis?.strategy ?? null,
      agents: agentSummaries,
      duration_ms,
      detail: `Full diffs, reviews, and synthesis in .aog/sessions/${taskId}.json`,
    };
  } finally {
    for (const agent of agents) {
      await worktreeManager.remove(taskId, agent).catch(() => {});
    }
  }
}
