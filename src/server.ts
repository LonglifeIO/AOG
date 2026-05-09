import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentManager } from "./agents/manager.js";
import { WorktreeManager } from "./worktree/manager.js";
import { ProgressReporter } from "./interaction/progress.js";
import { handlePipeline } from "./tools/pipeline.js";
import { handleStatus } from "./tools/status.js";
import { handleCancel } from "./tools/cancel.js";
import { handleBuild } from "./tools/build.js";
import { handleSynthesize } from "./tools/synthesize.js";
import { handleResearch } from "./tools/research.js";
import { noticeOnce } from "./utils/notices.js";
import type { AgentId } from "./agents/types.js";

const VERSION = "2.0.0";

/**
 * Forward a v1.x `aog_council` call to the new `aog_build` with
 * mode='council', emitting a one-time deprecation notice. Exported for
 * testability.
 */
export async function forwardDeprecatedCouncil(
  args: {
    task?: string;
    task_file?: string;
    agents?: AgentId[];
    chairman?: AgentId | "best-scorer";
    run_tests?: boolean;
    test_command?: string;
    timeout?: number;
  },
  agentManager: AgentManager,
  worktreeManager: WorktreeManager,
  progress?: ProgressReporter
): Promise<Record<string, unknown>> {
  noticeOnce(
    "deprecation-aog-council",
    `[aog] "aog_council" is deprecated; use "aog_build" (council is the default). Forwarding now. Removed in v2.1.0.`
  );
  return handleBuild(
    {
      task: args.task,
      task_file: args.task_file,
      mode: "council",
      agents: args.agents,
      chairman: args.chairman,
      run_tests: args.run_tests,
      test_command: args.test_command,
      timeout: args.timeout,
    },
    agentManager,
    worktreeManager,
    progress
  );
}

// === Shared council param shape (used in build/research/synthesize) ===

const COUNCIL_MODE = z.enum(["council", "solo"]);
const AGENT_ID = z.enum(["claude", "codex", "gemini"]);
const SYNTHESIS_STRATEGY = z.enum(["best-wins", "chairman-merge", "auto"]);
const CHAIRMAN = z.union([AGENT_ID, z.literal("best-scorer")]);

// === Tool schemas ===

const BuildSchema = {
  task: z.string().optional().describe("What to build (provide this OR task_file)"),
  task_file: z.string().optional().describe("Path to file containing the task description"),

  mode: COUNCIL_MODE
    .optional()
    .describe("council (default) = all available CLIs in parallel + chairman synthesis. solo = single agent."),

  // Council params
  agents: z
    .array(AGENT_ID)
    .optional()
    .describe("Restrict the council to a subset of CLIs (default: all available)."),
  chairman: CHAIRMAN
    .optional()
    .describe("Chairman for council synthesis. Default: claude if installed, else best-scorer."),
  synthesis_strategy: SYNTHESIS_STRATEGY
    .optional()
    .describe("auto (default), best-wins, or chairman-merge."),
  run_tests: z.boolean().optional().describe("Run tests per worktree (default: true if package.json exists, else false)."),
  test_command: z.string().optional().describe("Test command (default: npm test)"),

  // Solo params
  agent: AGENT_ID
    .optional()
    .describe("Force a specific agent in solo mode."),
  task_type: z
    .enum(["IMPLEMENT", "REFACTOR", "REVIEW", "RESEARCH", "MIGRATE", "GENERATE", "DEBUG", "ANALYZE"])
    .optional()
    .describe("Routing key for solo mode. Defaults to IMPLEMENT. Ignored in council mode."),

  // Shared
  use_worktree: z.boolean().optional().describe("Worktree isolation in solo mode (council always uses worktrees)."),
  model: z.string().optional(),
  max_turns: z.number().int().min(1).max(100).optional(),
  max_budget_usd: z.number().min(0).max(50).optional(),
  timeout: z.number().int().min(10000).max(1800000).optional(),
};

const ResearchSchema = {
  question: z.string().optional().describe("Research question (provide this OR task_file)"),
  task_file: z.string().optional(),

  mode: COUNCIL_MODE.optional(),

  agents: z.array(AGENT_ID).optional(),
  chairman: CHAIRMAN.optional(),
  synthesis_strategy: SYNTHESIS_STRATEGY.optional(),

  agent: AGENT_ID
    .optional()
    .describe("Solo-mode default: gemini (1M context) → claude. Ignored in council mode."),

  output_path: z.string().optional().describe("Default: research/{slug}.md"),
  scope_paths: z.array(z.string()).optional(),
  model: z.string().optional(),
  max_turns: z.number().int().min(1).max(100).optional(),
  max_budget_usd: z.number().min(0).max(50).optional(),
  timeout: z.number().int().min(10000).max(1800000).optional(),
};

const SynthesizeSchema = {
  research_dir: z.string().optional().describe("Directory containing research files. Defaults to 'research/'."),
  output_path: z.string().optional().describe("Default: docs/IMPLEMENTATION-PLAN.md"),
  task: z.string().optional().describe("Optional steering context for the synthesis"),
  task_file: z.string().optional(),

  mode: COUNCIL_MODE.optional(),

  agents: z.array(AGENT_ID).optional(),
  chairman: CHAIRMAN.optional(),
  synthesis_strategy: SYNTHESIS_STRATEGY.optional(),

  agent: AGENT_ID.optional().describe("Solo-mode default: claude. Ignored in council mode."),

  then_build: z
    .boolean()
    .optional()
    .describe("After writing the plan, automatically chain into aog_build (inheriting mode/agents/chairman)."),

  include_synthesis: z.boolean().optional().describe("Also write docs/SYNTHESIS.md (default: true)"),
  model: z.string().optional(),
  max_turns: z.number().int().min(1).max(100).optional(),
  max_budget_usd: z.number().min(0).max(50).optional(),
  timeout: z.number().int().min(10000).max(1800000).optional(),
};

const PipelineSchema = {
  template: z.string().describe("Pipeline template name (e.g., 'full-council', 'quick-fix', 'research-synthesis')"),
  task: z.string().optional(),
  task_file: z.string().optional(),
  params: z.record(z.unknown()).optional(),
  timeout: z.number().int().optional(),
  resume_task_id: z.string().optional(),
};

const StatusSchema = {
  task_id: z.string().optional(),
  detail_level: z.enum(["summary", "diffs", "full"]).default("summary"),
};

const CancelSchema = {
  task_id: z.string().describe("Task ID to cancel"),
  force: z.boolean().default(false),
};

// Deprecation alias for v1.x `aog_council`. Forwards to aog_build with
// mode=council. Remove in v2.1.0.
const DeprecatedCouncilSchema = {
  task: z.string().optional(),
  task_file: z.string().optional(),
  agents: z.array(AGENT_ID).min(2).max(3).optional(),
  chairman: CHAIRMAN.optional(),
  run_tests: z.boolean().optional(),
  test_command: z.string().optional(),
  timeout: z.number().int().min(30000).max(3600000).optional(),
};

function createProgressReporter(
  taskId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra: { _meta?: { progressToken?: string | number }; sendNotification: (...args: any[]) => Promise<void> },
  totalSteps?: number
): ProgressReporter {
  const progressToken = extra._meta?.progressToken ?? null;
  return new ProgressReporter({
    taskId,
    sender: extra.sendNotification,
    progressToken,
    totalSteps,
  });
}

interface AogServer {
  start(): Promise<void>;
}

export async function createServer(): Promise<AogServer> {
  const projectRoot = process.cwd();
  const agentManager = new AgentManager(projectRoot);
  const worktreeManager = new WorktreeManager(projectRoot);

  await agentManager.initialize();

  const server = new McpServer({ name: "aog", version: VERSION }, { capabilities: { tools: {} } });

  // === Primary tools (council by default) ===

  server.tool(
    "aog_build",
    "Implement / fix / refactor a task. Council on every call by default — every available CLI works the task " +
    "in parallel git worktrees, cross-reviews anonymized diffs, and a chairman (Claude default) synthesizes. " +
    "Pass mode: 'solo' for single-agent routing-by-strength.",
    BuildSchema,
    async (args, extra) => {
      const progress = createProgressReporter("build", extra);
      const result = await handleBuild(args, agentManager, worktreeManager, progress);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "aog_research",
    "Investigate a question and write structured findings. Council by default: every CLI researches " +
    "in parallel, cross-reviews, chairman merges to one research/{slug}.md. Pass mode: 'solo' for a single agent.",
    ResearchSchema,
    async (args, extra) => {
      const progress = createProgressReporter("research", extra);
      const result = await handleResearch(args, agentManager, worktreeManager, progress);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "aog_synthesize",
    "Turn research into an implementation plan. Council by default. Pass then_build: true to chain " +
    "automatically into aog_build after the plan is written, inheriting mode/agents/chairman.",
    SynthesizeSchema,
    async (args, extra) => {
      const progress = createProgressReporter("synthesize", extra);
      const result = await handleSynthesize(args, agentManager, worktreeManager, progress);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "aog_pipeline",
    "Execute a named multi-stage pipeline across agents (full-council, quick-fix, migration, " +
    "dependency-update, research-synthesis). For approval gates, conditional stages, or per-stage agent selection.",
    PipelineSchema,
    async (args, extra) => {
      const progress = createProgressReporter("pipeline", extra);
      const result = await handlePipeline(args, agentManager, worktreeManager, progress);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "aog_status",
    "Check the status of a running or completed AOG session.",
    StatusSchema,
    async (args) => {
      const result = await handleStatus(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "aog_cancel",
    "Cancel a running AOG session. Terminates agent processes and cleans up worktrees.",
    CancelSchema,
    async (args) => {
      const result = await handleCancel(args, agentManager, worktreeManager);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // === Deprecated alias (removed in v2.1.0) ===

  server.tool(
    "aog_council",
    "[DEPRECATED — use aog_build (council is the default)] Forwards to aog_build with mode='council'. Removed in v2.1.0.",
    DeprecatedCouncilSchema,
    async (args, extra) => {
      const progress = createProgressReporter("council", extra);
      const result = await forwardDeprecatedCouncil(args, agentManager, worktreeManager, progress);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  return {
    async start() {
      const available = agentManager.getAvailableAgents();
      console.error(`AOG MCP Server v${VERSION} — available agents: ${available.join(", ") || "none"}`);

      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
