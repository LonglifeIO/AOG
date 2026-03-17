import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentManager } from "./agents/manager.js";
import { WorktreeManager } from "./worktree/manager.js";
import { handleDelegate } from "./tools/delegate.js";
import { handleCouncil } from "./tools/council.js";
import { handlePipeline } from "./tools/pipeline.js";
import { handleStatus } from "./tools/status.js";
import { handleCancel } from "./tools/cancel.js";

// Tool input schemas
const DelegateSchema = {
  task: z.string().describe("Natural language task description"),
  task_type: z
    .enum(["IMPLEMENT", "REFACTOR", "REVIEW", "RESEARCH", "MIGRATE", "GENERATE", "DEBUG", "ANALYZE"])
    .optional()
    .describe("Task classification for routing. Auto-detected if omitted."),
  preferred_agent: z
    .enum(["claude", "codex", "gemini"])
    .optional()
    .describe("Force routing to a specific agent"),
  use_worktree: z
    .boolean()
    .default(false)
    .describe("Run in an isolated git worktree"),
  model: z.string().optional().describe("Model override for the agent"),
  max_turns: z.number().int().min(1).max(100).optional().describe("Max agent iterations (Claude)"),
  max_budget_usd: z.number().min(0).max(50).optional().describe("USD spending cap (Claude)"),
  timeout: z.number().int().min(10000).max(1800000).optional().describe("Timeout in milliseconds"),
};

const CouncilSchema = {
  task: z.string().describe("Complex coding task requiring multi-agent consensus"),
  agents: z
    .array(z.enum(["claude", "codex", "gemini"]))
    .min(2)
    .max(3)
    .optional()
    .describe("Agents to include (defaults to all available)"),
  chairman: z
    .enum(["claude", "codex", "gemini", "best-scorer"])
    .optional()
    .describe("Chairman agent for synthesis (default: claude)"),
  council_mode: z
    .enum(["hierarchical", "equal", "user-chairman"])
    .default("hierarchical")
    .describe("hierarchical: Claude orchestrates. equal: all implement independently. user-chairman: user picks winner."),
  run_tests: z
    .boolean()
    .default(true)
    .describe("Run test suite after each implementation"),
  test_command: z.string().optional().describe("Test command (default: npm test)"),
  timeout: z.number().int().min(30000).max(3600000).optional().describe("Total timeout in ms"),
};

const PipelineSchema = {
  template: z.string().describe("Pipeline template name (e.g., 'full-council', 'quick-fix', 'research-synthesis')"),
  task: z.string().describe("Task description to pass through the pipeline"),
  params: z.record(z.unknown()).optional().describe("Additional parameters for the pipeline"),
  timeout: z.number().int().optional().describe("Total pipeline timeout in ms"),
  resume_task_id: z.string().optional().describe("Resume a paused pipeline by task ID"),
};

const StatusSchema = {
  task_id: z.string().optional().describe("Specific task ID to check (omit for all active)"),
  detail_level: z
    .enum(["summary", "diffs", "full"])
    .default("summary")
    .describe("summary: status only. diffs: include file diffs. full: everything including reviews."),
};

const CancelSchema = {
  task_id: z.string().describe("Task ID to cancel"),
  force: z.boolean().default(false).describe("Force kill agent processes"),
};

interface AogServer {
  start(): Promise<void>;
}

export async function createServer(): Promise<AogServer> {
  const projectRoot = process.cwd();
  const agentManager = new AgentManager(projectRoot);
  const worktreeManager = new WorktreeManager(projectRoot);

  await agentManager.initialize();

  const server = new McpServer(
    { name: "aog", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // council_delegate — Route task to best single agent
  server.tool(
    "council_delegate",
    "Route a coding task to the best available CLI agent based on task type. " +
    "Supports Claude Code, Codex CLI, and Gemini CLI. " +
    "Optionally runs in an isolated git worktree.",
    DelegateSchema,
    async (args) => {
      const result = await handleDelegate(args, agentManager, worktreeManager);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // council_run — Fan-out to agent team with cross-review
  server.tool(
    "council_run",
    "Fan out a complex task to multiple CLI agents working in parallel. " +
    "Each agent works in an isolated git worktree. " +
    "Includes cross-review with anonymized diffs and chairman synthesis.",
    CouncilSchema,
    async (args) => {
      const result = await handleCouncil(args, agentManager, worktreeManager);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // council_pipeline — Execute multi-stage pipeline
  server.tool(
    "council_pipeline",
    "Execute a named multi-stage pipeline across agents. " +
    "Built-in templates: full-council, quick-fix, migration, dependency-update, research-synthesis. " +
    "Stages run sequentially with context passing between them.",
    PipelineSchema,
    async (args) => {
      const result = await handlePipeline(args, agentManager, worktreeManager);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // council_status — Check running session status
  server.tool(
    "council_status",
    "Check the status of running or completed AOG sessions. " +
    "Returns agent progress, stage completion, and results.",
    StatusSchema,
    async (args) => {
      const result = await handleStatus(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // council_cancel — Cancel running session
  server.tool(
    "council_cancel",
    "Cancel a running AOG session. Terminates agent processes and cleans up worktrees.",
    CancelSchema,
    async (args) => {
      const result = await handleCancel(args, agentManager, worktreeManager);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  return {
    async start() {
      const available = agentManager.getAvailableAgents();
      console.error(`AOG MCP Server v0.1.0 — available agents: ${available.join(", ") || "none"}`);

      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
