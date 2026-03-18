import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type {
  AgentId,
  AgentImplementation,
  ReviewOutput,
  SynthesisResult,
} from "../agents/types.js";

interface SynthesizeOptions {
  taskId: string;
  implementations: Record<string, AgentImplementation>;
  reviews: Record<string, ReviewOutput[]>;
  chairman: AgentId;
  agentManager: AgentManager;
  worktreeManager: WorktreeManager;
}

/**
 * Chairman synthesis: score implementations, select the best one,
 * and optionally merge improvements from others.
 */
export async function synthesize(
  options: SynthesizeOptions
): Promise<SynthesisResult | null> {
  const { taskId, implementations, reviews, chairman, agentManager } = options;

  const scores = scoreImplementations(implementations, reviews);
  if (scores.length === 0) return null;

  scores.sort((a, b) => b.totalScore - a.totalScore);

  const winner = scores[0];
  const winnerImpl = implementations[winner.agent];

  if (!winnerImpl || !winnerImpl.diff) return null;

  // Clear winner — use best-wins strategy
  if (scores.length === 1 || winner.totalScore > scores[1].totalScore * 1.3) {
    return {
      chairman,
      strategy: "best-wins",
      branch: winnerImpl.branch,
      tests_passed: winnerImpl.testResults?.passed ?? false,
      merge_commit: null,
      summary: `Selected ${winner.agent} (score: ${winner.totalScore}). ${scores.map((s) => `${s.agent}: ${s.totalScore}`).join(", ")}`,
    };
  }

  // Close scores — ask chairman to merge using diff stat + limited diff
  try {
    const mergePrompt = buildMergePrompt(scores, implementations);

    await agentManager.spawn(chairman, {
      prompt: mergePrompt,
      cwd: winnerImpl.worktreePath,
      taskId: `${taskId}-synthesis`,
      timeout: 300_000,
    });

    return {
      chairman,
      strategy: "chairman-merge",
      branch: winnerImpl.branch,
      tests_passed: false,
      merge_commit: null,
      summary: `Chairman (${chairman}) merged. Base: ${winner.agent} (${winner.totalScore}). Also: ${scores.slice(1).map((s) => `${s.agent}:${s.totalScore}`).join(", ")}`,
    };
  } catch {
    return {
      chairman,
      strategy: "best-wins",
      branch: winnerImpl.branch,
      tests_passed: winnerImpl.testResults?.passed ?? false,
      merge_commit: null,
      summary: `Fallback best-wins: ${winner.agent} (${winner.totalScore}). Chairman merge failed.`,
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

/**
 * Score implementations using the 50/30/20 heuristic:
 * - Test success: 50 points
 * - Code quality (from reviews): 30 points
 * - File impact: 20 points
 */
function scoreImplementations(
  implementations: Record<string, AgentImplementation>,
  reviews: Record<string, ReviewOutput[]>
): ImplementationScore[] {
  const scores: ImplementationScore[] = [];

  for (const [agent, impl] of Object.entries(implementations)) {
    if (impl.status !== "completed") continue;

    // Test score (0-50)
    let testScore = 25;
    if (impl.testResults) {
      testScore = impl.testResults.passed ? 50 : 10;
    }

    // Review score (0-30)
    let reviewScore = 15;
    const implReviews: ReviewOutput[] = [];
    for (const agentReviews of Object.values(reviews)) {
      implReviews.push(...agentReviews);
    }

    if (implReviews.length > 0) {
      const avgRanking = implReviews.reduce((sum, r) => {
        const avg = (r.ranking.correctness + r.ranking.readability +
          r.ranking.performance + r.ranking.test_coverage) / 4;
        return sum + avg;
      }, 0) / implReviews.length;
      reviewScore = (avgRanking / 10) * 30;
    }

    // Impact score (0-20)
    let impactScore = 10;
    if (impl.diff) {
      const lines = impl.diff.split("\n").length;
      if (lines < 10) impactScore = 5;
      else if (lines < 100) impactScore = 20;
      else if (lines < 500) impactScore = 15;
      else impactScore = 10;
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

function buildMergePrompt(
  scores: ImplementationScore[],
  implementations: Record<string, AgentImplementation>
): string {
  const winner = scores[0];
  const others = scores.slice(1);

  let prompt = `Merge the best parts of ${scores.length} implementations. You're in the winner's worktree.

Scores: ${scores.map((s) => `${s.agent}=${s.totalScore}`).join(", ")}

`;

  for (const other of others) {
    const impl = implementations[other.agent];
    if (impl?.diffSummary) {
      // Use diff stat, not full diff
      prompt += `### ${other.agent} (${other.totalScore}) — changed files:\n${impl.diffSummary}\n\n`;
    }
    if (impl?.diff) {
      // Include limited diff context for actual cherry-picking
      prompt += `Key changes (truncated):\n\`\`\`diff\n${impl.diff.slice(0, 3000)}\n\`\`\`\n\n`;
    }
  }

  prompt += `Cherry-pick only clearly better changes. Ensure result compiles.`;

  return prompt;
}
