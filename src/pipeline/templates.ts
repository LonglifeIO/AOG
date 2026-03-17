import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { PipelineTemplate } from "../agents/types.js";

const BUILT_IN_TEMPLATES: Record<string, PipelineTemplate> = {
  "full-council": {
    name: "full-council",
    version: 1,
    timeout: 1800,
    description: "Fan-out implement, test, cross-review, synthesize, final test",
    agents: [
      { id: "claude", cli: "claude", timeout: 300, flags: ["--max-turns", "20", "--max-budget-usd", "5.00"] },
      { id: "codex", cli: "codex", timeout: 300, flags: ["--full-auto"] },
      { id: "gemini", cli: "gemini", timeout: 300, flags: ["--yolo"] },
    ],
    stages: [
      { id: "implement", type: "fan-out", agents: ["claude", "codex", "gemini"], on_failure: "continue" },
      { id: "test", type: "test", command: "npm test", timeout: 120 },
      { id: "cross-review", type: "cross-review", anonymize: true },
      { id: "synthesize", type: "chairman", chairman: "claude", strategy: "chairman-merge" },
      { id: "final-test", type: "test", command: "npm test && npm run lint", timeout: 120 },
    ],
  },

  "quick-fix": {
    name: "quick-fix",
    version: 1,
    timeout: 600,
    description: "Analyze, fix, test, review",
    agents: [
      { id: "gemini", cli: "gemini", timeout: 120, flags: ["--yolo"] },
      { id: "codex", cli: "codex", timeout: 180, flags: ["--full-auto"] },
      { id: "claude", cli: "claude", timeout: 120, flags: ["--max-turns", "10"] },
    ],
    stages: [
      { id: "fix", type: "fan-out", agents: ["codex"], on_failure: "continue" },
      { id: "test", type: "test", command: "npm test", timeout: 120 },
      { id: "review", type: "cross-review", anonymize: false },
    ],
  },

  "migration": {
    name: "migration",
    version: 1,
    timeout: 3600,
    description: "Research, plan consensus, implement stages, review",
    agents: [
      { id: "claude", cli: "claude", timeout: 600, flags: ["--max-turns", "30"] },
      { id: "codex", cli: "codex", timeout: 300, flags: ["--full-auto"] },
      { id: "gemini", cli: "gemini", timeout: 300, flags: ["--yolo"] },
    ],
    stages: [
      { id: "research", type: "fan-out", agents: ["claude", "gemini"], on_failure: "continue" },
      { id: "plan-review", type: "cross-review", anonymize: true },
      { id: "approve-plan", type: "approval", mode: "interactive" },
      { id: "implement", type: "fan-out", agents: ["claude", "codex"], on_failure: "abort" },
      { id: "test", type: "test", command: "npm test", timeout: 300 },
      { id: "final-review", type: "cross-review", anonymize: true },
      { id: "synthesize", type: "chairman", chairman: "claude", strategy: "chairman-merge" },
    ],
  },

  "dependency-update": {
    name: "dependency-update",
    version: 1,
    timeout: 1200,
    description: "Analyze deps, update, test, review",
    agents: [
      { id: "gemini", cli: "gemini", timeout: 300, flags: ["--yolo"] },
      { id: "codex", cli: "codex", timeout: 300, flags: ["--full-auto"] },
      { id: "claude", cli: "claude", timeout: 180, flags: ["--max-turns", "15"] },
    ],
    stages: [
      { id: "analyze", type: "fan-out", agents: ["gemini"], on_failure: "continue" },
      { id: "update", type: "fan-out", agents: ["codex"], on_failure: "abort" },
      { id: "test", type: "test", command: "npm test", timeout: 180 },
      { id: "review", type: "cross-review", anonymize: false },
      { id: "synthesize", type: "chairman", chairman: "claude", strategy: "best-wins" },
    ],
  },
};

export async function loadTemplate(name: string): Promise<PipelineTemplate | null> {
  // Check custom templates
  for (const dir of ["templates", join(".aog", "templates")]) {
    const customPath = join(process.cwd(), dir, `${name}.yaml`);
    if (existsSync(customPath)) {
      try {
        const content = await readFile(customPath, "utf-8");
        return parseYaml(content) as PipelineTemplate;
      } catch {
        // Fall through
      }
    }
  }

  // Also check for research-synthesis (loaded from YAML since it uses prompt_template)
  return BUILT_IN_TEMPLATES[name] ?? null;
}

// Register the research-synthesis template as built-in
BUILT_IN_TEMPLATES["research-synthesis"] = {
  name: "research-synthesis",
  version: 1,
  timeout: 1800,
  description: "Synthesize multi-source research into an implementation plan and build",
  agents: [
    { id: "claude", cli: "claude", timeout: 600, flags: ["--max-turns", "30", "--max-budget-usd", "10.00"] },
  ],
  stages: [
    { id: "synthesize", type: "sequential", agents: ["claude"], timeout: 600, on_failure: "abort",
      prompt_template: "Read every file in research/. Cross-reference findings. Produce docs/SYNTHESIS.md." },
    { id: "plan", type: "sequential", agents: ["claude"], timeout: 600, on_failure: "abort",
      prompt_template: "Based on docs/SYNTHESIS.md, produce docs/IMPLEMENTATION-PLAN.md." },
    { id: "approve", type: "approval", mode: "interactive" },
    { id: "build", type: "sequential", agents: ["claude"], timeout: 900, on_failure: "abort",
      prompt_template: "Execute docs/IMPLEMENTATION-PLAN.md. Build all files. Functional code only." },
  ],
};

export function listTemplates(): Array<{ name: string; description: string }> {
  return Object.values(BUILT_IN_TEMPLATES).map((t) => ({
    name: t.name,
    description: t.description,
  }));
}
