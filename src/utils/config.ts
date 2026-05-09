import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { AogConfig } from "../agents/types.js";

const DEFAULT_CONFIG: AogConfig = {
  agents: {
    claude: { enabled: true, model: "sonnet", maxTurns: 20, maxBudgetUsd: 5.0 },
    codex: { enabled: true, model: "gpt-5.4", useNativeMcp: false },
    gemini: { enabled: true, model: "gemini-2.5-pro" },
  },
  defaults: {
    chairman: "claude",
    timeout: 300000,
    pipeline: "full-council",
    mode: "council",
  },
  security: {
    require_approval_before_merge: true,
    allow_permission_bypass: false,
    max_parallel_agents: 3,
    max_budget_per_task_usd: 10.0,
    audit_logging: true,
  },
  routing: {},
};

export async function loadConfig(projectRoot?: string): Promise<AogConfig> {
  const root = projectRoot ?? process.cwd();

  const paths = [
    join(root, "aog.config.yaml"),
    join(root, "aog.config.yml"),
    join(root, ".aog", "config.yaml"),
  ];

  for (const configPath of paths) {
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, "utf-8");
        const parsed = parseYaml(content) as Partial<AogConfig>;
        return mergeConfig(DEFAULT_CONFIG, parsed);
      } catch {
        // Invalid config
      }
    }
  }

  return DEFAULT_CONFIG;
}

function mergeConfig(defaults: AogConfig, overrides: Partial<AogConfig>): AogConfig {
  return {
    agents: {
      claude: { ...defaults.agents.claude!, ...overrides.agents?.claude },
      codex: { ...defaults.agents.codex!, ...overrides.agents?.codex },
      gemini: { ...defaults.agents.gemini!, ...overrides.agents?.gemini },
    },
    defaults: { ...defaults.defaults, ...overrides.defaults },
    security: { ...defaults.security, ...overrides.security },
    routing: { ...defaults.routing, ...overrides.routing },
  };
}
