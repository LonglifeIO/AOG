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
    timeout: 2400,
    description: "Plan consensus, implement stages, review (bring your own research)",
    agents: [
      { id: "claude", cli: "claude", timeout: 600, flags: ["--max-turns", "30"] },
      { id: "codex", cli: "codex", timeout: 300, flags: ["--full-auto"] },
      { id: "gemini", cli: "gemini", timeout: 300, flags: ["--yolo"] },
    ],
    stages: [
      { id: "scan", type: "sequential", agents: ["gemini"], timeout: 120, on_failure: "continue",
        prompt_template: "Briefly scan the codebase and any existing research/ or docs/ for migration context. Produce a short summary of what exists and what needs to change. Do NOT do deep research — just catalog what's there." },
      { id: "approve-plan", type: "approval", mode: "interactive" },
      { id: "implement", type: "fan-out", agents: ["claude", "codex", "gemini"], on_failure: "abort" },
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

const SAFE_TEMPLATE_NAME = /^[a-zA-Z0-9_-]+$/;

export async function loadTemplate(name: string): Promise<PipelineTemplate | null> {
  if (!SAFE_TEMPLATE_NAME.test(name)) {
    throw new Error(`Invalid template name: "${name}". Only alphanumeric, hyphens, and underscores allowed.`);
  }

  // User customizations live in .aog/templates/ — anything there overrides
  // the built-in template of the same name. Built-ins are the single source
  // of truth (in BUILT_IN_TEMPLATES below); we no longer ship YAML duplicates
  // in the package because they drifted silently.
  let template: PipelineTemplate | null = null;
  const customPath = join(process.cwd(), ".aog", "templates", `${name}.yaml`);
  if (existsSync(customPath)) {
    try {
      const content = await readFile(customPath, "utf-8");
      template = parseYaml(content) as PipelineTemplate;
    } catch {
      // Fall through to built-in
    }
  }

  if (!template) {
    template = BUILT_IN_TEMPLATES[name] ?? null;
  }

  if (template) {
    validateTemplateTimeouts(template);
  }

  return template;
}

/**
 * Warn when a template's pipeline-level timeout is shorter than the sum of its
 * stage timeouts — a configuration that masks itself as a hang because the
 * pipeline timeout fires mid-stage but the engine doesn't kill in-flight
 * spawns.
 */
function validateTemplateTimeouts(template: PipelineTemplate): void {
  const stageSum = template.stages.reduce((acc, s) => acc + (s.timeout ?? 0), 0);
  if (stageSum > template.timeout) {
    console.error(
      `[aog] Template "${template.name}" has pipeline timeout ${template.timeout}s ` +
      `but stage timeouts sum to ${stageSum}s. Stages may exceed the pipeline budget — ` +
      `consider raising "timeout" or shortening stage timeouts.`
    );
  }
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
