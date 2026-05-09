import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentId, AgentResult, AogConfig } from "../agents/types.js";

// Mock council pipeline + delegate before importing the SUT.
vi.mock("../council/pipeline.js", () => ({
  runCouncilPipeline: vi.fn(),
}));
vi.mock("../tools/delegate.js", () => ({
  handleDelegate: vi.fn(),
}));

import { runCouncilPipeline } from "../council/pipeline.js";
import { handleDelegate } from "../tools/delegate.js";
import { _resetNoticesForTests } from "../utils/notices.js";
import { handleBuild } from "../tools/build.js";

const mockRun = runCouncilPipeline as unknown as ReturnType<typeof vi.fn>;
const mockDelegate = handleDelegate as unknown as ReturnType<typeof vi.fn>;

interface MockAgentManager {
  getAvailableAgents(): AgentId[];
  isAvailable(a: AgentId): boolean;
  getConfig(): AogConfig | null;
  spawn(a: AgentId, options: unknown): Promise<AgentResult>;
}

interface MockWorktreeManager {
  create(): Promise<{ path: string; branch: string }>;
  remove(): Promise<void>;
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
      ({
        defaults: { mode: opts.configMode ?? "council" },
      } as AogConfig),
    spawn: vi.fn(),
  };
}

const noopWorktree: MockWorktreeManager = {
  create: vi.fn().mockResolvedValue({ path: "/tmp/x", branch: "aog/test/x" }),
  remove: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  mockRun.mockReset();
  mockDelegate.mockReset();
  _resetNoticesForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockRun.mockResolvedValue({
    status: "success",
    chairman: "claude",
    participated: ["claude", "codex", "gemini"],
    failed: [],
    filesChanged: ["src/foo.ts"],
    mergedFrom: { "src/foo.ts": "claude" },
    durationMs: 1234,
    implementations: {},
    reviews: {},
    synthesis: null,
    testsRan: true,
  });

  mockDelegate.mockResolvedValue({
    taskId: "abc",
    status: "completed",
    summary: "claude completed in 1.2s",
    files_changed: [],
    duration_ms: 1200,
    session_path: ".aog/sessions/abc.json",
  });
});

describe("aog_build council/solo dispatch", () => {
  it("B1: council with 3 CLIs available → fans out to all three", async () => {
    const am = makeAgentManager({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handleBuild({ task: "ship it" }, am as any, noopWorktree as any);
    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun.mock.calls[0][0].operation).toBe("build");
    expect(mockRun.mock.calls[0][0].agents).toEqual(["claude", "codex", "gemini"]);
    expect(result.mode).toBe("council");
    expect(result.chairman).toBe("claude");
    expect(result.participated).toEqual(["claude", "codex", "gemini"]);
    expect(result.failed).toEqual([]);
    expect(result.merged_from).toEqual({ "src/foo.ts": "claude" });
  });

  it("B2: mode=solo with default task_type → delegates to one agent", async () => {
    const am = makeAgentManager({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handleBuild({ task: "ship it", mode: "solo" }, am as any, noopWorktree as any);
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockDelegate).toHaveBeenCalledOnce();
    expect(result.mode).toBe("solo");
  });

  it("B3: solo with task_type=GENERATE → forwards task_type to delegate (Codex routing)", async () => {
    const am = makeAgentManager({});
    await handleBuild(
      { task: "scaffold", mode: "solo", task_type: "GENERATE" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockDelegate).toHaveBeenCalledOnce();
    expect(mockDelegate.mock.calls[0][0].task_type).toBe("GENERATE");
  });

  it("B4: council with only Claude installed → falls back to solo with stderr notice", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const am = makeAgentManager({ available: ["claude"] });
    const result = await handleBuild(
      { task: "ship it" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockDelegate).toHaveBeenCalledOnce();
    expect(mockDelegate.mock.calls[0][0].preferred_agent).toBe("claude");
    expect(stderr).toHaveBeenCalled();
    const printed = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/Council mode requires 2\+ CLIs/);
    expect(printed).toMatch(/running solo with claude/);
    expect(result.mode).toBe("solo");
  });

  it("B5: explicit agents=['claude'] → falls back to solo with notice", async () => {
    const am = makeAgentManager({});
    await handleBuild(
      { task: "ship it", agents: ["claude"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockDelegate).toHaveBeenCalledOnce();
  });

  it("B6: two-agent council [claude, codex] → fan-out without fallback", async () => {
    const am = makeAgentManager({});
    await handleBuild(
      { task: "ship it", agents: ["claude", "codex"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun.mock.calls[0][0].agents).toEqual(["claude", "codex"]);
    expect(mockDelegate).not.toHaveBeenCalled();
  });

  it("T1: council mode + task_type=GENERATE → all CLIs run, no codex preference", async () => {
    const am = makeAgentManager({});
    await handleBuild(
      { task: "scaffold", task_type: "GENERATE" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun.mock.calls[0][0].agents).toEqual(["claude", "codex", "gemini"]);
  });

  it("T2: solo mode + task_type=GENERATE → delegate sees task_type, picks Codex via router", async () => {
    const am = makeAgentManager({});
    await handleBuild(
      { task: "scaffold", mode: "solo", task_type: "GENERATE" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockDelegate.mock.calls[0][0].task_type).toBe("GENERATE");
  });

  it("C1: defaults.mode=solo with no explicit mode → solo path", async () => {
    const am = makeAgentManager({ configMode: "solo" });
    await handleBuild(
      { task: "ship it" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockDelegate).toHaveBeenCalledOnce();
  });

  it("C2: defaults.mode=solo + explicit mode=council → council overrides config", async () => {
    const am = makeAgentManager({ configMode: "solo" });
    await handleBuild(
      { task: "ship it", mode: "council" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it("partial failure: 1 of 3 agents fails → status=partial, failed list populated", async () => {
    mockRun.mockResolvedValueOnce({
      status: "partial",
      chairman: "claude",
      participated: ["claude", "codex"],
      failed: ["gemini"],
      filesChanged: ["src/x.ts"],
      mergedFrom: { "src/x.ts": "claude" },
      durationMs: 5000,
      implementations: {},
      reviews: {},
      synthesis: null,
      testsRan: true,
    });
    const am = makeAgentManager({});
    const result = await handleBuild(
      { task: "ship it" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(result.status).toBe("partial");
    expect(result.failed).toEqual(["gemini"]);
    expect(result.participated).toEqual(["claude", "codex"]);
    expect(String(result.summary)).toMatch(/failed: gemini/);
  });

  it("response observability: chairman + participated + merged_from present", async () => {
    const am = makeAgentManager({});
    const result = await handleBuild(
      { task: "ship it" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      am as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noopWorktree as any
    );
    expect(result.chairman).toBeDefined();
    expect(result.participated).toBeDefined();
    expect(result.failed).toBeDefined();
    expect(result.merged_from).toBeDefined();
    expect(result.session_path).toBeDefined();
  });
});
