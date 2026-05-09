import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentId, AogConfig } from "../agents/types.js";

vi.mock("../tools/build.js", () => ({
  handleBuild: vi.fn().mockResolvedValue({
    taskId: "build-1",
    mode: "council",
    status: "success",
    summary: "ok",
    chairman: "claude",
    participated: ["claude", "codex", "gemini"],
    failed: [],
    files_changed: [],
    duration_ms: 1000,
    session_path: ".aog/sessions/build-1.json",
  }),
}));

import { handleBuild } from "../tools/build.js";
import { _resetNoticesForTests } from "../utils/notices.js";
import { forwardDeprecatedCouncil } from "../server.js";

const mockBuild = handleBuild as unknown as ReturnType<typeof vi.fn>;

const fakeAgentManager = {
  getAvailableAgents: () => ["claude", "codex", "gemini"] as AgentId[],
  isAvailable: () => true,
  getConfig: () => ({ defaults: { mode: "council" } } as AogConfig),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeWorktreeManager = {} as any;

beforeEach(() => {
  mockBuild.mockClear();
  _resetNoticesForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D1 — aog_council deprecation alias", () => {
  it("emits deprecation notice once and forwards to handleBuild with mode=council", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await forwardDeprecatedCouncil(
      { task: "ship it", chairman: "codex", run_tests: false },
      fakeAgentManager,
      fakeWorktreeManager
    );

    expect(mockBuild).toHaveBeenCalledOnce();
    const forwardedArgs = mockBuild.mock.calls[0][0];
    expect(forwardedArgs.mode).toBe("council");
    expect(forwardedArgs.task).toBe("ship it");
    expect(forwardedArgs.chairman).toBe("codex");
    expect(forwardedArgs.run_tests).toBe(false);
    expect(result.mode).toBe("council");

    const printed = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/aog_council.*deprecated/);
    expect(printed).toMatch(/Removed in v2\.1\.0/);
  });

  it("emits the deprecation notice only once across multiple calls", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    await forwardDeprecatedCouncil({ task: "first" }, fakeAgentManager, fakeWorktreeManager);
    await forwardDeprecatedCouncil({ task: "second" }, fakeAgentManager, fakeWorktreeManager);
    await forwardDeprecatedCouncil({ task: "third" }, fakeAgentManager, fakeWorktreeManager);

    const matchingNotices = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /aog_council.*deprecated/.test(m));
    expect(matchingNotices.length).toBe(1);
    expect(mockBuild).toHaveBeenCalledTimes(3);
  });
});
