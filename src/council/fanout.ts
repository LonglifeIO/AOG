import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId, AgentImplementation } from "../agents/types.js";
import { extractChanges } from "../worktree/diff.js";

interface FanOutOptions {
  taskId: string;
  task: string;
  agents: AgentId[];
  agentManager: AgentManager;
  worktreeManager: WorktreeManager;
  timeout?: number;
  model?: Record<AgentId, string>;
}

/**
 * Fan out a task to multiple agents, each working in an isolated worktree.
 * All agents run in parallel — total time = max(individual times).
 */
export async function fanOut(
  options: FanOutOptions
): Promise<Record<string, AgentImplementation>> {
  const { taskId, task, agents, agentManager, worktreeManager } = options;
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

  // Spawn all agents in parallel
  const spawnPromises = worktrees.map(async ({ agent, path: cwd, branch }) => {
    implementations[agent].status = "running";

    try {
      const result = await agentManager.spawn(agent, {
        prompt: task,
        cwd,
        taskId,
        timeout: options.timeout ?? 300_000,
        model: options.model?.[agent],
      });

      implementations[agent].exitCode = result.status === "completed" ? 0 : 1;
      implementations[agent].status = result.status === "completed" ? "completed" : "failed";

      const changes = await extractChanges(cwd, branch);
      if (changes) {
        implementations[agent].diff = changes.diff;
        implementations[agent].diffSummary = changes.diff_summary;
      }
    } catch {
      implementations[agent].status = "failed";
      implementations[agent].exitCode = 1;
    }
  });

  await Promise.allSettled(spawnPromises);

  return implementations;
}
