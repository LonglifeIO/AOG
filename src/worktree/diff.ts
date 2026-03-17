import { simpleGit, type SimpleGit } from "simple-git";
import type { CodeChanges } from "../agents/types.js";

/**
 * Extract code changes from a worktree branch using merge-base diff.
 * This gives us only the changes introduced by the agent, not upstream changes.
 */
export async function extractChanges(
  worktreePath: string,
  branch: string
): Promise<CodeChanges | null> {
  const git = simpleGit(worktreePath);

  try {
    // Stage and commit any changes the agent made (including new files)
    // This is required because git diff merge-base..HEAD only sees committed changes
    await git.raw(["add", "-A"]);
    const status = await git.status();
    if (status.staged.length > 0 || status.created.length > 0 || status.modified.length > 0) {
      await git.commit("AOG agent changes", { "--allow-empty": null });
    }

    const defaultBranch = await getDefaultBranch(git);
    const mergeBase = await git.raw(["merge-base", defaultBranch, "HEAD"]);
    const base = mergeBase.trim();

    if (!base) return null;

    const diffStat = await git.raw(["diff", "--stat", `${base}..HEAD`]);
    const diff = await git.raw(["diff", `${base}..HEAD`]);

    if (!diff.trim()) return null;

    const stats = parseDiffStat(diffStat);

    return {
      branch,
      files_changed: stats.files,
      insertions: stats.insertions,
      deletions: stats.deletions,
      diff_summary: diffStat.trim(),
      diff,
    };
  } catch {
    return null;
  }
}

/**
 * Generate an anonymized diff suitable for cross-review.
 * Strips agent-identifying information and labels as "Implementation X".
 */
export async function anonymizedDiff(
  worktreePath: string,
  label: string
): Promise<string | null> {
  const git = simpleGit(worktreePath);

  try {
    const defaultBranch = await getDefaultBranch(git);
    const mergeBase = await git.raw(["merge-base", defaultBranch, "HEAD"]);
    const base = mergeBase.trim();

    if (!base) return null;

    const diff = await git.raw(["diff", `${base}..HEAD`]);
    if (!diff.trim()) return null;

    const sanitized = diff
      .replace(/aog\/(claude|codex|gemini)\//g, "aog/agent/")
      .replace(/(claude|codex|gemini)/gi, "agent");

    return `## ${label}\n\n\`\`\`diff\n${sanitized}\n\`\`\``;
  } catch {
    return null;
  }
}

async function getDefaultBranch(git: SimpleGit): Promise<string> {
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes("main")) return "main";
    if (branches.all.includes("master")) return "master";
    return "HEAD~1";
  } catch {
    return "HEAD~1";
  }
}

function parseDiffStat(stat: string): { files: number; insertions: number; deletions: number } {
  const result = { files: 0, insertions: 0, deletions: 0 };

  const summaryMatch = stat.match(
    /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
  );

  if (summaryMatch) {
    result.files = parseInt(summaryMatch[1] ?? "0", 10);
    result.insertions = parseInt(summaryMatch[2] ?? "0", 10);
    result.deletions = parseInt(summaryMatch[3] ?? "0", 10);
  }

  return result;
}
