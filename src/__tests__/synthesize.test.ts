import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, AgentResult, AogConfig } from "../agents/types.js";

vi.mock("../council/pipeline.js", () => ({
  runCouncilPipeline: vi.fn(),
}));
vi.mock("../tools/build.js", () => ({
  handleBuild: vi.fn(),
}));
vi.mock("../utils/session.js", () => ({
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
}));

import { runCouncilPipeline } from "../council/pipeline.js";
import { handleBuild } from "../tools/build.js";
import { _resetNoticesForTests } from "../utils/notices.js";
import { handleSynthesize } from "../tools/synthesize.js";

const mockRun = runCouncilPipeline as unknown as ReturnType<typeof vi.fn>;
const mockBuild = handleBuild as unknown as ReturnType<typeof vi.fn>;

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
      agent: "claude",
      model: "any",
      status: "completed",
      duration_ms: 1100,
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
  scratch = mkdtempSync(join(tmpdir(), "aog-synth-"));
  mkdirSync(join(scratch, "research"), { recursive: true });
  writeFileSync(join(scratch, "research", "sample.md"), "# Sample\nFindings.\n");
  process.chdir(scratch);
});

afterAll(() => {
  process.chdir(origCwd);
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  mockRun.mockReset();
  mockBuild.mockReset();
  _resetNoticesForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockRun.mockResolvedValue({
    status: "success",
    chairman: "claude",
    participated: ["claude", "codex", "gemini"],
    failed: [],
    filesChanged: ["docs/IMPLEMENTATION-PLAN.md"],
    mergedFrom: { "docs/IMPLEMENTATION-PLAN.md": "claude" },
    outputPath: "docs/IMPLEMENTATION-PLAN.md",
    durationMs: 1500,
    implementations: {},
    reviews: {},
    synthesis: null,
    testsRan: false,
  });

  mockBuild.mockResolvedValue({
    taskId: "build-1",
    mode: "council",
    status: "success",
    summary: "Council built (3/3). Chairman: claude.",
    participated: ["claude", "codex", "gemini"],
    failed: [],
    files_changed: ["src/foo.ts"],
    duration_ms: 5000,
    session_path: ".aog/sessions/build-1.json",
  });
});

describe("aog_synthesize council/solo + then_build", () => {
  it("S1: council with populated research/ → runCouncilPipeline op=synthesize", async () => {
    const am = makeAgentManager({});
    const result = await handleSynthesize(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun.mock.calls[0][0].operation).toBe("synthesize");
    expect(mockRun.mock.calls[0][0].outputPath).toBe("docs/IMPLEMENTATION-PLAN.md");
    expect(result.mode).toBe("council");
  });

  it("S2: solo defaults to Claude", async () => {
    const am = makeAgentManager({});
    await handleSynthesize(
      { mode: "solo" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(am.spawn).toHaveBeenCalledOnce();
    expect(am.spawn.mock.calls[0][0]).toBe("claude");
  });

  it("S3: missing research_dir → MissingResearch error, no spawn", async () => {
    const am = makeAgentManager({});
    const result = await handleSynthesize(
      { mode: "solo", research_dir: "nonexistent-research" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("MissingResearch");
    expect(am.spawn).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("S4: council with single CLI installed → falls back to solo with notice", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const am = makeAgentManager({ available: ["claude"] });
    const result = await handleSynthesize(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(am.spawn).toHaveBeenCalledOnce();
    expect(am.spawn.mock.calls[0][0]).toBe("claude");
    expect(result.mode).toBe("solo");
    const printed = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/Council mode requires 2\+ CLIs/);
  });

  it("S5: then_build:true council both phases → synthesize then build chained", async () => {
    const am = makeAgentManager({});
    const result = await handleSynthesize(
      { then_build: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockBuild).toHaveBeenCalledOnce();
    expect(mockBuild.mock.calls[0][0].mode).toBe("council");
    expect(mockBuild.mock.calls[0][0].task).toMatch(/Execute the implementation plan/);
    expect(result.then_build).toBe(true);
    expect((result.build as { mode: string }).mode).toBe("council");
  });

  it("S6: then_build:true with synthesis failure → build skipped", async () => {
    mockRun.mockResolvedValueOnce({
      status: "failed",
      chairman: "claude",
      participated: [],
      failed: ["claude", "codex", "gemini"],
      filesChanged: [],
      durationMs: 200,
      implementations: {},
      reviews: {},
      synthesis: null,
      testsRan: false,
    });
    const am = makeAgentManager({});
    const result = await handleSynthesize(
      { then_build: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockBuild).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.then_build).toBeUndefined();
  });

  it("S7: then_build:true with mode=solo → both phases run solo", async () => {
    const am = makeAgentManager({});
    const result = await handleSynthesize(
      { mode: "solo", then_build: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(am.spawn).toHaveBeenCalledOnce();
    expect(mockBuild).toHaveBeenCalledOnce();
    expect(mockBuild.mock.calls[0][0].mode).toBe("solo");
    expect(result.then_build).toBe(true);
  });
});
