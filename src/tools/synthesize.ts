import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { AgentId } from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { runCouncilPipeline } from "../council/pipeline.js";
import { saveSession } from "../utils/session.js";
import { resolveTask } from "../utils/task-file.js";
import { noticeOnce } from "../utils/notices.js";
import { handleBuild } from "./build.js";

interface SynthesizeArgs {
  research_dir?: string;
  output_path?: string;
  task?: string;
  task_file?: string;

  // Mode
  mode?: "council" | "solo";

  // Council params
  agents?: AgentId[];
  chairman?: AgentId | "best-scorer";
  synthesis_strategy?: "best-wins" | "chairman-merge" | "auto";

  // Solo params
  agent?: AgentId;

  // Chaining
  then_build?: boolean;

  // Shared
  include_synthesis?: boolean;
  model?: string;
  max_turns?: number;
  max_budget_usd?: number;
  timeout?: number;
}

/**
 * aog_synthesize — turn research into an implementation plan.
 *
 * Council by default. With `then_build: true`, chains into aog_build
 * after the plan is written, inheriting mode/agents/chairman.
 */
export async function handleSynthesize(
  args: SynthesizeArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  // Validate research dir up front for both modes (fail-loud).
  const researchDir = args.research_dir ?? "research";
  const projectRoot = process.cwd();
  const absoluteResearchDir = isAbsolute(researchDir) ? researchDir : join(projectRoot, researchDir);

  if (!existsSync(absoluteResearchDir)) {
    return {
      taskId: randomUUID().slice(0, 8),
      status: "error",
      error: "MissingResearch",
      message: `research_dir "${researchDir}" does not exist.`,
      suggested_actions: [
        "Pass research_dir pointing to an existing folder",
        "Run aog_research first to generate research",
        "Run aog_build directly if no synthesis is needed",
      ],
    };
  }

  const entries = await readdir(absoluteResearchDir).catch(() => [] as string[]);
  const files = entries.filter((f) => /\.(md|markdown|txt)$/i.test(f));
  if (files.length === 0) {
    return {
      taskId: randomUUID().slice(0, 8),
      status: "error",
      error: "EmptyResearch",
      message: `research_dir "${researchDir}" exists but contains no .md / .txt files.`,
      suggested_actions: [
        "Add research files to the directory",
        "Run aog_research first to generate research",
        "Run aog_build directly if no synthesis is needed",
      ],
    };
  }

  const defaultMode = agentManager.getConfig()?.defaults.mode ?? "council";
  const mode = args.mode ?? defaultMode;

  const synthesizeResult =
    mode === "solo"
      ? await runSoloSynthesize(args, files, researchDir, agentManager, progress)
      : await runCouncilSynthesize(args, files, researchDir, agentManager, worktreeManager, progress);

  if (!args.then_build) return synthesizeResult;
  if (synthesizeResult.status !== "success" && synthesizeResult.status !== "completed" && synthesizeResult.status !== "partial") {
    return synthesizeResult;
  }

  // Chain into aog_build inheriting mode/agents/chairman.
  const outputPath = (synthesizeResult.output_path as string) ?? args.output_path ?? "docs/IMPLEMENTATION-PLAN.md";
  const buildArgs = {
    task: `Execute the implementation plan in ${outputPath}. Build every file specified.`,
    mode,
    agents: args.agents,
    chairman: args.chairman,
    synthesis_strategy: args.synthesis_strategy,
    timeout: args.timeout,
  } as Parameters<typeof handleBuild>[0];

  const buildResult = await handleBuild(buildArgs, agentManager, worktreeManager, progress);

  return {
    ...synthesizeResult,
    then_build: true,
    build: buildResult,
  };
}

async function runCouncilSynthesize(
  args: SynthesizeArgs,
  files: string[],
  researchDir: string,
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
      "council-fallback-synthesize",
      `[aog] Council mode requires 2+ CLIs; running solo with ${only}.`
    );
    return runSoloSynthesize({ ...args, agent: only }, files, researchDir, agentManager, progress);
  }

  const taskId = randomUUID().slice(0, 8);
  const outputPath = args.output_path ?? "docs/IMPLEMENTATION-PLAN.md";
  const userContext = await resolveTask({ task: args.task, task_file: args.task_file }).catch(() => "");
  const includeSynthesisDoc = args.include_synthesis !== false;

  const prompt = buildSynthesisPrompt({ researchDir, files, outputPath, includeSynthesisDoc, userContext });

  const outcome = await runCouncilPipeline({
    taskId,
    task: prompt,
    operation: "synthesize",
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
    operation: "synthesize",
    research_dir: researchDir,
    research_files: files,
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
    summary: `Council synthesized (${outcome.participated.length}/${agents.length}). Plan: ${outputPath}. Chairman: ${outcome.chairman}.`,
    chairman: outcome.chairman,
    participated: outcome.participated,
    failed: outcome.failed,
    output_path: outcome.outputPath ?? outputPath,
    research_files: files,
    merged_from: outcome.mergedFrom,
    duration_ms: outcome.durationMs,
    session_path: sessionPath,
  };
}

async function runSoloSynthesize(
  args: SynthesizeArgs,
  files: string[],
  researchDir: string,
  agentManager: AgentManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const taskId = randomUUID().slice(0, 8);
  const projectRoot = process.cwd();

  const agent = args.agent ?? "claude";
  if (!agentManager.isAvailable(agent)) {
    throw new Error(`Agent ${agent} is not available (CLI not installed)`);
  }

  const outputPath = args.output_path ?? "docs/IMPLEMENTATION-PLAN.md";
  const includeSynthesisDoc = args.include_synthesis !== false;
  const userContext = await resolveTask({ task: args.task, task_file: args.task_file }).catch(() => "");

  const prompt = buildSynthesisPrompt({ researchDir, files, outputPath, includeSynthesisDoc, userContext });

  if (progress) {
    await progress.notify(`Synthesizing ${files.length} research file(s)…`, "synthesize", agent);
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

  const result = progress ? await progress.withHeartbeat(agent, "synthesize", spawnFn) : await spawnFn();

  const sessionPath = `.aog/sessions/${taskId}.json`;
  await saveSession(taskId, {
    mode: "solo",
    operation: "synthesize",
    agent,
    research_dir: researchDir,
    research_files: files,
    output_path: outputPath,
    fullResult: result,
  });

  return {
    taskId,
    mode: "solo",
    status: result.status,
    summary: `${agent} synthesized ${files.length} research file(s) → ${outputPath}`,
    agent,
    output_path: outputPath,
    research_files: files,
    duration_ms: result.duration_ms,
    session_path: sessionPath,
  };
}

function buildSynthesisPrompt(opts: {
  researchDir: string;
  files: string[];
  outputPath: string;
  includeSynthesisDoc: boolean;
  userContext: string;
}): string {
  const fileList = opts.files.map((f) => `- ${opts.researchDir}/${f}`).join("\n");
  const synthesisStep = opts.includeSynthesisDoc
    ? `First, read every file and produce docs/SYNTHESIS.md cross-referencing findings:
- Where sources AGREE → high confidence, build on it
- Where sources CONFLICT → flag with both positions
- Where only ONE source covers something → note lower confidence
- Where ALL sources are uncertain → mark "needs verification"

Then,`
    : "Read every file. Then,";

  const contextBlock = opts.userContext.trim()
    ? `\n## Additional context from the user\n\n${opts.userContext}\n`
    : "";

  return `Synthesize the research files into an implementation plan. Do NOT build code in this step.

## Research files to read
${fileList}
${contextBlock}
## What to produce

${synthesisStep} produce ${opts.outputPath} containing:
1. Architecture decisions (with rationale from research)
2. Project structure (directories and key files)
3. Dependencies and tooling
4. Build order (what to implement first)
5. Open questions that need resolving before building
6. Verification checklist (things to manually test)

Stop after writing the plan. The build step is a separate tool call.`;
}
