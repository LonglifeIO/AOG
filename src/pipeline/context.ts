import type { AgentImplementation, ReviewOutput, SynthesisResult } from "../agents/types.js";

/**
 * Build a structured handoff document for inter-stage context passing.
 */
export function buildHandoff(options: {
  previousStage: string;
  task: string;
  implementations?: Record<string, AgentImplementation>;
  reviews?: Record<string, ReviewOutput[]>;
  synthesis?: SynthesisResult | null;
}): string {
  const sections: string[] = [];

  sections.push(`# Task Handoff from Stage: ${options.previousStage}`);
  sections.push(`\n## Original Task\n${options.task}`);

  if (options.implementations) {
    sections.push("\n## Implementation Summary");
    for (const [agent, impl] of Object.entries(options.implementations)) {
      const testStatus = impl.testResults
        ? (impl.testResults.passed ? "PASSED" : "FAILED")
        : "NOT RUN";
      sections.push(
        `- **${agent}**: ${impl.status} | Tests: ${testStatus} | ` +
        `Changes: ${impl.diffSummary ?? "none"}`
      );
    }
  }

  if (options.reviews && Object.keys(options.reviews).length > 0) {
    sections.push("\n## Review Summary");
    for (const [reviewer, agentReviews] of Object.entries(options.reviews)) {
      for (const review of agentReviews) {
        sections.push(
          `- **${reviewer}** reviewed ${review.target}: ${review.verdict} ` +
          `(confidence: ${review.confidence}) — ${review.summary}`
        );
      }
    }
  }

  if (options.synthesis) {
    sections.push("\n## Synthesis");
    sections.push(
      `Strategy: ${options.synthesis.strategy} | Chairman: ${options.synthesis.chairman}\n` +
      options.synthesis.summary
    );
  }

  return sections.join("\n");
}

/**
 * Truncate context to fit within a token budget (1 token ~ 4 chars).
 */
export function truncateContext(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  return text.slice(0, maxChars - 100) +
    `\n\n[Context truncated. Original: ${text.length} chars, Budget: ${maxChars} chars]`;
}
