import { randomUUID } from "node:crypto";
import { execa } from "execa";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { fanOut } from "../council/fanout.js";
import { crossReview } from "../council/review.js";
import { synthesize } from "../council/synthesis.js";
import { saveSession } from "../utils/session.js";
import { resolveTask } from "../utils/task-file.js";
import { buildTokenEstimate, tokenLoggingEnabled } from "../utils/tokens.js";

interface CouncilArgs {
  task?: string;
  task_file?: string;
  agents?: AgentId[];
  chairman?: AgentId | "best-scorer";
  run_tests?: boolean;
  test_command?: string;
  timeout?: number;
}

export async function handleCouncil(
  args: CouncilArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const taskId = randomUUID().slice(0, 8);
  const startTime = Date.now();
  const task = await resolveTask(args);
  const available = agentManager.getAvailableAgents();

  const agents = (args.agents ?? available).filter((a) => agentManager.isAvailable(a));
  if (agents.length < 2) {
    throw new Error(
      `Council mode requires at least 2 agents. Available: ${available.join(", ")}`
    );
  }

  const chairman = (args.chairman === "best-scorer" ? undefined : args.chairman) ?? agents[0];

  if (progress) {
    await progress.councilStarted(agents);
  }

  try {
    // Phase 1: Fan-out
    const implementations = await fanOut({
      taskId,
      task,
      agents,
      agentManager,
      worktreeManager,
      timeout: args.timeout,
      progress,
    });

    // Phase 2: Run tests
    if (args.run_tests !== false) {
      if (progress) {
        await progress.testsStarted();
      }

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

      if (progress) {
        const completed = Object.values(implementations).filter(i => i.status === "completed");
        const passed = completed.filter(i => i.testResults?.passed).length;
        await progress.testsCompleted(passed, completed.length);
      }
    }

    // Phase 3: Cross-review
    const reviews = await crossReview({ taskId, implementations, agents, agentManager, progress });

    // Phase 4: Synthesis
    const synthesis = await synthesize({
      taskId,
      implementations,
      reviews,
      chairman: chairman!,
      agentManager,
      worktreeManager,
      progress,
    });

    const duration_ms = Date.now() - startTime;
    const sessionPath = `.aog/sessions/${taskId}.json`;

    // Persist full data to session file
    const sessionData: Record<string, unknown> = {
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
    };
    if (tokenLoggingEnabled()) {
      sessionData.token_estimates = buildTokenEstimate({
        prompt: task,
        response: JSON.stringify(synthesis ?? {}),
      });
    }
    await saveSession(taskId, sessionData);

    // Collect all changed files across agents
    const allFiles: string[] = [];
    for (const impl of Object.values(implementations)) {
      if (impl.diffSummary) {
        const files = impl.diffSummary.split("\n").map((l: string) => l.split("|")[0].trim()).filter(Boolean);
        for (const f of files) {
          if (!allFiles.includes(f)) allFiles.push(f);
        }
      }
    }

    // Compact response — under 500 chars
    return {
      taskId,
      status: synthesis ? "success" : "partial",
      summary: synthesis?.summary ?? `${Object.values(implementations).filter(i => i.status === "completed").length}/${agents.length} agents completed`,
      files_changed: allFiles,
      duration_ms,
      session_path: sessionPath,
    };
  } finally {
    for (const agent of agents) {
      await worktreeManager.remove(taskId, agent).catch(() => {});
    }
  }
}
