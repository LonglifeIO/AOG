import type { AgentManager } from "../agents/manager.js";
import type { AgentId, AgentImplementation, ReviewOutput, TestResult } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { anonymizedDiff } from "../worktree/diff.js";
import { sanitizeInterAgentOutput } from "../utils/output.js";
import type { CouncilOperation } from "./guardrails.js";

const IMPL_LABELS = ["Implementation Alpha", "Implementation Beta", "Implementation Gamma"];
// Safety net for very long markdown research/synthesize outputs only.
// Build operations send full diffs without truncation (ADR-014).
const MAX_MARKDOWN_CHARS = 200_000;

interface CrossReviewOptions {
  taskId: string;
  implementations: Record<string, AgentImplementation>;
  agents: AgentId[];
  agentManager: AgentManager;
  operation: CouncilOperation;
  progress?: ProgressReporter;
}

/**
 * Orchestrate cross-review across council outputs.
 *
 * For "build" we send anonymized diff stats (file names + line counts).
 * For "research" and "synthesize" we send the (sanitized, anonymized,
 * truncated) markdown content each agent wrote to `output_path`. The
 * rubric (correctness/readability/performance/test_coverage) is shared
 * across operations; scoring weights diverge in synthesis.
 */
export async function crossReview(
  options: CrossReviewOptions
): Promise<Record<string, ReviewOutput[]>> {
  const { taskId, implementations, agents, agentManager, operation, progress } = options;
  const reviews: Record<string, ReviewOutput[]> = {};

  const completedAgents = agents.filter((a) => {
    const impl = implementations[a];
    if (!impl || impl.status !== "completed") return false;
    return operation === "build" ? !!impl.diff : !!impl.outputContent;
  });

  if (completedAgents.length < 2) {
    return reviews;
  }

  const reviewers = agents.filter((reviewer) => agentManager.isAvailable(reviewer));
  if (progress) {
    await progress.reviewStarted(reviewers);
  }

  // Build per-agent review payloads. For build, this is the full
  // anonymized diff plus test results when present (ADR-014); for
  // research/synthesize, it's the markdown content (capped only as
  // a context-window safety net) prefixed with the implementation label.
  const labeled: Array<{ agent: AgentId; label: string; payload: string }> = [];
  for (let i = 0; i < completedAgents.length; i++) {
    const agent = completedAgents[i];
    const label = IMPL_LABELS[i] ?? `Implementation ${i + 1}`;
    let payload: string | null = null;

    if (operation === "build") {
      const diff = await anonymizedDiff(implementations[agent].worktreePath, label);
      if (diff) {
        const tests = formatTestResults(implementations[agent].testResults);
        payload = tests ? `${diff}\n\n${tests}` : diff;
      }
    } else {
      const content = implementations[agent].outputContent ?? "";
      const capped = content.length > MAX_MARKDOWN_CHARS
        ? content.slice(0, MAX_MARKDOWN_CHARS) + "\n\n…[truncated]"
        : content;
      const anonymized = anonymizeAgentReferences(capped);
      payload = `## ${label}\n\n${anonymized}`;
    }

    if (payload) {
      labeled.push({ agent, label, payload: sanitizeInterAgentOutput(payload) });
    }
  }

  // Each agent reviews all implementations.
  const reviewPromises = reviewers.map(async (reviewer) => {
    const shuffled = [...labeled].sort(() => Math.random() - 0.5);
    const allPayloads = shuffled.map((d) => d.payload).join("\n\n---\n\n");
    const reviewPrompt = buildReviewPrompt(allPayloads, shuffled.map((d) => d.label), operation);

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

  if (progress) {
    await progress.reviewCompleted();
  }

  return reviews;
}

function buildReviewPrompt(payloads: string, labels: string[], operation: CouncilOperation): string {
  const operationDescription: Record<CouncilOperation, string> = {
    build:
      "Review the following implementations (full diffs shown, plus test " +
      "results where available). Rank each on correctness, readability, " +
      "performance, and test_coverage (1-10) based on the actual code.",
    research:
      "Review the following research documents (markdown content shown). " +
      "Rank each on correctness (factual accuracy), readability (clarity and " +
      "structure), performance (depth of evidence), and test_coverage " +
      "(comprehensiveness vs the question) (1-10).",
    synthesize:
      "Review the following implementation plans (markdown content shown). " +
      "Rank each on correctness (feasibility), readability (ordering and " +
      "structure), performance (groundedness in research), and test_coverage " +
      "(completeness of the plan) (1-10).",
  };

  return `${operationDescription[operation]} Respond with JSON only:
{"reviews":[{"target":"${labels[0]}","verdict":"approve"|"reject"|"suggest","confidence":0.0-1.0,"summary":"one line","comments":[],"ranking":{"correctness":1-10,"readability":1-10,"performance":1-10,"test_coverage":1-10}}]}

${payloads}`;
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

function anonymizeAgentReferences(text: string): string {
  return text.replace(/\b(claude|codex|gemini)\b/gi, "agent");
}

function formatTestResults(tests: TestResult | null): string | null {
  if (!tests) return null;
  const status = tests.passed ? "passed" : `failed (exit ${tests.exit_code})`;
  const lines = [`## Test results`, `Status: ${status}`];
  if (!tests.passed && tests.stderr) {
    lines.push("", "```", tests.stderr.slice(0, 1024), "```");
  }
  return lines.join("\n");
}
