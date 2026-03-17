import type { AgentId } from "../agents/types.js";

/**
 * Task decomposition with file-level scoping.
 * Before parallel dispatch, analyze the task and assign file scopes per agent
 * to prevent merge conflicts.
 */

export interface TaskAssignment {
  agent: AgentId;
  prompt: string;
  scopedFiles: string[];      // Files this agent is EXPECTED to modify
  readOnlyContext: string[];   // Files to read but NOT modify
  worktreePath: string;
}

export interface ScopeAnalysis {
  assignments: TaskAssignment[];
  overlaps: FileOverlap[];
  strategy: OverlapStrategy;
}

export interface FileOverlap {
  file: string;
  agents: AgentId[];
}

export type OverlapStrategy =
  | "serialize"     // Run sequentially instead of parallel
  | "designate"     // Assign overlapping file to ONE agent
  | "council"       // Intentional overlap (council mode — compare approaches)
  | "user_decide";  // Ask user at pre-dispatch gate

/**
 * Analyze a task and produce file-scoped assignments for each agent.
 * This is a best-effort heuristic — the agent may modify files outside scope.
 * The post-execution conflict detector catches actual overlaps.
 */
export function analyzeFileScopes(
  task: string,
  agents: AgentId[],
  availableFiles: string[]
): TaskAssignment[] {
  // For now, return unscoped assignments (all files available to all agents).
  // A future version could use a fast LLM call to decompose the task.
  return agents.map((agent) => ({
    agent,
    prompt: task,
    scopedFiles: [],          // Empty = no restrictions
    readOnlyContext: [],
    worktreePath: "",         // Set later by worktree creation
  }));
}

/**
 * Check for file scope overlaps between assignments.
 * Only relevant when scopedFiles are explicitly set.
 */
export function detectScopeOverlaps(
  assignments: TaskAssignment[]
): FileOverlap[] {
  const fileToAgents = new Map<string, AgentId[]>();

  for (const a of assignments) {
    for (const file of a.scopedFiles) {
      const existing = fileToAgents.get(file) ?? [];
      existing.push(a.agent);
      fileToAgents.set(file, existing);
    }
  }

  const overlaps: FileOverlap[] = [];
  for (const [file, agents] of fileToAgents) {
    if (agents.length > 1) {
      overlaps.push({ file, agents });
    }
  }

  return overlaps;
}

/**
 * Determine the overlap resolution strategy.
 */
export function resolveOverlapStrategy(
  overlaps: FileOverlap[],
  isCouncilMode: boolean
): OverlapStrategy {
  if (overlaps.length === 0) return "council"; // No overlaps, proceed
  if (isCouncilMode) return "council"; // Council mode: overlap is intentional
  if (overlaps.length <= 2) return "designate"; // Few overlaps: assign to one agent
  return "user_decide"; // Many overlaps: ask user
}

/**
 * Add file scope constraints to the agent's prompt.
 */
export function addScopeToPrompt(
  basePrompt: string,
  assignment: TaskAssignment
): string {
  if (assignment.scopedFiles.length === 0 && assignment.readOnlyContext.length === 0) {
    return basePrompt; // No scoping
  }

  let scoped = basePrompt + "\n\n## File Scope\n\n";

  if (assignment.scopedFiles.length > 0) {
    scoped += "You should ONLY modify these files:\n";
    for (const f of assignment.scopedFiles) {
      scoped += `- ${f}\n`;
    }
  }

  if (assignment.readOnlyContext.length > 0) {
    scoped += "\nYou may READ but NOT MODIFY these files for context:\n";
    for (const f of assignment.readOnlyContext) {
      scoped += `- ${f}\n`;
    }
  }

  return scoped;
}
