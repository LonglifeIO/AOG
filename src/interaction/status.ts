import type { AgentId } from "../agents/types.js";

/**
 * Tracks per-agent state across a council fan-out so the heartbeat can
 * emit a unified one-line status update covering every agent.
 *
 * The output format is intentionally compact for single-line MCP UI:
 *   "claude:43s ⟳ | codex:31s ✓ 5f | gemini:47s ⟳"
 */

export type AgentRunState = "queued" | "running" | "done" | "failed";

interface AgentEntry {
  state: AgentRunState;
  startedAt: number;
  endedAt?: number;
  filesChanged?: number;
}

const ICONS: Record<AgentRunState, string> = {
  queued: "·",
  running: "⟳",
  done: "✓",
  failed: "✗",
};

export class CouncilStatus {
  private entries: Map<AgentId, AgentEntry> = new Map();

  queue(agent: AgentId): void {
    this.entries.set(agent, { state: "queued", startedAt: Date.now() });
  }

  start(agent: AgentId): void {
    const existing = this.entries.get(agent);
    this.entries.set(agent, {
      state: "running",
      startedAt: existing?.startedAt ?? Date.now(),
    });
  }

  done(agent: AgentId, filesChanged?: number): void {
    const existing = this.entries.get(agent);
    if (!existing) return;
    existing.state = "done";
    existing.endedAt = Date.now();
    if (filesChanged !== undefined) existing.filesChanged = filesChanged;
  }

  fail(agent: AgentId): void {
    const existing = this.entries.get(agent);
    if (!existing) return;
    existing.state = "failed";
    existing.endedAt = Date.now();
  }

  /**
   * Has every tracked agent reached a terminal state?
   */
  allFinished(): boolean {
    if (this.entries.size === 0) return false;
    for (const entry of this.entries.values()) {
      if (entry.state === "queued" || entry.state === "running") return false;
    }
    return true;
  }

  /**
   * Compact one-line status across all agents.
   */
  format(): string {
    const parts: string[] = [];
    for (const [agent, entry] of this.entries) {
      const elapsedMs = (entry.endedAt ?? Date.now()) - entry.startedAt;
      const sec = Math.floor(elapsedMs / 1000);
      const filesPart = entry.filesChanged !== undefined ? ` ${entry.filesChanged}f` : "";
      parts.push(`${agent}:${sec}s ${ICONS[entry.state]}${filesPart}`);
    }
    return parts.join(" | ");
  }

  summary(): { running: number; done: number; failed: number; total: number } {
    let running = 0, done = 0, failed = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === "running" || entry.state === "queued") running++;
      else if (entry.state === "done") done++;
      else if (entry.state === "failed") failed++;
    }
    return { running, done, failed, total: this.entries.size };
  }
}
