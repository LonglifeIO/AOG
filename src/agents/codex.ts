import { execa } from "execa";
import type { AgentSpawner, AgentResult, SpawnOptions, CostInfo, SessionInfo } from "./types.js";

interface CodexTurnEvent {
  type: string;
  usage?: { input_tokens: number; output_tokens: number };
  message?: { content: Array<{ type: string; text?: string }> };
  threadId?: string;
}

export class CodexSpawner implements AgentSpawner {
  readonly name = "codex" as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execa("which", ["codex"]);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execa("codex", ["--version"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async spawn(options: SpawnOptions): Promise<AgentResult> {
    const startTime = Date.now();
    const args = this.buildArgs(options);

    try {
      const { stdout, exitCode } = await execa("codex", args, {
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
    const args: string[] = ["exec", options.prompt, "--json"];

    if (!options.readOnly) {
      args.push("--full-auto");
    } else {
      args.push("--sandbox", "read-only");
    }

    args.push("--cd", options.cwd);

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
    const lines = stdout.trim().split("\n").filter(Boolean);
    let finalText = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let threadId: string | null = null;

    for (const line of lines) {
      try {
        const event: CodexTurnEvent = JSON.parse(line);

        if (event.type === "turn.completed" && event.usage) {
          tokensIn += event.usage.input_tokens;
          tokensOut += event.usage.output_tokens;
        }

        if (event.type === "item.completed" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              finalText += block.text;
            }
          }
        }

        if (event.threadId) {
          threadId = event.threadId;
        }
      } catch {
        finalText += line;
      }
    }

    const cost: CostInfo = {
      usd: null,
      tokens_in: tokensIn || null,
      tokens_out: tokensOut || null,
    };

    const session: SessionInfo = {
      id: threadId ?? options.taskId,
      resumable: threadId !== null,
    };

    return {
      taskId: options.taskId,
      agent: "codex",
      model: options.model ?? "gpt-5.4",
      status: exitCode === 0 ? "completed" : "failed",
      duration_ms,
      result: finalText,
      cost,
      changes: null,
      tests: null,
      session,
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
      agent: "codex",
      model: options.model ?? "gpt-5.4",
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
