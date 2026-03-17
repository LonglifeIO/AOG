import type { AgentId, TaskType } from "../agents/types.js";

/**
 * Static routing matrix — maps task types to preferred agents.
 *
 * IMPLEMENT → claude (best multi-file planning)
 * REFACTOR → claude (plan subagent)
 * REVIEW → gemini (1M token context fits large diffs)
 * RESEARCH → gemini (1M token context for whole-codebase analysis)
 * MIGRATE → claude (complex multi-step ops)
 * GENERATE → codex (fastest execution, pattern-following)
 * DEBUG → claude (diagnostic reasoning)
 * ANALYZE → gemini (deep data extraction)
 */
const ROUTING_TABLE: Record<TaskType, { primary: AgentId; fallback: AgentId }> = {
  IMPLEMENT: { primary: "claude", fallback: "codex" },
  REFACTOR:  { primary: "claude", fallback: "gemini" },
  REVIEW:    { primary: "gemini", fallback: "claude" },
  RESEARCH:  { primary: "gemini", fallback: "claude" },
  MIGRATE:   { primary: "claude", fallback: "codex" },
  GENERATE:  { primary: "codex",  fallback: "claude" },
  DEBUG:     { primary: "claude", fallback: "codex" },
  ANALYZE:   { primary: "gemini", fallback: "claude" },
};

export function routeTask(taskType: TaskType, available: AgentId[]): AgentId {
  const route = ROUTING_TABLE[taskType];

  if (available.includes(route.primary)) return route.primary;
  if (available.includes(route.fallback)) return route.fallback;
  return available[0];
}

export function getRouteInfo(taskType: TaskType): { primary: AgentId; fallback: AgentId; rationale: string } {
  const route = ROUTING_TABLE[taskType];
  const rationales: Record<TaskType, string> = {
    IMPLEMENT: "Claude Code has the best multi-file planning capabilities",
    REFACTOR:  "Claude Code's plan subagent excels at cross-file restructuring",
    REVIEW:    "Gemini's 1M token context window fits large diffs without truncation",
    RESEARCH:  "Gemini's 1M token context enables whole-codebase analysis",
    MIGRATE:   "Claude Code handles complex multi-step operations with careful planning",
    GENERATE:  "Codex CLI has the fastest execution and strong pattern-following",
    DEBUG:     "Claude Code has advanced diagnostic reasoning and tool access",
    ANALYZE:   "Gemini's deep data extraction works over vast file systems",
  };

  return { ...route, rationale: rationales[taskType] };
}
