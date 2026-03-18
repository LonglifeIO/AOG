import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, AgentImplementation } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { extractChanges } from "../worktree/diff.js";

interface FanOutOptions {
  taskId: string;
  task: string;
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
 */
export async function fanOut(
  options: FanOutOptions
): Promise<Record<string, AgentImplementation>> {
  const { taskId, task, agents, agentManager, worktreeManager, progress } = options;
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

  // Spawn all agents in parallel
  const agentStartTimes: Record<string, number> = {};
  const spawnPromises = worktrees.map(async ({ agent, path: cwd, branch }) => {
    implementations[agent].status = "running";
    agentStartTimes[agent] = Date.now();

    if (progress) {
      await progress.agentSpawned(agent);
    }

    try {
      const result = await agentManager.spawn(agent, {
        prompt: task,
        cwd,
        taskId,
        timeout: options.timeout ?? 300_000,
        model: options.model?.[agent],
        // Worktree IS the sandbox — agents need write access to do their job
        allowPermissionBypass: true,
      });

      implementations[agent].exitCode = result.status === "completed" ? 0 : 1;
      implementations[agent].status = result.status === "completed" ? "completed" : "failed";

      const changes = await extractChanges(cwd, branch);
      if (changes) {
        implementations[agent].diff = changes.diff;
        implementations[agent].diffSummary = changes.diff_summary;
      }

      if (progress) {
        const durationSec = (Date.now() - agentStartTimes[agent]) / 1000;
        const filesChanged = changes ? changes.files_changed : undefined;
        if (implementations[agent].status === "completed") {
          await progress.agentCompleted(agent, durationSec, filesChanged);
        } else {
          await progress.agentFailed(agent);
        }
      }
    } catch {
      implementations[agent].status = "failed";
      implementations[agent].exitCode = 1;
      if (progress) {
        await progress.agentFailed(agent);
      }
    }
  });

  await Promise.allSettled(spawnPromises);

  return implementations;
}
