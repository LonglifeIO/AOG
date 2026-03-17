import type { AgentId } from "../agents/types.js";

/**
 * Progress reporting for long-running AOG operations.
 * Formats progress updates as MCP-compatible content blocks.
 *
 * In MCP, long-running tools return partial results via progress notifications.
 * AOG uses these to keep the user informed between decision gates.
 */

export interface ProgressUpdate {
  taskId: string;
  stage: string;
  agent?: AgentId;
  percent?: number; // 0-100
  message: string;
  timestamp: string;
}

export class ProgressReporter {
  private updates: ProgressUpdate[] = [];
  private listeners: Array<(update: ProgressUpdate) => void> = [];

  report(update: Omit<ProgressUpdate, "timestamp">): void {
    const full: ProgressUpdate = {
      ...update,
      timestamp: new Date().toISOString(),
    };
    this.updates.push(full);

    for (const listener of this.listeners) {
      listener(full);
    }
  }

  onProgress(listener: (update: ProgressUpdate) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getHistory(): ProgressUpdate[] {
    return [...this.updates];
  }

  formatForMcp(update: ProgressUpdate): string {
    const parts: string[] = [];

    if (update.stage) parts.push(`[${update.stage}]`);
    if (update.agent) parts.push(`(${update.agent})`);
    if (update.percent !== undefined) parts.push(`${update.percent}%`);
    parts.push(update.message);

    return parts.join(" ");
  }

  // Standard progress messages for common operations
  stageStarted(taskId: string, stage: string): void {
    this.report({ taskId, stage, message: `Stage started: ${stage}` });
  }

  stageCompleted(taskId: string, stage: string): void {
    this.report({ taskId, stage, percent: 100, message: `Stage completed: ${stage}` });
  }

  agentSpawned(taskId: string, agent: AgentId): void {
    this.report({ taskId, stage: "dispatch", agent, message: `${agent} spawned` });
  }

  agentCompleted(taskId: string, agent: AgentId, status: string): void {
    this.report({ taskId, stage: "dispatch", agent, message: `${agent} ${status}` });
  }

  worktreeCreated(taskId: string, agent: AgentId): void {
    this.report({ taskId, stage: "setup", agent, message: `Worktree created for ${agent}` });
  }

  reviewStarted(taskId: string, reviewer: AgentId): void {
    this.report({ taskId, stage: "review", agent: reviewer, message: `${reviewer} reviewing` });
  }

  synthesisStarted(taskId: string, chairman: AgentId): void {
    this.report({ taskId, stage: "synthesis", agent: chairman, message: `Chairman ${chairman} synthesizing` });
  }
}
