import type { AgentId } from "../agents/types.js";
import type { CouncilStatus } from "./status.js";

/**
 * Progress reporting for long-running AOG operations.
 * Sends MCP notifications/progress to keep clients informed.
 *
 * Uses the MCP progress notification protocol:
 * - progressToken: opaque token from the client request
 * - progress: current step number
 * - total: total expected steps (optional)
 * - message: human-readable status line
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProgressSender = (notification: any) => Promise<void>;

export interface ProgressUpdate {
  taskId: string;
  stage: string;
  agent?: AgentId;
  percent?: number;
  message: string;
  timestamp: string;
}

export type OnProgress = (message: string, progress?: number, total?: number) => void;

export class ProgressReporter {
  private updates: ProgressUpdate[] = [];
  private step = 0;
  private totalSteps?: number;
  private sender: ProgressSender | null;
  private progressToken: string | number | null;
  private taskId: string;

  constructor(options: {
    taskId: string;
    sender?: ProgressSender | null;
    progressToken?: string | number | null;
    totalSteps?: number;
  }) {
    this.taskId = options.taskId;
    this.sender = options.sender ?? null;
    this.progressToken = options.progressToken ?? null;
    this.totalSteps = options.totalSteps;
  }

  /**
   * Send a progress update via MCP and record it locally.
   */
  async notify(message: string, stage?: string, agent?: AgentId): Promise<void> {
    this.step++;
    const update: ProgressUpdate = {
      taskId: this.taskId,
      stage: stage ?? "",
      agent,
      percent: this.totalSteps ? Math.round((this.step / this.totalSteps) * 100) : undefined,
      message,
      timestamp: new Date().toISOString(),
    };
    this.updates.push(update);

    // Send MCP progress notification if we have a sender and token
    if (this.sender && this.progressToken != null) {
      try {
        await this.sender({
          method: "notifications/progress",
          params: {
            progressToken: this.progressToken,
            progress: this.step,
            total: this.totalSteps,
            message,
          },
        });
      } catch {
        // Don't let notification failures break the operation
      }
    }

    // Always log to stderr for MCP server debugging
    console.error(`[aog] ${message}`);
  }

  /**
   * Return an OnProgress callback for sub-components.
   */
  callback(): OnProgress {
    return (message: string) => {
      void this.notify(message);
    };
  }

  getHistory(): ProgressUpdate[] {
    return [...this.updates];
  }

  // Convenience methods for common operations

  async councilStarted(agents: AgentId[]): Promise<void> {
    await this.notify(`Council started — ${agents.length} agents (${agents.join(", ")})`, "setup");
  }

  async worktreesCreated(agents: AgentId[]): Promise<void> {
    await this.notify(`Worktrees created for ${agents.join(", ")}`, "setup");
  }

  async agentSpawned(agent: AgentId): Promise<void> {
    await this.notify(`${agent}: implementing…`, "fan-out", agent);
  }

  async agentCompleted(agent: AgentId, durationSec: number, filesChanged?: number): Promise<void> {
    const parts = [`${agent}: done (${durationSec.toFixed(0)}s`];
    if (filesChanged !== undefined) parts[0] += `, ${filesChanged} files changed`;
    parts[0] += ")";
    await this.notify(parts[0], "fan-out", agent);
  }

  async agentFailed(agent: AgentId): Promise<void> {
    await this.notify(`${agent}: failed`, "fan-out", agent);
  }

  async testsStarted(): Promise<void> {
    await this.notify("Running tests…", "test");
  }

  async testsCompleted(passed: number, total: number): Promise<void> {
    await this.notify(`Tests: ${passed}/${total} agents passed`, "test");
  }

  async reviewStarted(agents: AgentId[]): Promise<void> {
    await this.notify(`Cross-review started (${agents.join(", ")})`, "review");
  }

  async reviewCompleted(): Promise<void> {
    await this.notify("Cross-review complete", "review");
  }

  async synthesisStarted(chairman: AgentId): Promise<void> {
    await this.notify(`Chairman ${chairman} synthesizing…`, "synthesis", chairman);
  }

  async synthesisCompleted(strategy: string): Promise<void> {
    await this.notify(`Synthesis complete (${strategy})`, "synthesis");
  }

  async delegateStarted(agent: AgentId): Promise<void> {
    await this.notify(`Delegating to ${agent}…`, "delegate", agent);
  }

  async delegateWorktreeCreated(agent: AgentId): Promise<void> {
    await this.notify(`Worktree created for ${agent}`, "setup", agent);
  }

  async pipelineStageStarted(stageId: string): Promise<void> {
    await this.notify(`Stage started: ${stageId}`, stageId);
  }

  async pipelineStageCompleted(stageId: string): Promise<void> {
    await this.notify(`Stage completed: ${stageId}`, stageId);
  }

  async pipelineStageFailed(stageId: string, reason?: string): Promise<void> {
    const msg = reason ? `Stage failed: ${stageId} — ${reason}` : `Stage failed: ${stageId}`;
    await this.notify(msg, stageId);
  }

  async approvalAutoApproved(stageId: string): Promise<void> {
    await this.notify(`Approval auto-approved: ${stageId} (resume not implemented)`, stageId);
  }

  /**
   * Wrap a long-running operation with a single-agent heartbeat — emits a
   * "still working" notification every `intervalMs` until the work resolves.
   * Used for delegate and pipeline sequential stages.
   */
  async withHeartbeat<T>(
    agent: AgentId,
    stage: string,
    fn: () => Promise<T>,
    intervalMs = 8000
  ): Promise<T> {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      void this.notify(`${agent} working… ${sec}s`, stage, agent);
    }, intervalMs);
    try {
      return await fn();
    } finally {
      clearInterval(interval);
    }
  }

  /**
   * Wrap a council fan-out with a unified-status heartbeat — emits one line
   * showing every agent's state every `intervalMs` until all agents finish.
   * The caller updates `status` (start/done/fail) as each agent transitions.
   */
  async withCouncilHeartbeat<T>(
    status: CouncilStatus,
    fn: () => Promise<T>,
    intervalMs = 5000
  ): Promise<T> {
    const interval = setInterval(() => {
      void this.notify(status.format(), "fan-out");
    }, intervalMs);
    try {
      return await fn();
    } finally {
      clearInterval(interval);
      // Final status snapshot once everyone settled
      void this.notify(status.format(), "fan-out");
    }
  }
}
