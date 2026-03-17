import type { AgentId, AgentImplementation, ReviewOutput, SynthesisResult } from "../agents/types.js";

// Gate types — the ONLY points where the user is interrupted
export type GateType =
  | "pre-dispatch"
  | "post-implementation"
  | "pre-merge"
  | "on-failure"
  | "pipeline-approval";

export interface GateDecision {
  approved: boolean;
  message?: string;
  choice?: string; // For multi-choice gates (e.g., "retry" | "reassign" | "skip")
}

export interface GateConfig {
  auto_approve: GateType[]; // Gates to skip (auto-approve)
}

const DEFAULT_GATE_CONFIG: GateConfig = {
  auto_approve: [], // All gates prompt by default
};

// Gate result returned as MCP content for the client to display
export interface GatePrompt {
  gate: GateType;
  taskId: string;
  title: string;
  summary: string;
  details: string;
  choices?: string[]; // If provided, user picks one
  default_choice?: string;
}

export function shouldAutoApprove(gate: GateType, config?: GateConfig): boolean {
  return (config ?? DEFAULT_GATE_CONFIG).auto_approve.includes(gate);
}

// --- Gate formatters: build human-readable prompts for each gate type ---

export function formatPreDispatchGate(options: {
  taskId: string;
  task: string;
  agents: AgentId[];
  mode: "delegate" | "council" | "pipeline";
  fileScopes?: Record<string, string[]>;
}): GatePrompt {
  let details = `**Task:** ${options.task}\n\n`;
  details += `**Mode:** ${options.mode}\n`;
  details += `**Agents:** ${options.agents.join(", ")}\n`;

  if (options.fileScopes) {
    details += `\n**File assignments:**\n`;
    for (const [agent, files] of Object.entries(options.fileScopes)) {
      details += `- ${agent}: ${files.join(", ")}\n`;
    }
  }

  return {
    gate: "pre-dispatch",
    taskId: options.taskId,
    title: "Confirm task dispatch",
    summary: `Dispatching to ${options.agents.length} agent(s) in ${options.mode} mode`,
    details,
  };
}

export function formatPostImplementationGate(options: {
  taskId: string;
  implementations: Record<string, AgentImplementation>;
}): GatePrompt {
  let details = "## Implementation Results\n\n";

  for (const [agent, impl] of Object.entries(options.implementations)) {
    const testStatus = impl.testResults
      ? (impl.testResults.passed ? "PASSED" : "FAILED")
      : "not run";
    details += `### ${agent}: ${impl.status}\n`;
    details += `- Tests: ${testStatus}\n`;
    details += `- Changes: ${impl.diffSummary ?? "none"}\n\n`;
  }

  const completed = Object.values(options.implementations).filter((i) => i.status === "completed").length;
  const total = Object.keys(options.implementations).length;

  return {
    gate: "post-implementation",
    taskId: options.taskId,
    title: "Implementation complete",
    summary: `${completed}/${total} agents completed successfully`,
    details,
  };
}

export function formatPreMergeGate(options: {
  taskId: string;
  synthesis: SynthesisResult;
  conflictingFiles?: string[];
}): GatePrompt {
  let details = `## Synthesis Recommendation\n\n`;
  details += `**Strategy:** ${options.synthesis.strategy}\n`;
  details += `**Chairman:** ${options.synthesis.chairman}\n`;
  details += `**Branch:** ${options.synthesis.branch}\n`;
  details += `**Tests passed:** ${options.synthesis.tests_passed}\n\n`;
  details += `${options.synthesis.summary}\n`;

  if (options.conflictingFiles?.length) {
    details += `\n## File Conflicts Detected\n\n`;
    details += `The following files were modified by multiple agents:\n`;
    for (const f of options.conflictingFiles) {
      details += `- ${f}\n`;
    }
    details += `\nChairman has attempted to resolve these.`;
  }

  return {
    gate: "pre-merge",
    taskId: options.taskId,
    title: "Apply changes to main branch?",
    summary: `${options.synthesis.strategy}: ${options.synthesis.branch}`,
    details,
    choices: ["apply", "inspect", "discard"],
    default_choice: "apply",
  };
}

export function formatOnFailureGate(options: {
  taskId: string;
  agent: AgentId;
  error: string;
  availableAgents: AgentId[];
}): GatePrompt {
  const others = options.availableAgents.filter((a) => a !== options.agent);
  const choices = ["retry", "skip"];
  if (others.length > 0) {
    choices.push(...others.map((a) => `reassign-${a}`));
  }

  return {
    gate: "on-failure",
    taskId: options.taskId,
    title: `Agent ${options.agent} failed`,
    summary: options.error.slice(0, 200),
    details: `Agent **${options.agent}** failed with:\n\n\`\`\`\n${options.error}\n\`\`\`\n\nAvailable alternatives: ${others.join(", ") || "none"}`,
    choices,
    default_choice: "skip",
  };
}

export function formatPipelineApprovalGate(options: {
  taskId: string;
  stage: string;
  pipeline: string;
  filesForReview?: string[];
  summary?: string;
}): GatePrompt {
  let details = `**Pipeline:** ${options.pipeline}\n`;
  details += `**Stage:** ${options.stage}\n\n`;

  if (options.summary) {
    details += options.summary + "\n\n";
  }

  if (options.filesForReview?.length) {
    details += `**Files to review:**\n`;
    for (const f of options.filesForReview) {
      details += `- ${f}\n`;
    }
  }

  return {
    gate: "pipeline-approval",
    taskId: options.taskId,
    title: `Pipeline approval required: ${options.stage}`,
    summary: `Pipeline ${options.pipeline} paused at stage ${options.stage}`,
    details,
    choices: ["approve", "reject", "modify"],
    default_choice: "approve",
  };
}
