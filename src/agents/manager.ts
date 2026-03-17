import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentSpawner, AgentId, AgentResult, SpawnOptions } from "./types.js";
import { ClaudeSpawner } from "./claude.js";
import { CodexSpawner } from "./codex.js";
import { GeminiSpawner } from "./gemini.js";

interface PidEntry {
  taskId: string;
  agent: AgentId;
  pid: number;
  startedAt: string;
}

export class AgentManager {
  private spawners: Map<AgentId, AgentSpawner> = new Map();
  private available: Set<AgentId> = new Set();
  private pids: Map<number, PidEntry> = new Map();
  private stateDir: string;

  constructor(private projectRoot: string) {
    this.stateDir = join(projectRoot, ".aog");
    this.spawners.set("claude", new ClaudeSpawner());
    this.spawners.set("codex", new CodexSpawner());
    this.spawners.set("gemini", new GeminiSpawner());
  }

  async initialize(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await this.detectAvailableCLIs();
    await this.cleanupOrphanedProcesses();
  }

  async detectAvailableCLIs(): Promise<Map<AgentId, string | null>> {
    const results = new Map<AgentId, string | null>();

    for (const [id, spawner] of this.spawners) {
      if (await spawner.isAvailable()) {
        this.available.add(id);
        const version = await spawner.getVersion();
        results.set(id, version);
      } else {
        results.set(id, null);
      }
    }

    return results;
  }

  getAvailableAgents(): AgentId[] {
    return Array.from(this.available);
  }

  isAvailable(agent: AgentId): boolean {
    return this.available.has(agent);
  }

  async spawn(agent: AgentId, options: SpawnOptions): Promise<AgentResult> {
    const spawner = this.spawners.get(agent);
    if (!spawner) {
      throw new Error(`Unknown agent: ${agent}`);
    }
    if (!this.available.has(agent)) {
      throw new Error(`Agent ${agent} is not available (CLI not installed)`);
    }

    return await spawner.spawn(options);
  }

  async spawnParallel(
    agents: AgentId[],
    options: Omit<SpawnOptions, "cwd"> & { cwdMap: Record<string, string> }
  ): Promise<Map<AgentId, AgentResult>> {
    const results = new Map<AgentId, AgentResult>();

    const promises = agents
      .filter((a) => this.available.has(a))
      .map(async (agent) => {
        const cwd = options.cwdMap[agent];
        if (!cwd) throw new Error(`No working directory for agent ${agent}`);

        const result = await this.spawn(agent, { ...options, cwd });
        results.set(agent, result);
      });

    await Promise.allSettled(promises);
    return results;
  }

  async killAgent(pid: number): Promise<void> {
    const entry = this.pids.get(pid);
    if (!entry) return;

    const spawner = this.spawners.get(entry.agent);
    if (spawner) {
      await spawner.kill(pid);
    }
    this.pids.delete(pid);
    await this.savePids();
  }

  async killAll(taskId?: string): Promise<void> {
    for (const [pid, entry] of this.pids) {
      if (!taskId || entry.taskId === taskId) {
        await this.killAgent(pid);
      }
    }
  }

  registerPid(taskId: string, agent: AgentId, pid: number): void {
    this.pids.set(pid, { taskId, agent, pid, startedAt: new Date().toISOString() });
    this.savePids().catch(() => {});
  }

  private async cleanupOrphanedProcesses(): Promise<void> {
    const pidsFile = join(this.stateDir, "pids.json");
    if (!existsSync(pidsFile)) return;

    try {
      const data = await readFile(pidsFile, "utf-8");
      const entries: PidEntry[] = JSON.parse(data);

      for (const entry of entries) {
        try {
          process.kill(entry.pid, 0);
          const spawner = this.spawners.get(entry.agent);
          if (spawner) await spawner.kill(entry.pid);
        } catch {
          // Process already dead
        }
      }

      await writeFile(pidsFile, "[]", "utf-8");
    } catch {
      // Corrupt pids file
    }
  }

  private async savePids(): Promise<void> {
    const pidsFile = join(this.stateDir, "pids.json");
    const entries = Array.from(this.pids.values());
    await writeFile(pidsFile, JSON.stringify(entries, null, 2), "utf-8");
  }
}
