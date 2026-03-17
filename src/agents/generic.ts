import { execa } from "execa";
import type { AgentSpawner, AgentId, AgentResult, SpawnOptions, CostInfo } from "./types.js";

/**
 * Config-driven CLI agent definition.
 * Loaded from agents.config.yaml or hardcoded defaults.
 */
export interface AgentConfig {
  id: string;
  command: string;
  detect: string;
  headless: string[];         // Template args with {prompt}, {cwd}, {maxTurns}
  output_format: "json" | "jsonl" | "text";
  output_parser: string;      // Maps to a parser in utils/output.ts
  strengths: string[];
  instruction_file: string;   // e.g., "CLAUDE.md", "AGENTS.md"
  timeout_seconds: number;
}

/**
 * Generic CLI agent that builds its invocation from config.
 * Existing spawners (claude.ts, codex.ts, gemini.ts) handle CLI-specific quirks
 * and extend this for type-safe parsing.
 */
export class GenericCLIAgent implements AgentSpawner {
  readonly name: AgentId;

  constructor(private config: AgentConfig) {
    this.name = config.id as AgentId;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const [cmd, ...args] = this.config.detect.split(" ");
      await execa(cmd, args);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const [cmd, ...args] = this.config.detect.split(" ");
      const { stdout } = await execa(cmd, args);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async spawn(options: SpawnOptions): Promise<AgentResult> {
    const startTime = Date.now();
    const args = this.buildArgs(options);

    try {
      const { stdout, exitCode } = await execa(this.config.command, args, {
        cwd: options.cwd,
        timeout: options.timeout ?? this.config.timeout_seconds * 1000,
        env: { ...process.env, NO_COLOR: "1" },
      });

      const duration_ms = Date.now() - startTime;

      return {
        taskId: options.taskId,
        agent: this.name,
        model: options.model ?? "default",
        status: exitCode === 0 ? "completed" : "failed",
        duration_ms,
        result: stdout,
        cost: { usd: null, tokens_in: null, tokens_out: null },
        changes: null,
        tests: null,
        session: { id: options.taskId, resumable: false },
      };
    } catch (error: unknown) {
      const duration_ms = Date.now() - startTime;
      const err = error as { timedOut?: boolean; stderr?: string };

      return {
        taskId: options.taskId,
        agent: this.name,
        model: options.model ?? "default",
        status: err.timedOut ? "timeout" : "failed",
        duration_ms,
        result: err.stderr ?? "Unknown error",
        cost: { usd: null, tokens_in: null, tokens_out: null },
        changes: null,
        tests: null,
        session: { id: options.taskId, resumable: false },
      };
    }
  }

  async kill(pid: number): Promise<void> {
    const treeKill = (await import("tree-kill")).default;
    return new Promise((resolve) => {
      treeKill(pid, "SIGTERM", () => resolve());
    });
  }

  /**
   * Build CLI arguments from config template.
   * Replaces {prompt}, {cwd}, {maxTurns}, {model} placeholders.
   */
  protected buildArgs(options: SpawnOptions): string[] {
    return this.config.headless.map((arg) =>
      arg
        .replace("{prompt}", options.prompt)
        .replace("{cwd}", options.cwd)
        .replace("{maxTurns}", String(options.maxTurns ?? 20))
        .replace("{model}", options.model ?? "default")
        .replace("{maxBudgetUsd}", String(options.maxBudgetUsd ?? 5))
    );
  }
}

// Default configs for the three built-in agents
export const DEFAULT_AGENT_CONFIGS: Record<string, AgentConfig> = {
  claude: {
    id: "claude",
    command: "claude",
    detect: "claude --version",
    headless: ["-p", "{prompt}", "--output-format", "json", "--dangerously-skip-permissions", "--max-turns", "{maxTurns}"],
    output_format: "json",
    output_parser: "claude",
    strengths: ["orchestration", "refactoring", "debugging", "planning", "implementation"],
    instruction_file: "CLAUDE.md",
    timeout_seconds: 300,
  },
  codex: {
    id: "codex",
    command: "codex",
    detect: "codex --version",
    headless: ["exec", "{prompt}", "--full-auto", "--json", "--cd", "{cwd}"],
    output_format: "jsonl",
    output_parser: "codex",
    strengths: ["implementation", "generation", "testing", "speed"],
    instruction_file: "AGENTS.md",
    timeout_seconds: 300,
  },
  gemini: {
    id: "gemini",
    command: "gemini",
    detect: "gemini --version",
    headless: ["-p", "{prompt}", "--output-format", "json", "--yolo"],
    output_format: "json",
    output_parser: "gemini",
    strengths: ["research", "analysis", "large-context", "documentation", "security-review"],
    instruction_file: ".gemini/GEMINI.md",
    timeout_seconds: 180,
  },
};
