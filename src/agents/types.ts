import { z } from "zod";

// Agent identifiers
export const AgentId = z.enum(["claude", "codex", "gemini"]);
export type AgentId = z.infer<typeof AgentId>;

// CLI binary names
export const CLI_BINARIES: Record<AgentId, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

// Task types for routing
export const TaskType = z.enum([
  "IMPLEMENT",
  "REFACTOR",
  "REVIEW",
  "RESEARCH",
  "MIGRATE",
  "GENERATE",
  "DEBUG",
  "ANALYZE",
]);
export type TaskType = z.infer<typeof TaskType>;

// Execution modes
export const ExecutionMode = z.enum(["delegate", "council", "pipeline"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

// Pipeline status
export const PipelineStatus = z.enum([
  "pending",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type PipelineStatus = z.infer<typeof PipelineStatus>;

// Stage types
export const StageType = z.enum([
  "fan-out",
  "sequential",
  "cross-review",
  "chairman",
  "test",
  "approval",
]);
export type StageType = z.infer<typeof StageType>;

// Cost tracking
export interface CostInfo {
  usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
}

// Code changes extracted from git
export interface CodeChanges {
  branch: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  diff_summary: string;
  diff: string;
}

// Test results
export interface TestResult {
  passed: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
}

// Session info for resumption
export interface SessionInfo {
  id: string;
  resumable: boolean;
}

// Per-agent result after execution
export interface AgentResult {
  taskId: string;
  agent: AgentId;
  model: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  duration_ms: number;
  result: string;
  cost: CostInfo;
  changes: CodeChanges | null;
  tests: TestResult | null;
  session: SessionInfo;
}

// Review output from cross-review
export const ReviewVerdict = z.enum(["approve", "reject", "suggest"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const ReviewSeverity = z.enum(["critical", "major", "minor", "nit"]);
export type ReviewSeverity = z.infer<typeof ReviewSeverity>;

export interface ReviewComment {
  file: string;
  line: number;
  severity: ReviewSeverity;
  comment: string;
  suggested_fix?: string;
}

export interface ReviewRanking {
  correctness: number;
  readability: number;
  performance: number;
  test_coverage: number;
}

export interface ReviewOutput {
  reviewer: AgentId;
  target: string;
  verdict: ReviewVerdict;
  confidence: number;
  summary: string;
  comments: ReviewComment[];
  ranking: ReviewRanking;
}

// Synthesis result from chairman merge
export interface SynthesisResult {
  chairman: AgentId;
  strategy: "best-wins" | "chairman-merge" | "manual";
  branch: string;
  tests_passed: boolean;
  merge_commit: string | null;
  summary: string;
}

// Agent implementation record
export interface AgentImplementation {
  agent: AgentId;
  branch: string;
  worktreePath: string;
  diff: string | null;
  diffSummary: string | null;
  testResults: TestResult | null;
  exitCode: number | null;
  pid: number | null;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
}

// Stage transition for audit
export interface StageTransition {
  timestamp: string;
  stage: string;
  event: "started" | "completed" | "failed" | "skipped";
  agent?: AgentId;
  details?: Record<string, unknown>;
}

// Full pipeline state
export interface PipelineState {
  taskId: string;
  description: string;
  pipeline: string;
  status: PipelineStatus;
  currentStage: string;
  implementations: Record<string, AgentImplementation>;
  reviews: Record<string, ReviewOutput[]>;
  synthesis: SynthesisResult | null;
  history: StageTransition[];
  startedAt: string;
  updatedAt: string;
}

// Full council result returned to MCP client
export interface CouncilResult {
  taskId: string;
  mode: ExecutionMode;
  status: "success" | "partial" | "failed";
  duration_ms: number;
  agents: Record<string, AgentResult>;
  reviews?: Record<string, Record<string, ReviewOutput>>;
  synthesis?: SynthesisResult;
}

// Agent spawner interface
export interface AgentSpawner {
  readonly name: AgentId;
  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  spawn(options: SpawnOptions): Promise<AgentResult>;
  kill(pid: number): Promise<void>;
}

// Council mode types
export type CouncilMode =
  | "hierarchical"   // Claude orchestrates, dispatches to Codex/Gemini (default)
  | "equal"          // All three implement independently, fresh synthesis
  | "user-chairman"; // All three implement, user reviews and picks

// Options for spawning an agent
export interface SpawnOptions {
  prompt: string;
  cwd: string;
  taskId: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeout?: number;
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  allowPermissionBypass?: boolean;
  scopedFiles?: string[];
  readOnlyContext?: string[];
}

// Pipeline template (loaded from YAML)
export interface PipelineTemplate {
  name: string;
  version: number;
  timeout: number;
  description: string;
  agents: PipelineAgentConfig[];
  stages: PipelineStageConfig[];
}

export interface PipelineAgentConfig {
  id: AgentId;
  cli: string;
  timeout: number;
  flags: string[];
}

export interface PipelineStageConfig {
  id: string;
  type: StageType;
  agents?: AgentId[];
  command?: string;
  timeout?: number;
  anonymize?: boolean;
  chairman?: AgentId | "best-scorer" | "user-choice";
  strategy?: "best-wins" | "chairman-merge";
  mode?: "auto" | "interactive";
  input?: string | string[];
  on_failure?: "abort" | "continue";
  prompt_template?: string;
  description?: string;
  present?: string[];
  output?: string;
}

// Configuration
export interface AogConfig {
  agents: {
    claude?: { enabled: boolean; model?: string; maxTurns?: number; maxBudgetUsd?: number };
    codex?: { enabled: boolean; model?: string; useNativeMcp?: boolean };
    gemini?: { enabled: boolean; model?: string };
  };
  defaults: {
    chairman: AgentId;
    timeout: number;
    pipeline: string;
  };
  security: {
    require_approval_before_merge: boolean;
    allow_permission_bypass: boolean;
    max_parallel_agents: number;
    max_budget_per_task_usd: number;
    audit_logging: boolean;
  };
  routing: {
    overrides?: Partial<Record<TaskType, AgentId>>;
  };
}
