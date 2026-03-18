import { randomUUID } from "node:crypto";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { loadTemplate } from "../pipeline/templates.js";
import { PipelineEngine } from "../pipeline/engine.js";
import { saveSession } from "../utils/session.js";
import { resolveTask } from "../utils/task-file.js";
import { buildTokenEstimate, tokenLoggingEnabled } from "../utils/tokens.js";

interface PipelineArgs {
  template: string;
  task?: string;
  task_file?: string;
  params?: Record<string, unknown>;
  timeout?: number;
}

export async function handlePipeline(
  args: PipelineArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  const taskId = randomUUID().slice(0, 8);
  const task = await resolveTask(args);

  const template = await loadTemplate(args.template);
  if (!template) {
    throw new Error(
      `Unknown pipeline template: ${args.template}. ` +
      `Available: full-council, quick-fix, migration, dependency-update, research-synthesis`
    );
  }

  const engine = new PipelineEngine({
    taskId,
    template,
    task,
    params: args.params ?? {},
    agentManager,
    worktreeManager,
    timeout: args.timeout ?? template.timeout * 1000,
    progress,
  });

  const result = await engine.run();
  const sessionPath = `.aog/sessions/${taskId}.json`;

  // Persist full pipeline state to session file
  const sessionData: Record<string, unknown> = {
    mode: "pipeline",
    template: args.template,
    fullHistory: result.history,
    fullOutput: result.finalOutput,
    status: result.status,
    duration_ms: result.duration_ms,
  };
  if (tokenLoggingEnabled()) {
    sessionData.token_estimates = buildTokenEstimate({
      prompt: task,
      response: result.finalOutput,
    });
  }
  await saveSession(taskId, sessionData);

  // Compact stage summaries
  const stages = result.history
    .filter(h => h.event === "completed" || h.event === "failed")
    .map(h => ({ stage: h.stage, event: h.event }));

  // Compact response — under 500 chars
  return {
    taskId,
    status: result.status,
    summary: result.finalOutput.slice(0, 120),
    stages_completed: stages,
    duration_ms: result.duration_ms,
    session_path: sessionPath,
  };
}
