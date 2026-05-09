import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, AgentResult, AogConfig } from "../agents/types.js";

vi.mock("../council/pipeline.js", () => ({
  runCouncilPipeline: vi.fn(),
}));
vi.mock("../utils/session.js", () => ({
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
}));

import { runCouncilPipeline } from "../council/pipeline.js";
import { _resetNoticesForTests } from "../utils/notices.js";
import { handleResearch } from "../tools/research.js";

const mockRun = runCouncilPipeline as unknown as ReturnType<typeof vi.fn>;

interface MockAgentManager {
  getAvailableAgents(): AgentId[];
  isAvailable(a: AgentId): boolean;
  getConfig(): AogConfig | null;
  spawn: ReturnType<typeof vi.fn>;
}

interface MockWorktreeManager {
  create: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeAgentManager(opts: {
  available?: AgentId[];
  configMode?: "council" | "solo";
}): MockAgentManager {
  const available = opts.available ?? ["claude", "codex", "gemini"];
  const set = new Set(available);
  return {
    getAvailableAgents: () => [...available],
    isAvailable: (a) => set.has(a),
    getConfig: () =>
      ({ defaults: { mode: opts.configMode ?? "council" } } as AogConfig),
    spawn: vi.fn().mockResolvedValue({
      taskId: "abc",
      agent: "gemini",
      model: "any",
      status: "completed",
      duration_ms: 800,
      result: "ok",
      cost: { usd: null, tokens_in: null, tokens_out: null },
      changes: null,
      tests: null,
      session: { id: "x", resumable: false },
    } satisfies AgentResult),
  };
}

const noopWorktree: MockWorktreeManager = {
  create: vi.fn().mockResolvedValue({ path: "/tmp/x", branch: "aog/test/x" }),
  remove: vi.fn().mockResolvedValue(undefined),
};

let scratch: string;
const origCwd = process.cwd();

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "aog-research-"));
  process.chdir(scratch);
});

afterAll(() => {
  process.chdir(origCwd);
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  mockRun.mockReset();
  _resetNoticesForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockRun.mockResolvedValue({
    status: "success",
    chairman: "claude",
    participated: ["claude", "codex", "gemini"],
    failed: [],
    filesChanged: ["research/how-rate-limits-work.md"],
    mergedFrom: { "research/how-rate-limits-work.md": "claude" },
    outputPath: "research/how-rate-limits-work.md",
    durationMs: 2200,
    implementations: {},
    reviews: {},
    synthesis: null,
    testsRan: false,
  });
});

describe("aog_research council/solo dispatch", () => {
  it("R1: council with all 3 CLIs → fans out, chairman merges", async () => {
    const am = makeAgentManager({});
    const result = await handleResearch(
      { question: "how do rate limits work?" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun.mock.calls[0][0].operation).toBe("research");
    expect(mockRun.mock.calls[0][0].agents).toEqual(["claude", "codex", "gemini"]);
    expect(mockRun.mock.calls[0][0].outputPath).toMatch(/^research\/.*\.md$/);
    expect(result.mode).toBe("council");
    expect(result.chairman).toBe("claude");
  });

  it("R2: solo defaults to Gemini when available", async () => {
    const am = makeAgentManager({});
    await handleResearch(
      { question: "x?", mode: "solo" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(am.spawn).toHaveBeenCalledOnce();
    expect(am.spawn.mock.calls[0][0]).toBe("gemini");
  });

  it("R3: solo with only Claude installed → uses Claude (Gemini fallback)", async () => {
    const am = makeAgentManager({ available: ["claude"] });
    await handleResearch(
      { question: "x?", mode: "solo" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(am.spawn).toHaveBeenCalledOnce();
    expect(am.spawn.mock.calls[0][0]).toBe("claude");
  });

  it("R4: council with only Codex installed → falls back to solo with Codex + notice", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const am = makeAgentManager({ available: ["codex"] });
    const result = await handleResearch(
      { question: "x?" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(am.spawn).toHaveBeenCalledOnce();
    expect(am.spawn.mock.calls[0][0]).toBe("codex");
    const printed = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/Council mode requires 2\+ CLIs/);
    expect(result.mode).toBe("solo");
  });

  it("R5: council passes custom output_path through to pipeline", async () => {
    const am = makeAgentManager({});
    await handleResearch(
      { question: "x?", output_path: "docs/notes.md" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun.mock.calls[0][0].outputPath).toBe("docs/notes.md");
  });
});
