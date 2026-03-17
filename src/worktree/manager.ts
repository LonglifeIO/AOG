import { simpleGit, type SimpleGit } from "simple-git";
import { join } from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AgentId } from "../agents/types.js";

interface WorktreeInfo {
  taskId: string;
  agent: AgentId;
  path: string;
  branch: string;
  createdAt: string;
}

interface WorktreeRegistry {
  worktrees: WorktreeInfo[];
}

export class WorktreeManager {
  private git: SimpleGit;
  private worktreeRoot: string;
  private registryPath: string;
  private stateDir: string;
  private registryLock: Promise<void> = Promise.resolve();

  constructor(private projectRoot: string) {
    this.git = simpleGit(projectRoot);
    this.worktreeRoot = join(projectRoot, ".worktrees");
    this.stateDir = join(projectRoot, ".aog");
    this.registryPath = join(this.stateDir, "worktrees.json");
  }

  async initialize(): Promise<void> {
    await mkdir(this.worktreeRoot, { recursive: true });
    await mkdir(this.stateDir, { recursive: true });
    await this.pruneOrphans();
  }

  async create(
    taskId: string,
    agent: AgentId,
    taskContext?: { task: string; scopedFiles?: string[]; readOnlyContext?: string[] }
  ): Promise<{ path: string; branch: string }> {
    const branch = `aog/${agent}/${taskId}`;
    const wtPath = join(this.worktreeRoot, `agent-${agent}-${taskId}`);

    await this.git.raw(["worktree", "add", wtPath, "-b", branch]);

    const info: WorktreeInfo = {
      taskId,
      agent,
      path: wtPath,
      branch,
      createdAt: new Date().toISOString(),
    };
    await this.registerWorktree(info);

    // Setup worker environment (instruction files, skills)
    if (taskContext) {
      const { setupWorkerEnvironment } = await import("../dispatch/environment.js");
      await setupWorkerEnvironment({
        taskId,
        task: taskContext.task,
        agent,
        worktreePath: wtPath,
        projectRoot: this.projectRoot,
        scopedFiles: taskContext.scopedFiles,
        readOnlyContext: taskContext.readOnlyContext,
      }).catch(() => {}); // Best effort — don't fail worktree creation
    }

    return { path: wtPath, branch };
  }

  async remove(taskId: string, agent: AgentId): Promise<void> {
    const wtPath = join(this.worktreeRoot, `agent-${agent}-${taskId}`);
    const branch = `aog/${agent}/${taskId}`;

    try {
      if (existsSync(wtPath)) {
        await this.git.raw(["worktree", "remove", wtPath, "--force"]);
      }
    } catch {
      // Already removed
    }

    try {
      await this.git.raw(["branch", "-D", branch]);
    } catch {
      // Already deleted
    }

    await this.unregisterWorktree(taskId, agent);
  }

  async removeAll(taskId: string): Promise<void> {
    const registry = await this.loadRegistry();
    const taskWorktrees = registry.worktrees.filter((w) => w.taskId === taskId);

    for (const wt of taskWorktrees) {
      await this.remove(wt.taskId, wt.agent);
    }

    await this.prune();
  }

  async prune(): Promise<void> {
    try {
      await this.git.raw(["worktree", "prune", "--expire", "now"]);
    } catch {
      // Best effort
    }
  }

  async listForTask(taskId: string): Promise<WorktreeInfo[]> {
    const registry = await this.loadRegistry();
    return registry.worktrees.filter((w) => w.taskId === taskId);
  }

  async getWorktreePath(taskId: string, agent: AgentId): Promise<string | null> {
    const registry = await this.loadRegistry();
    const entry = registry.worktrees.find(
      (w) => w.taskId === taskId && w.agent === agent
    );
    return entry?.path ?? null;
  }

  private async pruneOrphans(): Promise<void> {
    const registry = await this.loadRegistry();
    const validWorktrees: WorktreeInfo[] = [];

    for (const wt of registry.worktrees) {
      if (existsSync(wt.path)) {
        validWorktrees.push(wt);
      } else {
        try {
          await this.git.raw(["branch", "-D", wt.branch]);
        } catch {
          // Branch already gone
        }
      }
    }

    await this.saveRegistry({ worktrees: validWorktrees });
    await this.prune();
  }

  private async registerWorktree(info: WorktreeInfo): Promise<void> {
    await this.withRegistryLock(async () => {
      const registry = await this.loadRegistry();
      registry.worktrees.push(info);
      await this.saveRegistry(registry);
    });
  }

  private async unregisterWorktree(taskId: string, agent: AgentId): Promise<void> {
    await this.withRegistryLock(async () => {
      const registry = await this.loadRegistry();
      registry.worktrees = registry.worktrees.filter(
        (w) => !(w.taskId === taskId && w.agent === agent)
      );
      await this.saveRegistry(registry);
    });
  }

  /** Serialize registry access to prevent parallel write races */
  private async withRegistryLock(fn: () => Promise<void>): Promise<void> {
    const prev = this.registryLock;
    let resolve: () => void;
    this.registryLock = new Promise<void>((r) => { resolve = r; });
    await prev;
    try {
      await fn();
    } finally {
      resolve!();
    }
  }

  private async loadRegistry(): Promise<WorktreeRegistry> {
    try {
      const data = await readFile(this.registryPath, "utf-8");
      return JSON.parse(data);
    } catch {
      return { worktrees: [] };
    }
  }

  private async saveRegistry(registry: WorktreeRegistry): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const tmpPath = this.registryPath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
    await rename(tmpPath, this.registryPath);
  }
}
