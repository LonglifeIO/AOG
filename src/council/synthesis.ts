import { writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type {
  AgentId,
  AgentImplementation,
  ReviewOutput,
  SynthesisResult,
} from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { sanitizeInterAgentOutput } from "../utils/output.js";
import type { CouncilOperation } from "./guardrails.js";

interface SynthesizeOptions {
  taskId: string;
  implementations: Record<string, AgentImplementation>;
  reviews: Record<string, ReviewOutput[]>;
  chairman: AgentId | "best-scorer";
  operation: CouncilOperation;
  outputPath?: string;
  strategy?: "best-wins" | "chairman-merge" | "auto";
  agentManager: AgentManager;
  worktreeManager: WorktreeManager;
  progress?: ProgressReporter;
}

/**
 * Score implementations and either pick a clear winner or have the
 * chairman synthesize a merged result.
 *
 * Scoring weights diverge by operation:
 *   - build: 50/30/20 (tests / reviews / impact)
 *   - research, synthesize: 0/70/30 (reviews / depth)
 *
 * For build, the result is a branch reference; for research/synthesize,
 * the result is a merged markdown file at `outputPath`.
 */
export async function synthesize(
  options: SynthesizeOptions
): Promise<SynthesisResult | null> {
  const { taskId, implementations, reviews, operation, outputPath, agentManager, progress } = options;

  // TODO(weights): the 0/70/30 split for research/synthesize is a
  // starting estimate — tune after first real-world runs.
  const scores = scoreImplementations(implementations, reviews, operation);
  if (scores.length === 0) return null;

  scores.sort((a, b) => b.totalScore - a.totalScore);
  const winner = scores[0];
  const winnerImpl = implementations[winner.agent];
  if (!winnerImpl) return null;

  // Resolve chairman: "best-scorer" means use the winning agent. An
  // explicit AgentId is honored if available; otherwise fall back to
  // the winner.
  let chairman: AgentId = winner.agent;
  if (options.chairman !== "best-scorer") {
    chairman = agentManager.isAvailable(options.chairman) ? options.chairman : winner.agent;
  }

  if (progress) {
    await progress.synthesisStarted(chairman);
  }

  // Strategy resolution: explicit > auto. In auto, a clear winner
  // (>30% margin over runner-up) is best-wins; otherwise chairman-merge.
  const explicitStrategy = options.strategy && options.strategy !== "auto" ? options.strategy : null;
  const autoStrategy: "best-wins" | "chairman-merge" =
    scores.length === 1 || winner.totalScore > scores[1].totalScore * 1.3 ? "best-wins" : "chairman-merge";
  const strategy = explicitStrategy ?? autoStrategy;

  const summaryLine = `${scores.map((s) => `${s.agent}=${s.totalScore}`).join(", ")}`;
  const sources = scores.map((s) => s.agent);

  if (strategy === "best-wins") {
    const result: SynthesisResult = {
      chairman,
      strategy: "best-wins",
      branch: winnerImpl.branch,
      tests_passed: winnerImpl.testResults?.passed ?? false,
      merge_commit: null,
      summary: `Selected ${winner.agent} (score ${winner.totalScore}). ${summaryLine}`,
      sources,
    };

    if (operation !== "build" && outputPath) {
      // Write the winner's outputContent to the project root so the user
      // gets the file regardless of worktree teardown.
      await persistMarkdownToProjectRoot(outputPath, winnerImpl.outputContent ?? "");
      result.output_path = outputPath;
      result.merged_from = { [outputPath]: winner.agent };
    } else if (operation === "build") {
      // Best-effort merged_from for build: every changed file maps to
      // the winner. Chairman synthesis didn't run.
      result.merged_from = filesFromDiffSummary(winnerImpl.diffSummary, winner.agent);
    }

    if (progress) {
      await progress.synthesisCompleted("best-wins");
    }
    return result;
  }

  // chairman-merge path
  if (operation === "build") {
    return await chairmanMergeBuild({
      taskId,
      chairman,
      winner,
      scores,
      implementations,
      agentManager,
      progress,
      summaryLine,
      sources,
      winnerImpl,
    });
  }

  return await chairmanMergeMarkdown({
    taskId,
    chairman,
    winner,
    scores,
    implementations,
    operation,
    outputPath,
    agentManager,
    progress,
    summaryLine,
    sources,
    winnerImpl,
  });
}

interface ChairmanMergeContext {
  taskId: string;
  chairman: AgentId;
  winner: ImplementationScore;
  scores: ImplementationScore[];
  implementations: Record<string, AgentImplementation>;
  agentManager: AgentManager;
  progress?: ProgressReporter;
  summaryLine: string;
  sources: AgentId[];
  winnerImpl: AgentImplementation;
}

async function chairmanMergeBuild(ctx: ChairmanMergeContext): Promise<SynthesisResult> {
  const { taskId, chairman, winner, scores, implementations, agentManager, progress, summaryLine, sources, winnerImpl } = ctx;
  try {
    const mergePrompt = buildBuildMergePrompt(scores, implementations);
    await agentManager.spawn(chairman, {
      prompt: mergePrompt,
      cwd: winnerImpl.worktreePath,
      taskId: `${taskId}-synthesis`,
      timeout: 300_000,
      allowPermissionBypass: true,
    });

    if (progress) {
      await progress.synthesisCompleted("chairman-merge");
    }

    return {
      chairman,
      strategy: "chairman-merge",
      branch: winnerImpl.branch,
      tests_passed: false,
      merge_commit: null,
      summary: `Chairman ${chairman} merged. Base: ${winner.agent} (${winner.totalScore}). ${summaryLine}`,
      sources,
      merged_from: filesFromDiffSummary(winnerImpl.diffSummary, winner.agent),
    };
  } catch {
    if (progress) {
      await progress.synthesisCompleted("best-wins (merge failed)");
    }
    return {
      chairman,
      strategy: "best-wins",
      branch: winnerImpl.branch,
      tests_passed: winnerImpl.testResults?.passed ?? false,
      merge_commit: null,
      summary: `Fallback best-wins: ${winner.agent} (${winner.totalScore}). Chairman merge failed.`,
      sources,
      merged_from: filesFromDiffSummary(winnerImpl.diffSummary, winner.agent),
    };
  }
}

async function chairmanMergeMarkdown(
  ctx: ChairmanMergeContext & { operation: CouncilOperation; outputPath: string | undefined }
): Promise<SynthesisResult> {
  const {
    taskId, chairman, winner, scores, implementations, operation, outputPath,
    agentManager, progress, summaryLine, sources, winnerImpl,
  } = ctx;

  if (!outputPath) {
    if (progress) {
      await progress.synthesisCompleted("best-wins (no output_path)");
    }
    return {
      chairman,
      strategy: "best-wins",
      branch: winnerImpl.branch,
      tests_passed: false,
      merge_commit: null,
      summary: `Best-wins fallback: outputPath missing. Winner ${winner.agent} (${winner.totalScore}).`,
      sources,
    };
  }

  try {
    const mergePrompt = buildMarkdownMergePrompt(operation, outputPath, scores, implementations);
    await agentManager.spawn(chairman, {
      prompt: mergePrompt,
      cwd: winnerImpl.worktreePath,
      taskId: `${taskId}-synthesis`,
      timeout: 300_000,
      allowPermissionBypass: true,
    });

    // Copy the chairman's merged file from its worktree to project root.
    const chairmanImpl = implementations[chairman] ?? winnerImpl;
    await copyFileFromWorktree(chairmanImpl.worktreePath, outputPath);

    if (progress) {
      await progress.synthesisCompleted("chairman-merge");
    }

    return {
      chairman,
      strategy: "chairman-merge",
      branch: winnerImpl.branch,
      tests_passed: false,
      merge_commit: null,
      summary: `Chairman ${chairman} synthesized ${operation}. Base: ${winner.agent} (${winner.totalScore}). ${summaryLine}`,
      output_path: outputPath,
      merged_from: { [outputPath]: chairman },
      sources,
    };
  } catch {
    // Fall back to best-wins: persist the winner's content directly.
    await persistMarkdownToProjectRoot(outputPath, winnerImpl.outputContent ?? "").catch(() => {});
    if (progress) {
      await progress.synthesisCompleted("best-wins (merge failed)");
    }
    return {
      chairman,
      strategy: "best-wins",
      branch: winnerImpl.branch,
      tests_passed: false,
      merge_commit: null,
      summary: `Fallback best-wins: ${winner.agent} (${winner.totalScore}). Chairman merge failed.`,
      output_path: outputPath,
      merged_from: { [outputPath]: winner.agent },
      sources,
    };
  }
}

interface ImplementationScore {
  agent: AgentId;
  testScore: number;
  reviewScore: number;
  impactScore: number;
  totalScore: number;
}

function scoreImplementations(
  implementations: Record<string, AgentImplementation>,
  reviews: Record<string, ReviewOutput[]>,
  operation: CouncilOperation
): ImplementationScore[] {
  const scores: ImplementationScore[] = [];
  const isBuild = operation === "build";

  for (const [agent, impl] of Object.entries(implementations)) {
    if (impl.status !== "completed") continue;

    // Test score (0-50 build / 0 elsewhere)
    let testScore = 0;
    if (isBuild) {
      testScore = 25;
      if (impl.testResults) testScore = impl.testResults.passed ? 50 : 10;
    }

    // Review score (0-30 build / 0-70 research+synthesize)
    const reviewWeight = isBuild ? 30 : 70;
    let reviewScore = reviewWeight / 2;
    const allReviews: ReviewOutput[] = [];
    for (const reviewerEntries of Object.values(reviews)) allReviews.push(...reviewerEntries);
    if (allReviews.length > 0) {
      const avgRanking =
        allReviews.reduce((sum, r) => {
          const avg =
            (r.ranking.correctness + r.ranking.readability + r.ranking.performance + r.ranking.test_coverage) / 4;
          return sum + avg;
        }, 0) / allReviews.length;
      reviewScore = (avgRanking / 10) * reviewWeight;
    }

    // Impact / depth score (0-20 build / 0-30 research+synthesize)
    const impactWeight = isBuild ? 20 : 30;
    let impactScore = impactWeight / 2;
    const measureSource = isBuild ? impl.diff : impl.outputContent;
    if (measureSource) {
      const lines = measureSource.split("\n").length;
      if (isBuild) {
        if (lines < 10) impactScore = 5;
        else if (lines < 100) impactScore = 20;
        else if (lines < 500) impactScore = 15;
        else impactScore = 10;
      } else {
        // For markdown: more depth (more lines) = higher score, with diminishing returns.
        if (lines < 20) impactScore = 10;
        else if (lines < 80) impactScore = 25;
        else if (lines < 300) impactScore = 30;
        else impactScore = 22;
      }
    }

    scores.push({
      agent: agent as AgentId,
      testScore,
      reviewScore: Math.round(reviewScore),
      impactScore,
      totalScore: Math.round(testScore + reviewScore + impactScore),
    });
  }

  return scores;
}

function buildBuildMergePrompt(
  scores: ImplementationScore[],
  implementations: Record<string, AgentImplementation>
): string {
  const others = scores.slice(1);
  let prompt = `Merge the best parts of ${scores.length} implementations. You're in the winner's worktree.

Scores: ${scores.map((s) => `${s.agent}=${s.totalScore}`).join(", ")}

`;
  for (const other of others) {
    const impl = implementations[other.agent];
    if (impl?.diffSummary) {
      prompt += `### ${other.agent} (${other.totalScore}) — changed files:\n${sanitizeInterAgentOutput(impl.diffSummary)}\n\n`;
    }
    if (impl?.diff) {
      prompt += `Key changes (truncated):\n\`\`\`diff\n${sanitizeInterAgentOutput(impl.diff.slice(0, 3000))}\n\`\`\`\n\n`;
    }
  }
  prompt += `Cherry-pick only clearly better changes. Ensure result compiles.`;
  return prompt;
}

function buildMarkdownMergePrompt(
  operation: CouncilOperation,
  outputPath: string,
  scores: ImplementationScore[],
  implementations: Record<string, AgentImplementation>
): string {
  const noun = operation === "research" ? "research document" : "implementation plan";
  const action =
    operation === "research"
      ? "Synthesize the strongest single research document, citing sources where they agree, flagging where they disagree, and noting open questions"
      : "Synthesize the strongest single implementation plan, ordering steps for least surprise, and noting any prerequisites the plans missed";

  let prompt = `You are the chairman. Three independent agents wrote a ${noun} at ${outputPath}. ${action}.

Write the merged ${noun} to ${outputPath} in this worktree. Do NOT modify any other files.

Scores: ${scores.map((s) => `${s.agent}=${s.totalScore}`).join(", ")}

`;
  for (const score of scores) {
    const impl = implementations[score.agent];
    if (impl?.outputContent) {
      const truncated =
        impl.outputContent.length > 8000
          ? impl.outputContent.slice(0, 8000) + "\n\n…[truncated]"
          : impl.outputContent;
      prompt += `### ${score.agent} (${score.totalScore})\n\n${sanitizeInterAgentOutput(truncated)}\n\n---\n\n`;
    }
  }
  prompt += `Now write the synthesized ${noun} to ${outputPath}. Output only the file write — no narration.`;
  return prompt;
}

async function persistMarkdownToProjectRoot(outputPath: string, content: string): Promise<void> {
  const target = isAbsolute(outputPath) ? outputPath : join(process.cwd(), outputPath);
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
}

async function copyFileFromWorktree(worktreePath: string, outputPath: string): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const source = isAbsolute(outputPath) ? outputPath : join(worktreePath, outputPath);
  const content = await readFile(source, "utf-8");
  await persistMarkdownToProjectRoot(outputPath, content);
}

function filesFromDiffSummary(diffSummary: string | null, agent: AgentId): Record<string, AgentId> {
  if (!diffSummary) return {};
  const out: Record<string, AgentId> = {};
  for (const line of diffSummary.split("\n")) {
    const file = line.split("|")[0]?.trim();
    if (file) out[file] = agent;
  }
  return out;
}
