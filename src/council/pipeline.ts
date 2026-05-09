import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type {
  AgentId,
  AgentImplementation,
  ReviewOutput,
  SynthesisResult,
} from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { ensureCommittableRepo } from "../utils/repo.js";
import { fanOut } from "./fanout.js";
import { crossReview } from "./review.js";
import { synthesize } from "./synthesis.js";
import type { CouncilOperation } from "./guardrails.js";

export interface RunCouncilOptions {
  taskId: string;
  task: string;
  operation: CouncilOperation;
  agents: AgentId[];
  chairman?: AgentId | "best-scorer";
  synthesisStrategy?: "best-wins" | "chairman-merge" | "auto";
  outputPath?: string;
  runTests?: boolean;
  testCommand?: string;
  timeout?: number;
  agentManager: AgentManager;
  worktreeManager: WorktreeManager;
  progress?: ProgressReporter;
}

export interface CouncilOutcome {
  status: "success" | "partial" | "failed";
  chairman: AgentId;
  participated: AgentId[];
  failed: AgentId[];
  filesChanged: string[];
  mergedFrom?: Record<string, AgentId>;
  outputPath?: string;
  branch?: string;
  durationMs: number;
  implementations: Record<string, AgentImplementation>;
  reviews: Record<string, ReviewOutput[]>;
  synthesis: SynthesisResult | null;
  testsRan: boolean;
}

/**
 * Run the council pipeline (fan-out → optional tests → cross-review →
 * synthesis) for any of the three council operations: build, research,
 * synthesize. Tears down worktrees in `finally`. The merged output for
 * research/synthesize is copied to the project root before teardown.
 *
 * Partial-failure tolerance: survivors continue. We declare overall
 * success if at least one agent completed; partial if some failed;
 * failed only if zero completed.
 */
export async function runCouncilPipeline(opts: RunCouncilOptions): Promise<CouncilOutcome> {
  const {
    taskId, task, operation, agents, outputPath,
    agentManager, worktreeManager, progress, timeout,
  } = opts;

  await ensureCommittableRepo(process.cwd());

  if (progress) {
    await progress.councilStarted(agents);
  }

  const startTime = Date.now();
  let implementations: Record<string, AgentImplementation> = {};
  let reviews: Record<string, ReviewOutput[]> = {};
  let synthesis: SynthesisResult | null = null;
  let testsRan = false;

  try {
    // Phase 1: Fan-out (operation-aware: build extracts diffs, others read outputContent)
    implementations = await fanOut({
      taskId,
      task,
      operation,
      outputPath,
      agents,
      agentManager,
      worktreeManager,
      timeout,
      progress,
    });

    // Phase 2: Tests (build only; auto-skip if no test command resolution)
    if (operation === "build" && opts.runTests !== false) {
      const testCmd = opts.testCommand ?? "npm test";
      testsRan = true;
      if (progress) await progress.testsStarted();

      for (const impl of Object.values(implementations)) {
        if (impl.status === "completed" && impl.worktreePath) {
          try {
            const { stdout, stderr, exitCode } = await execa("sh", ["-c", testCmd], {
              cwd: impl.worktreePath,
              timeout: 120_000,
              reject: false,
            });
            impl.testResults = {
              passed: exitCode === 0,
              exit_code: exitCode ?? 1,
              stdout: stdout.slice(0, 5000),
              stderr: stderr.slice(0, 5000),
            };
          } catch {
            impl.testResults = { passed: false, exit_code: 1, stdout: "", stderr: "Test execution failed" };
          }
        }
      }

      if (progress) {
        const completed = Object.values(implementations).filter((i) => i.status === "completed");
        const passed = completed.filter((i) => i.testResults?.passed).length;
        await progress.testsCompleted(passed, completed.length);
      }
    }

    // Phase 3: Cross-review
    reviews = await crossReview({
      taskId,
      implementations,
      agents,
      agentManager,
      operation,
      progress,
    });

    // Phase 4: Synthesis
    const resolvedChairman = resolveDefaultChairman(opts.chairman, agentManager);
    synthesis = await synthesize({
      taskId,
      implementations,
      reviews,
      chairman: resolvedChairman,
      operation,
      outputPath,
      strategy: opts.synthesisStrategy,
      agentManager,
      worktreeManager,
      progress,
    });

    return buildOutcome({
      implementations,
      reviews,
      synthesis,
      operation,
      outputPath,
      requestedChairman: resolvedChairman,
      startTime,
      testsRan,
    });
  } finally {
    // Always tear down worktrees, success or failure.
    for (const agent of agents) {
      await worktreeManager.remove(taskId, agent).catch(() => {});
    }
  }
}

function buildOutcome(args: {
  implementations: Record<string, AgentImplementation>;
  reviews: Record<string, ReviewOutput[]>;
  synthesis: SynthesisResult | null;
  operation: CouncilOperation;
  outputPath?: string;
  requestedChairman: AgentId | "best-scorer";
  startTime: number;
  testsRan: boolean;
}): CouncilOutcome {
  const { implementations, reviews, synthesis, operation, outputPath, requestedChairman, startTime, testsRan } = args;

  const participated: AgentId[] = [];
  const failed: AgentId[] = [];
  for (const [agent, impl] of Object.entries(implementations)) {
    if (impl.status === "completed") participated.push(agent as AgentId);
    else failed.push(agent as AgentId);
  }

  let status: "success" | "partial" | "failed";
  if (participated.length === 0) status = "failed";
  else if (failed.length === 0) status = "success";
  else status = "partial";

  // Resolve chairman in result: synthesis.chairman is authoritative
  // when synthesis ran. Otherwise fall back to the requested value
  // (resolving "best-scorer" to participated[0] if present).
  let chairman: AgentId;
  if (synthesis?.chairman) {
    chairman = synthesis.chairman;
  } else if (requestedChairman === "best-scorer") {
    chairman = participated[0] ?? failed[0] ?? ("claude" as AgentId);
  } else {
    chairman = requestedChairman;
  }

  // Aggregate files changed across implementations (build operation)
  // or just the outputPath (research/synthesize).
  const filesChanged: string[] = [];
  if (operation === "build") {
    for (const impl of Object.values(implementations)) {
      if (impl.diffSummary) {
        for (const line of impl.diffSummary.split("\n")) {
          const f = line.split("|")[0]?.trim();
          if (f && !filesChanged.includes(f)) filesChanged.push(f);
        }
      }
    }
  } else if (synthesis?.output_path) {
    filesChanged.push(synthesis.output_path);
  } else if (outputPath) {
    filesChanged.push(outputPath);
  }

  return {
    status,
    chairman,
    participated,
    failed,
    filesChanged,
    mergedFrom: synthesis?.merged_from,
    outputPath: synthesis?.output_path ?? outputPath,
    branch: synthesis?.branch,
    durationMs: Date.now() - startTime,
    implementations,
    reviews,
    synthesis,
    testsRan,
  };
}

function resolveDefaultChairman(
  explicit: AgentId | "best-scorer" | undefined,
  agentManager: AgentManager
): AgentId | "best-scorer" {
  if (explicit) {
    if (explicit === "best-scorer") return "best-scorer";
    if (agentManager.isAvailable(explicit)) return explicit;
  }
  // Default: Claude if available, else best-scorer
  if (agentManager.isAvailable("claude")) return "claude";
  return "best-scorer";
}
