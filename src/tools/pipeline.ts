import { randomUUID } from "node:crypto";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import { loadTemplate } from "../pipeline/templates.js";
import { PipelineEngine } from "../pipeline/engine.js";

interface PipelineArgs {
  template: string;
  task: string;
  params?: Record<string, unknown>;
  timeout?: number;
}

export async function handlePipeline(
  args: PipelineArgs,
  agentManager: AgentManager,
  worktreeManager: WorktreeManager
): Promise<Record<string, unknown>> {
  const taskId = randomUUID().slice(0, 8);

  const template = await loadTemplate(args.template);
  if (!template) {
    throw new Error(
      `Unknown pipeline template: ${args.template}. ` +
      `Available: full-council, quick-fix, migration, dependency-update`
    );
  }

  const engine = new PipelineEngine({
    taskId,
    template,
    task: args.task,
    params: args.params ?? {},
    agentManager,
    worktreeManager,
    timeout: args.timeout ?? template.timeout * 1000,
  });

  const result = await engine.run();

  return {
    taskId,
    mode: "pipeline",
    template: args.template,
    status: result.status,
    stages: result.history,
    duration_ms: result.duration_ms,
    result: result.finalOutput,
  };
}
