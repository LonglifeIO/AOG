import { existsSync } from "node:fs";
import { join } from "node:path";

export type CouncilOperation = "build" | "research" | "synthesize";

interface WrapOptions {
  task: string;
  operation: CouncilOperation;
  projectRoot: string;
  outputPath?: string;
}

/**
 * Wrap a user task with council guardrails: auto-attach existing
 * `docs/IMPLEMENTATION-PLAN.md` and `research/` as read-only context, and
 * append an operation-specific constraint block. Used for every council
 * spawn regardless of which tool triggered it.
 */
export function wrapCouncilPrompt(opts: WrapOptions): string {
  const { task, operation, projectRoot, outputPath } = opts;

  const planPath = "docs/IMPLEMENTATION-PLAN.md";
  const researchDir = "research";
  const planExists = existsSync(join(projectRoot, planPath));
  const researchExists = existsSync(join(projectRoot, researchDir));

  let context = "";
  if (planExists || researchExists) {
    context = "\n\n## Available context (read-only)\n";
    if (planExists) {
      context += `- ${planPath} — implementation plan from a prior aog_synthesize call\n`;
    }
    if (researchExists) {
      context += `- ${researchDir}/ — research files from a prior aog_research call\n`;
    }
    context += "\nUse these as the source of truth. Do not regenerate them.";
  }

  const target = outputPath ? ` to ${outputPath}` : "";
  const constraints: Record<CouncilOperation, string> = {
    build:
      "\n\n## Constraints\n" +
      "- Implement only. Do not research, browse, or write planning documents.\n" +
      "- Stay focused on the task above; another agent already covered upstream steps.",
    research:
      "\n\n## Constraints\n" +
      `- Research and write a structured markdown file${target}.\n` +
      "- Do NOT modify code. Do NOT write planning documents — that's a separate step (aog_synthesize).",
    synthesize:
      "\n\n## Constraints\n" +
      `- Read the research files and produce the implementation plan${target}.\n` +
      "- Do NOT implement code — the build step is a separate tool call.\n" +
      "- Use existing research as the source of truth; do not regenerate it.",
  };

  return `${task}${context}${constraints[operation]}`;
}
