import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Resolve task description from either inline text or file path.
 * task_file saves the MCP caller's output tokens — spec goes to a file, only the path is sent.
 */
export async function resolveTask(args: { task?: string; task_file?: string }): Promise<string> {
  if (args.task_file) {
    const resolved = resolve(args.task_file);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd + "/") && resolved !== cwd) {
      throw new Error(`task_file must be within the project directory (${cwd})`);
    }
    return (await readFile(resolved, "utf-8")).trim();
  }
  if (args.task) {
    return args.task;
  }
  throw new Error("Either task or task_file must be provided");
}
