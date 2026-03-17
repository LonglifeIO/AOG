import type { AgentId } from "../agents/types.js";
import type { ConflictReport, OverlappingFile } from "./detector.js";
import type { OverlapStrategy, TaskAssignment } from "./scoper.js";

export interface ResolutionPlan {
  strategy: OverlapStrategy;
  actions: ResolutionAction[];
  summary: string;
}

export type ResolutionAction =
  | { type: "no_conflict" }
  | { type: "designate_owner"; file: string; owner: AgentId; others_readonly: AgentId[] }
  | { type: "serialize"; order: AgentId[] }
  | { type: "manual_review"; files: OverlappingFile[] }
  | { type: "council_compare"; files: string[] };

/**
 * Given a conflict report and the mode, produce a resolution plan.
 */
export function buildResolutionPlan(
  conflicts: ConflictReport,
  isCouncilMode: boolean
): ResolutionPlan {
  if (!conflicts.hasConflicts) {
    return {
      strategy: "council",
      actions: [{ type: "no_conflict" }],
      summary: "No conflicts. Proceeding with merge.",
    };
  }

  if (isCouncilMode) {
    return {
      strategy: "council",
      actions: [{
        type: "council_compare",
        files: conflicts.overlappingFiles.map((o) => o.path),
      }],
      summary: `Council mode: ${conflicts.overlappingFiles.length} overlapping file(s) will be compared and ranked.`,
    };
  }

  // For non-council mode, designate owners for overlapping files
  const actions: ResolutionAction[] = [];

  for (const overlap of conflicts.overlappingFiles) {
    // Heuristic: first agent in the list gets ownership
    const [owner, ...others] = overlap.agents;
    actions.push({
      type: "designate_owner",
      file: overlap.path,
      owner,
      others_readonly: others,
    });
  }

  return {
    strategy: "designate",
    actions,
    summary: `Designated file owners for ${conflicts.overlappingFiles.length} overlapping file(s).`,
  };
}

/**
 * Apply resolution plan to task assignments (pre-dispatch).
 * Modifies assignments in place to add file scope constraints.
 */
export function applyResolutionToAssignments(
  assignments: TaskAssignment[],
  plan: ResolutionPlan
): void {
  for (const action of plan.actions) {
    if (action.type === "designate_owner") {
      for (const assignment of assignments) {
        if (action.others_readonly.includes(assignment.agent)) {
          // Move file from scoped to read-only for non-owners
          assignment.scopedFiles = assignment.scopedFiles.filter((f) => f !== action.file);
          if (!assignment.readOnlyContext.includes(action.file)) {
            assignment.readOnlyContext.push(action.file);
          }
        }
      }
    }

    if (action.type === "serialize") {
      // Mark assignments with execution order (handled by fanout)
      // The fanout engine will run them sequentially instead of parallel
    }
  }
}
