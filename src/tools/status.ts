import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface StatusArgs {
  task_id?: string;
  detail_level?: "summary" | "diffs" | "full";
}

export async function handleStatus(
  args: StatusArgs
): Promise<Record<string, unknown>> {
  const sessionsDir = join(process.cwd(), ".aog", "sessions");
  const detail = args.detail_level ?? "summary";

  try {
    const files = await readdir(sessionsDir);
    const sessions: Record<string, unknown>[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const taskId = file.replace(".json", "");
      if (args.task_id && taskId !== args.task_id) continue;

      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        const data = JSON.parse(raw);

        if (detail === "summary") {
          // Compact: just status, mode, duration
          sessions.push({
            taskId,
            mode: data.mode ?? data.pipeline ?? "unknown",
            status: data.status ?? "unknown",
            duration_ms: data.duration_ms ?? null,
          });
        } else if (detail === "diffs") {
          // Include diffs but not reviews or raw stdout
          const agents: Record<string, unknown> = {};
          if (data.agents) {
            for (const [id, agent] of Object.entries(data.agents as Record<string, Record<string, unknown>>)) {
              agents[id] = {
                status: agent.status,
                diff: agent.diff ?? null,
                diffSummary: agent.diffSummary ?? null,
                files_changed: agent.files_changed ?? null,
              };
            }
          }
          sessions.push({
            taskId,
            mode: data.mode,
            status: data.status,
            duration_ms: data.duration_ms,
            agents,
            synthesis: data.synthesis ?? null,
          });
        } else {
          // Full: return everything from the session file
          sessions.push({ taskId, ...data });
        }
      } catch {
        // Skip corrupt files
      }
    }

    return { sessions, total: sessions.length };
  } catch {
    return { sessions: [], total: 0 };
  }
}
