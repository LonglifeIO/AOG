import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const SESSIONS_DIR = join(process.cwd(), ".aog", "sessions");

/**
 * Persist full tool result to session file.
 * The tool handler returns a compact summary; full data goes here.
 */
export async function saveSession(taskId: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const filePath = join(SESSIONS_DIR, `${taskId}.json`);
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, filePath);
}

/**
 * Load full session data from disk.
 */
export async function loadSession(taskId: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await readFile(join(SESSIONS_DIR, `${taskId}.json`), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}
