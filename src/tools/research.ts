import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, isAbsolute, dirname } from "node:path";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { runCouncilPipeline } from "../council/pipeline.js";
import { saveSession } from "../utils/session.js";
import { resolveTask } from "../utils/task-file.js";
import { noticeOnce } from "../utils/notices.js";

interface ResearchArgs {
  question?: string;
  task_file?: string;

  // Mode
  mode?: "council" | "solo";

  // Council params
  agents?: AgentId[];
  chairman?: AgentId | "best-scorer";
  synthesis_strategy?: "best-wins" | "chairman-merge" | "auto";

  // Solo params
  agent?: AgentId;

  // Shared
  output_path?: string;
  scope_paths?: string[];
  model?: string;
  max_turns?: number;
  max_budget_usd?: number;
  timeout?: number;
}

/**
 * aog_research — investigate a question and write structured findings.
 *
 * Council by default: every available CLI researches independently in
 * parallel worktrees, cross-reviews anonymized markdown, and a chairman
 * (Claude default) merges the strongest single document. Pass
 * `mode: "solo"` to use a single agent (Gemini default for 1M context).
 */
export async function handleResearch(
  args: ResearchArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const defaultMode = agentManager.getConfig()?.defaults.mode ?? "council";
  const mode = args.mode ?? defaultMode;

  if (mode === "solo") {
    return runSoloResearch(args, agentManager, progress);
  }
  return runCouncilResearch(args, agentManager, worktreeManager, progress);
}

async function runCouncilResearch(
  args: ResearchArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const available = agentManager.getAvailableAgents();
  if (available.length === 0) {
    throw new Error("No CLI agents available. Install claude, codex, or gemini.");
  }

  const requested = args.agents ?? available;
  const agents = requested.filter((a) => agentManager.isAvailable(a));

  if (agents.length < 2) {
    const only = agents[0] ?? available[0];
    noticeOnce(
      "council-fallback-research",
      `[aog] Council mode requires 2+ CLIs; running solo with ${only}.`
    );
    return runSoloResearch({ ...args, agent: only }, agentManager, progress);
  }

  const taskId = randomUUID().slice(0, 8);
  const question = await resolveTask({ task: args.question, task_file: args.task_file });
  if (!question.trim()) {
    throw new Error("aog_research requires a `question` or `task_file`.");
  }
  const outputPath = args.output_path ?? `research/${slugify(question)}.md`;
  const taskPrompt = buildResearchPrompt(question, outputPath, args.scope_paths);

  const outcome = await runCouncilPipeline({
    taskId,
    task: taskPrompt,
    operation: "research",
    agents,
    chairman: args.chairman,
    synthesisStrategy: args.synthesis_strategy,
    outputPath,
    timeout: args.timeout,
    agentManager,
    worktreeManager,
    progress,
  });

  const sessionPath = `.aog/sessions/${taskId}.json`;
  await saveSession(taskId, {
    mode: "council",
    operation: "research",
    question,
    output_path: outputPath,
    chairman: outcome.chairman,
    participated: outcome.participated,
    failed: outcome.failed,
    implementations: Object.fromEntries(
      Object.entries(outcome.implementations).map(([id, impl]) => [
        id,
        { status: impl.status, branch: impl.branch, outputContent: impl.outputContent },
      ])
    ),
    reviews: outcome.reviews,
    synthesis: outcome.synthesis,
    duration_ms: outcome.durationMs,
  });

  return {
    taskId,
    mode: "council",
    status: outcome.status,
    summary: `Council researched (${outcome.participated.length}/${agents.length}). Output: ${outputPath}. Chairman: ${outcome.chairman}.`,
    chairman: outcome.chairman,
    participated: outcome.participated,
    failed: outcome.failed,
    output_path: outcome.outputPath ?? outputPath,
    merged_from: outcome.mergedFrom,
    duration_ms: outcome.durationMs,
    session_path: sessionPath,
  };
}

async function runSoloResearch(
  args: ResearchArgs,
  agentManager: AgentManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const taskId = randomUUID().slice(0, 8);
  const projectRoot = process.cwd();

  const question = await resolveTask({ task: args.question, task_file: args.task_file });
  if (!question.trim()) {
    throw new Error("aog_research requires a `question` or `task_file`.");
  }

  const agent = args.agent ?? (agentManager.isAvailable("gemini") ? "gemini" : "claude");
  if (!agentManager.isAvailable(agent)) {
    throw new Error(`Agent ${agent} is not available (CLI not installed)`);
  }

  const outputPath = args.output_path ?? `research/${slugify(question)}.md`;
  const absoluteOutput = isAbsolute(outputPath) ? outputPath : join(projectRoot, outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });

  const prompt = buildResearchPrompt(question, outputPath, args.scope_paths);

  if (progress) {
    await progress.notify(`${agent} researching → ${outputPath}`, "research", agent);
  }

  const spawnFn = () =>
    agentManager.spawn(agent, {
      prompt,
      cwd: projectRoot,
      taskId,
      model: args.model,
      maxTurns: args.max_turns ?? 20,
      maxBudgetUsd: args.max_budget_usd,
      timeout: args.timeout ?? 600_000,
      allowPermissionBypass: true,
    });

  const result = progress ? await progress.withHeartbeat(agent, "research", spawnFn) : await spawnFn();

  const sessionPath = `.aog/sessions/${taskId}.json`;
  await saveSession(taskId, {
    mode: "solo",
    operation: "research",
    agent,
    question,
    output_path: outputPath,
    scope_paths: args.scope_paths,
    fullResult: result,
  });

  return {
    taskId,
    mode: "solo",
    status: result.status,
    summary: `${agent} researched in ${(result.duration_ms / 1000).toFixed(1)}s → ${outputPath}`,
    agent,
    output_path: outputPath,
    duration_ms: result.duration_ms,
    session_path: sessionPath,
  };
}

function buildResearchPrompt(question: string, outputPath: string, scopePaths?: string[]): string {
  const scopeBlock =
    scopePaths && scopePaths.length > 0
      ? `\n## Scope (constrain reading to these paths)\n${scopePaths.map((p) => `- ${p}`).join("\n")}\n`
      : "";

  return `Research task. Do NOT modify code. Produce a structured markdown research document.

## Question
${question}
${scopeBlock}
## What to produce

Write your findings to ${outputPath}. Structure:

1. **TL;DR** — one paragraph answering the question
2. **Findings** — main bullets with evidence (file references, line numbers, citations)
3. **Open questions** — what you couldn't determine and why
4. **Recommended next steps** — what a downstream synthesize/build step should do

Be specific. Cite file paths and line numbers when referring to code. Quote external sources when used.

Stop after writing the file. Do not implement anything — that's a separate step.`;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 50)
      .replace(/-+$/, "") || "untitled"
  );
}
