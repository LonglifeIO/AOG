import { execa } from "execa";
import type { AgentSpawner, AgentResult, SpawnOptions, CostInfo, SessionInfo } from "./types.js";

interface ClaudeJsonOutput {
  type: string;
  subtype: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
  result: string;
}

export class ClaudeSpawner implements AgentSpawner {
  readonly name = "claude" as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execa("which", ["claude"]);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execa("claude", ["--version"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async spawn(options: SpawnOptions): Promise<AgentResult> {
    const startTime = Date.now();
    const args = this.buildArgs(options);

    try {
      const { stdout, exitCode } = await execa("claude", args, {
        cwd: options.cwd,
        timeout: options.timeout ?? 300_000,
        env: { ...process.env, NO_COLOR: "1" },
        stdin: "ignore",
      });
      const duration_ms = Date.now() - startTime;

      return this.parseOutput(stdout, options, duration_ms, exitCode ?? 0);
    } catch (error: unknown) {
      const duration_ms = Date.now() - startTime;
      const err = error as { timedOut?: boolean; stderr?: string };

      if (err.timedOut) {
        return this.errorResult(options, duration_ms, "timeout", "Agent timed out");
      }

      return this.errorResult(options, duration_ms, "failed", err.stderr ?? "Unknown error");
    }
  }

  async kill(pid: number): Promise<void> {
    const treeKill = (await import("tree-kill")).default;
    return new Promise((resolve) => {
      treeKill(pid, "SIGTERM", () => resolve());
    });
  }

  private buildArgs(options: SpawnOptions): string[] {
    const args: string[] = ["-p", options.prompt, "--output-format", "json"];

    if (!options.readOnly && options.allowPermissionBypass) {
      args.push("--dangerously-skip-permissions");
    }

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.maxTurns) {
      args.push("--max-turns", String(options.maxTurns));
    }

    if (options.maxBudgetUsd) {
      args.push("--max-budget-usd", String(options.maxBudgetUsd));
    }

    if (options.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }

    // Only pass --session-id if taskId is a valid UUID
    if (options.taskId.length >= 32 && options.taskId.includes("-")) {
      args.push("--session-id", options.taskId);
    }

    return args;
  }

  private parseOutput(
    stdout: string,
    options: SpawnOptions,
    duration_ms: number,
    exitCode: number
  ): AgentResult {
    try {
      const output: ClaudeJsonOutput = JSON.parse(stdout);

      const cost: CostInfo = {
        usd: output.total_cost_usd ?? null,
        tokens_in: null,
        tokens_out: null,
      };

      const session: SessionInfo = {
        id: output.session_id ?? options.taskId,
        resumable: true,
      };

      return {
        taskId: options.taskId,
        agent: "claude",
        model: options.model ?? "sonnet",
        status: output.is_error ? "failed" : "completed",
        duration_ms,
        result: output.result ?? "",
        cost,
        changes: null, // Extracted from git separately
        tests: null,   // Run separately
        session,
      };
    } catch {
      return {
        taskId: options.taskId,
        agent: "claude",
        model: options.model ?? "sonnet",
        status: exitCode === 0 ? "completed" : "failed",
        duration_ms,
        result: stdout,
        cost: { usd: null, tokens_in: null, tokens_out: null },
        changes: null,
        tests: null,
        session: { id: options.taskId, resumable: false },
      };
    }
  }

  private errorResult(
    options: SpawnOptions,
    duration_ms: number,
    status: "failed" | "timeout",
    message: string
  ): AgentResult {
    return {
      taskId: options.taskId,
      agent: "claude",
      model: options.model ?? "sonnet",
      status,
      duration_ms,
      result: message,
      cost: { usd: null, tokens_in: null, tokens_out: null },
      changes: null,
      tests: null,
      session: { id: options.taskId, resumable: false },
    };
  }
}
