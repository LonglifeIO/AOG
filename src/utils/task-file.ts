import { readFile } from "node:fs/promises";

/**
 * Resolve task description from either inline text or file path.
 * task_file saves the MCP caller's output tokens — spec goes to a file, only the path is sent.
 */
export async function resolveTask(args: { task?: string; task_file?: string }): Promise<string> {
  if (args.task_file) {
    return (await readFile(args.task_file, "utf-8")).trim();
  }
  if (args.task) {
    return args.task;
  }
  throw new Error("Either task or task_file must be provided");
}
