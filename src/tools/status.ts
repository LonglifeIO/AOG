import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineState } from "../agents/types.js";

interface StatusArgs {
  task_id?: string;
}

interface SessionSummary {
  taskId: string;
  status: string;
  pipeline: string;
  currentStage: string;
  startedAt: string;
  updatedAt: string;
  agents: string[];
}

export async function handleStatus(
  args: StatusArgs
): Promise<{ active_sessions: SessionSummary[]; total: number }> {
  const sessionsDir = join(process.cwd(), ".aog", "sessions");

  try {
    const files = await readdir(sessionsDir);
    const sessions: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const taskId = file.replace(".json", "");
      if (args.task_id && taskId !== args.task_id) continue;

      try {
        const data = await readFile(join(sessionsDir, file), "utf-8");
        const state: PipelineState = JSON.parse(data);

        sessions.push({
          taskId: state.taskId,
          status: state.status,
          pipeline: state.pipeline,
          currentStage: state.currentStage,
          startedAt: state.startedAt,
          updatedAt: state.updatedAt,
          agents: Object.keys(state.implementations),
        });
      } catch {
        // Skip corrupt session files
      }
    }

    return { active_sessions: sessions, total: sessions.length };
  } catch {
    return { active_sessions: [], total: 0 };
  }
}
