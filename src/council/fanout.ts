import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, AgentImplementation } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { CouncilStatus } from "../interaction/status.js";
import { extractChanges } from "../worktree/diff.js";
import { wrapCouncilPrompt, type CouncilOperation } from "./guardrails.js";

interface FanOutOptions {
  taskId: string;
  task: string;
  operation: CouncilOperation;
  outputPath?: string;
  agents: AgentId[];
  agentManager: AgentManager;
  worktreeManager: WorktreeManager;
  timeout?: number;
  model?: Record<AgentId, string>;
  progress?: ProgressReporter;
}

/**
 * Fan out a task to multiple agents, each working in an isolated worktree.
 * All agents run in parallel — total time = max(individual times).
 *
 * Operation-aware:
 *   - "build" extracts code diffs via merge-base for cross-review.
 *   - "research" / "synthesize" reads the contents of `outputPath` from
 *     each worktree into `impl.outputContent` for content-based review.
 *
 * Partial failure is tolerated by design — survivors continue and the
 * pipeline reports `participated` / `failed` to the caller. We never
 * cancel sibling agents because one failed.
 */
export async function fanOut(
  options: FanOutOptions
): Promise<Record<string, AgentImplementation>> {
  const { taskId, task, operation, outputPath, agents, agentManager, worktreeManager, progress } = options;
  const implementations: Record<string, AgentImplementation> = {};

  for (const agent of agents) {
    implementations[agent] = {
      agent,
      branch: `aog/${agent}/${taskId}`,
      worktreePath: "",
      diff: null,
      diffSummary: null,
      testResults: null,
      exitCode: null,
      pid: null,
      status: "pending",
      outputContent: null,
    };
  }

  // Create worktrees in parallel (with task context for worker environment)
  const worktrees = await Promise.all(
    agents.map(async (agent) => {
      const wt = await worktreeManager.create(taskId, agent, { task });
      implementations[agent].worktreePath = wt.path;
      return { agent, ...wt };
    })
  );

  if (progress) {
    await progress.worktreesCreated(agents);
  }

  const status = new CouncilStatus();
  for (const agent of agents) status.queue(agent);

  // Operation-aware guardrails: build = "implement only," research =
  // "no code edits," synthesize = "no implementation." Existing
  // `docs/IMPLEMENTATION-PLAN.md` and `research/` are auto-attached as
  // read-only context regardless of operation.
  const wrappedPrompt = wrapCouncilPrompt({
    task,
    operation,
    projectRoot: process.cwd(),
    outputPath,
  });

  const runFanOut = async (): Promise<void> => {
    const spawnPromises = worktrees.map(async ({ agent, path: cwd, branch }) => {
      implementations[agent].status = "running";
      status.start(agent);

      if (progress) {
        await progress.agentSpawned(agent);
      }

      try {
        const result = await agentManager.spawn(agent, {
          prompt: wrappedPrompt,
          cwd,
          taskId,
          timeout: options.timeout ?? 300_000,
          model: options.model?.[agent],
          // Worktree IS the sandbox — agents need write access.
          allowPermissionBypass: true,
        });

        implementations[agent].exitCode = result.status === "completed" ? 0 : 1;
        implementations[agent].status = result.status === "completed" ? "completed" : "failed";
        implementations[agent].result = result.result;

        let filesChanged: number | undefined;

        if (operation === "build") {
          const changes = await extractChanges(cwd, branch);
          if (changes) {
            implementations[agent].diff = changes.diff;
            implementations[agent].diffSummary = changes.diff_summary;
            filesChanged = changes.files_changed;
          }
        } else if (outputPath) {
          // Research/synthesize: read the content the agent wrote to
          // outputPath in its worktree. Used for content-based review +
          // chairman synthesis.
          const absPath = isAbsolute(outputPath) ? outputPath : join(cwd, outputPath);
          try {
            implementations[agent].outputContent = await readFile(absPath, "utf-8");
            filesChanged = 1;
          } catch {
            implementations[agent].outputContent = null;
            // Mark failed if the agent did not produce the expected file.
            if (implementations[agent].status === "completed") {
              implementations[agent].status = "failed";
              implementations[agent].exitCode = 1;
            }
          }
        }

        if (implementations[agent].status === "completed") {
          status.done(agent, filesChanged);
          if (progress) {
            await progress.agentCompleted(agent, result.duration_ms / 1000, filesChanged);
          }
        } else {
          status.fail(agent);
          if (progress) {
            await progress.agentFailed(agent);
          }
        }
      } catch {
        implementations[agent].status = "failed";
        implementations[agent].exitCode = 1;
        status.fail(agent);
        if (progress) {
          await progress.agentFailed(agent);
        }
      }
    });

    await Promise.allSettled(spawnPromises);
  };

  if (progress) {
    await progress.withCouncilHeartbeat(status, runFanOut);
  } else {
    await runFanOut();
  }

  return implementations;
}
