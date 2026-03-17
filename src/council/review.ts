import type { AgentManager } from "../agents/manager.js";
import type { AgentId, AgentImplementation, ReviewOutput } from "../agents/types.js";
import { anonymizedDiff } from "../worktree/diff.js";

const IMPL_LABELS = ["Implementation Alpha", "Implementation Beta", "Implementation Gamma"];

interface CrossReviewOptions {
  taskId: string;
  implementations: Record<string, AgentImplementation>;
  agents: AgentId[];
  agentManager: AgentManager;
}

/**
 * Orchestrate cross-review: each agent reviews all implementations with anonymized diffs.
 * Presentation order is randomized per reviewer to prevent positional bias.
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

  // Generate anonymized diffs
  const labeledDiffs: Array<{ agent: AgentId; label: string; diff: string }> = [];
  for (let i = 0; i < completedAgents.length; i++) {
    const agent = completedAgents[i];
    const label = IMPL_LABELS[i] ?? `Implementation ${i + 1}`;
    const diff = await anonymizedDiff(implementations[agent].worktreePath, label);
    if (diff) {
      labeledDiffs.push({ agent, label, diff });
    }
  }

  // Each agent reviews all implementations
  const reviewPromises = agents
    .filter((reviewer) => agentManager.isAvailable(reviewer))
    .map(async (reviewer) => {
      const shuffled = [...labeledDiffs].sort(() => Math.random() - 0.5);
      const allDiffs = shuffled.map((d) => d.diff).join("\n\n---\n\n");
      const reviewPrompt = buildReviewPrompt(allDiffs, shuffled.map((d) => d.label));

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

function buildReviewPrompt(diffs: string, labels: string[]): string {
  return `You are reviewing ${labels.length} anonymized implementations of the same coding task.
Each implementation was created independently.

For EACH implementation, provide a JSON review with this exact structure:
{
  "reviews": [
    {
      "target": "${labels[0]}",
      "verdict": "approve" | "reject" | "suggest",
      "confidence": 0.0 to 1.0,
      "summary": "Brief assessment",
      "comments": [
        {
          "file": "path/to/file",
          "line": 42,
          "severity": "critical" | "major" | "minor" | "nit",
          "comment": "Description of issue or suggestion"
        }
      ],
      "ranking": {
        "correctness": 1-10,
        "readability": 1-10,
        "performance": 1-10,
        "test_coverage": 1-10
      }
    }
  ]
}

IMPORTANT: Evaluate each implementation on its own merits. Do not try to identify which agent created which implementation.

Here are the implementations:

${diffs}

Respond with ONLY the JSON object. No other text.`;
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
