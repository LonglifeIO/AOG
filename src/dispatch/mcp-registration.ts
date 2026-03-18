import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AgentId } from "../agents/types.js";

/**
 * Register AOG as a callback MCP server in worker worktrees.
 * This is v2 prep — allows workers to report progress back to AOG.
 *
 * Callback tools (future):
 * - aog_report_progress: Worker reports partial completion
 * - aog_request_file_lock: Worker wants a file outside its scope
 * - aog_signal_complete: Worker finished
 * - aog_signal_blocked: Worker needs guidance
 */

interface McpServerConfig {
  command: string;
  args: string[];
}

const AOG_MCP_CONFIG: McpServerConfig = {
  command: "npx",
  args: ["-y", "aog-mcp-server", "--callback-mode"],
};

export async function registerMcpCallback(
  worktreePath: string,
  agent: AgentId
): Promise<void> {
  switch (agent) {
    case "claude":
      await registerForClaude(worktreePath);
      break;
    case "codex":
      await registerForCodex(worktreePath);
      break;
    case "gemini":
      await registerForGemini(worktreePath);
      break;
  }
}

async function registerForClaude(worktreePath: string): Promise<void> {
  const configPath = join(worktreePath, ".mcp.json");
  const config = {
    mcpServers: {
      "aog-callback": AOG_MCP_CONFIG,
    },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

async function registerForCodex(worktreePath: string): Promise<void> {
  const configDir = join(worktreePath, ".codex");
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "config.toml");
  const config = `[mcp.servers.aog-callback]
command = "${AOG_MCP_CONFIG.command}"
args = ${JSON.stringify(AOG_MCP_CONFIG.args)}
`;
  await writeFile(configPath, config, "utf-8");
}

async function registerForGemini(worktreePath: string): Promise<void> {
  const configDir = join(worktreePath, ".gemini");
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "settings.json");
  const config = {
    mcpServers: {
      "aog-callback": AOG_MCP_CONFIG,
    },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}
