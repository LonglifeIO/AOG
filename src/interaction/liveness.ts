import type { AgentId } from "../agents/types.js";

export interface LivenessConfig {
  heartbeat_interval_ms: number;  // Check process alive (default: 15000)
  stall_warn_ms: number;          // No output for this long → warn (default: 60000)
  stall_kill_ms: number;          // No output for this long → kill option (default: 120000)
  timeouts: Record<string, number>; // Per-agent timeout in ms
}

const DEFAULT_LIVENESS: LivenessConfig = {
  heartbeat_interval_ms: 15_000,
  stall_warn_ms: 60_000,
  stall_kill_ms: 120_000,
  timeouts: {
    claude: 300_000,
    codex: 300_000,
    gemini: 180_000,
  },
};

export type LivenessEvent =
  | { type: "heartbeat"; agent: AgentId; pid: number; alive: boolean }
  | { type: "stall_warning"; agent: AgentId; pid: number; silent_ms: number }
  | { type: "stall_critical"; agent: AgentId; pid: number; silent_ms: number }
  | { type: "timeout"; agent: AgentId; pid: number; elapsed_ms: number }
  | { type: "exited"; agent: AgentId; pid: number; exitCode: number | null };

export type LivenessCallback = (event: LivenessEvent) => void;

interface TrackedProcess {
  agent: AgentId;
  pid: number;
  taskId: string;
  startedAt: number;
  lastActivity: number;
}

export class LivenessMonitor {
  private tracked: Map<number, TrackedProcess> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private callback: LivenessCallback | null = null;
  private config: LivenessConfig;

  constructor(config?: Partial<LivenessConfig>) {
    this.config = { ...DEFAULT_LIVENESS, ...config };
  }

  start(callback: LivenessCallback): void {
    this.callback = callback;
    this.interval = setInterval(() => this.check(), this.config.heartbeat_interval_ms);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.tracked.clear();
  }

  track(agent: AgentId, pid: number, taskId: string): void {
    const now = Date.now();
    this.tracked.set(pid, { agent, pid, taskId, startedAt: now, lastActivity: now });
  }

  untrack(pid: number): void {
    this.tracked.delete(pid);
  }

  recordActivity(pid: number): void {
    const entry = this.tracked.get(pid);
    if (entry) {
      entry.lastActivity = Date.now();
    }
  }

  getTimeout(agent: AgentId): number {
    return this.config.timeouts[agent] ?? this.config.timeouts.claude ?? 300_000;
  }

  private check(): void {
    if (!this.callback) return;
    const now = Date.now();

    for (const [pid, proc] of this.tracked) {
      // Check if process is alive
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }

      if (!alive) {
        this.callback({ type: "exited", agent: proc.agent, pid, exitCode: null });
        this.tracked.delete(pid);
        continue;
      }

      this.callback({ type: "heartbeat", agent: proc.agent, pid, alive: true });

      // Check for stalls
      const silentMs = now - proc.lastActivity;
      if (silentMs >= this.config.stall_kill_ms) {
        this.callback({ type: "stall_critical", agent: proc.agent, pid, silent_ms: silentMs });
      } else if (silentMs >= this.config.stall_warn_ms) {
        this.callback({ type: "stall_warning", agent: proc.agent, pid, silent_ms: silentMs });
      }

      // Check for timeout
      const elapsed = now - proc.startedAt;
      const timeout = this.getTimeout(proc.agent);
      if (elapsed >= timeout) {
        this.callback({ type: "timeout", agent: proc.agent, pid, elapsed_ms: elapsed });
      }
    }
  }
}
