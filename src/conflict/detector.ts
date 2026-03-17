import { simpleGit } from "simple-git";
import type { AgentId, AgentImplementation } from "../agents/types.js";

export interface ConflictReport {
  hasConflicts: boolean;
  overlappingFiles: OverlappingFile[];
  summary: string;
}

export interface OverlappingFile {
  path: string;
  agents: AgentId[];
  canAutoMerge: boolean; // true if changes are in non-overlapping regions
}

/**
 * Post-execution conflict detection.
 * After all agents complete, check which files were modified by multiple agents.
 * This is the REACTIVE layer — catches actual conflicts regardless of scoping.
 */
export async function detectConflicts(
  implementations: Record<string, AgentImplementation>,
  projectRoot: string
): Promise<ConflictReport> {
  const filesByAgent = new Map<string, AgentId[]>();

  // Get changed files per agent from their worktrees
  for (const [agentId, impl] of Object.entries(implementations)) {
    if (impl.status !== "completed" || !impl.worktreePath) continue;

    const changedFiles = await getChangedFiles(impl.worktreePath);
    for (const file of changedFiles) {
      const agents = filesByAgent.get(file) ?? [];
      agents.push(agentId as AgentId);
      filesByAgent.set(file, agents);
    }
  }

  // Find files modified by multiple agents
  const overlapping: OverlappingFile[] = [];
  for (const [path, agents] of filesByAgent) {
    if (agents.length > 1) {
      overlapping.push({
        path,
        agents,
        canAutoMerge: false, // Conservative default; could check line ranges
      });
    }
  }

  const hasConflicts = overlapping.length > 0;
  let summary: string;

  if (!hasConflicts) {
    summary = "No file conflicts detected. All agents modified different files.";
  } else {
    const fileList = overlapping.map((o) => `${o.path} (${o.agents.join(", ")})`).join(", ");
    summary = `${overlapping.length} file(s) modified by multiple agents: ${fileList}`;
  }

  return { hasConflicts, overlappingFiles: overlapping, summary };
}

/**
 * Get list of files changed in a worktree relative to its merge base.
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  const git = simpleGit(worktreePath);

  try {
    // Find default branch
    const branches = await git.branchLocal();
    let defaultBranch = "HEAD~1";
    if (branches.all.includes("main")) defaultBranch = "main";
    else if (branches.all.includes("master")) defaultBranch = "master";

    const mergeBase = await git.raw(["merge-base", defaultBranch, "HEAD"]);
    const base = mergeBase.trim();
    if (!base) return [];

    const diff = await git.raw(["diff", "--name-only", `${base}..HEAD`]);
    return diff.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Generate a three-way diff for a conflicting file.
 * Shows what each agent changed relative to the common base.
 */
export async function threeWayDiff(
  file: string,
  implementations: Record<string, AgentImplementation>,
  agents: AgentId[]
): Promise<string> {
  const sections: string[] = [`## Three-way diff for: ${file}\n`];

  for (const agent of agents) {
    const impl = implementations[agent];
    if (!impl?.worktreePath) continue;

    const git = simpleGit(impl.worktreePath);
    try {
      const branches = await git.branchLocal();
      let defaultBranch = "HEAD~1";
      if (branches.all.includes("main")) defaultBranch = "main";
      else if (branches.all.includes("master")) defaultBranch = "master";

      const mergeBase = await git.raw(["merge-base", defaultBranch, "HEAD"]);
      const diff = await git.raw(["diff", mergeBase.trim() + "..HEAD", "--", file]);

      sections.push(`### ${agent}'s changes:\n\`\`\`diff\n${diff}\n\`\`\`\n`);
    } catch {
      sections.push(`### ${agent}: unable to generate diff\n`);
    }
  }

  return sections.join("\n");
}
