import { execa } from "execa";

/**
 * Verify the project is a git repo with at least one commit.
 * Council mode requires `git worktree add`, which fails on empty repos —
 * fail-fast with an actionable error before spawning agents.
 */
export async function ensureCommittableRepo(cwd: string): Promise<void> {
  const { exitCode: hasRepo } = await execa("git", ["rev-parse", "--git-dir"], {
    cwd,
    reject: false,
  });
  if (hasRepo !== 0) {
    throw new Error(
      `Not a git repository: ${cwd}. AOG council mode uses git worktrees. Run \`git init\` and make at least one commit, or use mode: "solo".`
    );
  }

  const { exitCode: hasCommit } = await execa("git", ["rev-parse", "HEAD"], {
    cwd,
    reject: false,
  });
  if (hasCommit !== 0) {
    throw new Error(
      `Repository at ${cwd} has no commits. AOG council mode uses git worktrees, which require at least one commit. Stage and commit something first, or use mode: "solo".`
    );
  }
}
