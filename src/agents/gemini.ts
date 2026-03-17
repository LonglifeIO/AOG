import { execa } from "execa";
import type { AgentSpawner, AgentResult, SpawnOptions, CostInfo } from "./types.js";

interface GeminiJsonOutput {
  response: string;
  stats?: {
    models?: Record<string, {
      api?: { totalRequests: number; totalErrors: number; totalLatencyMs: number };
      tokens?: { prompt: number; candidates: number; total: number; cached?: number };
    }>;
    tools?: { totalCalls: number; totalSuccess: number; totalFail: number };
    files?: { totalLinesAdded: number; totalLinesRemoved: number };
  };
}

export class GeminiSpawner implements AgentSpawner {
  readonly name = "gemini" as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execa("which", ["gemini"]);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execa("gemini", ["--version"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async spawn(options: SpawnOptions): Promise<AgentResult> {
    const startTime = Date.now();
    const args = this.buildArgs(options);

    try {
      const { stdout, exitCode } = await execa("gemini", args, {
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

    if (!options.readOnly) {
      args.push("--yolo");
    }

    if (options.model) {
      args.push("-m", options.model);
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
      const output: GeminiJsonOutput = JSON.parse(stdout);
      const cost = this.extractCost(output);

      return {
        taskId: options.taskId,
        agent: "gemini",
        model: options.model ?? "gemini-2.5-pro",
        status: exitCode === 0 ? "completed" : "failed",
        duration_ms,
        result: output.response ?? "",
        cost,
        changes: null,
        tests: null,
        session: { id: options.taskId, resumable: false },
      };
    } catch {
      return {
        taskId: options.taskId,
        agent: "gemini",
        model: options.model ?? "gemini-2.5-pro",
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

  private extractCost(output: GeminiJsonOutput): CostInfo {
    if (!output.stats?.models) {
      return { usd: null, tokens_in: null, tokens_out: null };
    }

    let tokensIn = 0;
    let tokensOut = 0;

    for (const modelStats of Object.values(output.stats.models)) {
      if (modelStats.tokens) {
        tokensIn += modelStats.tokens.prompt ?? 0;
        tokensOut += modelStats.tokens.candidates ?? 0;
      }
    }

    return {
      usd: null,
      tokens_in: tokensIn || null,
      tokens_out: tokensOut || null,
    };
  }

  private errorResult(
    options: SpawnOptions,
    duration_ms: number,
    status: "failed" | "timeout",
    message: string
  ): AgentResult {
    return {
      taskId: options.taskId,
      agent: "gemini",
      model: options.model ?? "gemini-2.5-pro",
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
