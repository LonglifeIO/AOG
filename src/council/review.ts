import type { AgentManager } from "../agents/manager.js";
import type { AgentId, AgentImplementation, ReviewOutput } from "../agents/types.js";
import { anonymizedDiffStat } from "../worktree/diff.js";
import { sanitizeInterAgentOutput } from "../utils/output.js";

const IMPL_LABELS = ["Implementation Alpha", "Implementation Beta", "Implementation Gamma"];

interface CrossReviewOptions {
  taskId: string;
  implementations: Record<string, AgentImplementation>;
  agents: AgentId[];
  agentManager: AgentManager;
}

/**
 * Orchestrate cross-review: each agent reviews all implementations using diff --stat.
 * Full diffs stay on disk — only stat summaries are sent to reviewers to save tokens.
 */
export async function crossReview(
  options: CrossReviewOptions
): Promise<Record<string, ReviewOutput[]>> {
  const { taskId, implementations, agents, agentManager } = options;
  const reviews: Record<string, ReviewOutput[]> = {};

  const completedAgents = agents.filter(
    (a) => implementations[a]?.status === "completed" && implementations[a]?.diff
  );

  if (completedAgents.length < 2) {
    return reviews;
  }

  // Generate anonymized diff stats (not full diffs)
  const labeledStats: Array<{ agent: AgentId; label: string; stat: string }> = [];
  for (let i = 0; i < completedAgents.length; i++) {
    const agent = completedAgents[i];
    const label = IMPL_LABELS[i] ?? `Implementation ${i + 1}`;
    const stat = await anonymizedDiffStat(implementations[agent].worktreePath, label);
    if (stat) {
      labeledStats.push({ agent, label, stat: sanitizeInterAgentOutput(stat) });
    }
  }

  // Each agent reviews all implementations
  const reviewPromises = agents
    .filter((reviewer) => agentManager.isAvailable(reviewer))
    .map(async (reviewer) => {
      const shuffled = [...labeledStats].sort(() => Math.random() - 0.5);
      const allStats = shuffled.map((d) => d.stat).join("\n\n---\n\n");
      const reviewPrompt = buildReviewPrompt(allStats, shuffled.map((d) => d.label));

      try {
        const result = await agentManager.spawn(reviewer, {
          prompt: reviewPrompt,
          cwd: process.cwd(),
          taskId: `${taskId}-review-${reviewer}`,
          readOnly: true,
          timeout: 120_000,
        });

        reviews[reviewer] = parseReviewOutput(result.result, reviewer, shuffled);
      } catch {
        reviews[reviewer] = [];
      }
    });

  await Promise.allSettled(reviewPromises);

  return reviews;
}

function buildReviewPrompt(stats: string, labels: string[]): string {
  return `Review ${labels.length} implementations (diff --stat shown). Respond with JSON only:
{"reviews":[{"target":"${labels[0]}","verdict":"approve"|"reject"|"suggest","confidence":0.0-1.0,"summary":"one line","comments":[],"ranking":{"correctness":1-10,"readability":1-10,"performance":1-10,"test_coverage":1-10}}]}

${stats}`;
}

function parseReviewOutput(
  output: string,
  reviewer: AgentId,
  shuffled: Array<{ agent: AgentId; label: string }>
): ReviewOutput[] {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const rawReviews = parsed.reviews ?? [parsed];

    return rawReviews.map((r: Record<string, unknown>, i: number) => ({
      reviewer,
      target: (r.target as string) ?? shuffled[i]?.label ?? `Implementation ${i + 1}`,
      verdict: (r.verdict as string) ?? "suggest",
      confidence: (r.confidence as number) ?? 0.5,
      summary: (r.summary as string) ?? "",
      comments: Array.isArray(r.comments) ? r.comments.map((c: Record<string, unknown>) => ({
        file: (c.file as string) ?? "",
        line: (c.line as number) ?? 0,
        severity: (c.severity as string) ?? "minor",
        comment: (c.comment as string) ?? "",
      })) : [],
      ranking: {
        correctness: (r.ranking as Record<string, number>)?.correctness ?? 5,
        readability: (r.ranking as Record<string, number>)?.readability ?? 5,
        performance: (r.ranking as Record<string, number>)?.performance ?? 5,
        test_coverage: (r.ranking as Record<string, number>)?.test_coverage ?? 5,
      },
    }));
  } catch {
    return [];
  }
}
