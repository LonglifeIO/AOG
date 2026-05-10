import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentId, AgentImplementation, AgentResult } from "../agents/types.js";

// Mock the diff helpers BEFORE importing the SUT so the SUT picks up
// the mocks. We assert two things: the prompt contains real diff
// content (anonymizedDiff was called) AND the v2.0.0 regression shape
// — anonymizedDiffStat being called for build review — never recurs.
vi.mock("../worktree/diff.js", () => ({
  anonymizedDiff: vi.fn(),
  anonymizedDiffStat: vi.fn(),
}));

import { anonymizedDiff, anonymizedDiffStat } from "../worktree/diff.js";
import { crossReview } from "../council/review.js";

const mockedDiff = anonymizedDiff as unknown as ReturnType<typeof vi.fn>;
const mockedStat = anonymizedDiffStat as unknown as ReturnType<typeof vi.fn>;

const SAMPLE_DIFF = (label: string) =>
  `## ${label}\n\n\`\`\`diff\ndiff --git a/index.html b/index.html\n` +
  `new file mode 100644\nindex 0000000..abc1234\n--- /dev/null\n+++ b/index.html\n` +
  `@@ -0,0 +1,3 @@\n+<!doctype html>\n+<html><body>hello</body></html>\n+\n\`\`\``;

function makeImpl(agent: AgentId, overrides: Partial<AgentImplementation> = {}): AgentImplementation {
  return {
    agent,
    branch: `aog/${agent}/test`,
    worktreePath: `/tmp/wt-${agent}`,
    diff: "diff content",
    diffSummary: "index.html | 3 +++\n 1 file changed, 3 insertions(+)",
    testResults: null,
    exitCode: 0,
    pid: null,
    status: "completed",
    outputContent: null,
    ...overrides,
  };
}

function makeAgentManager(spawnedPrompts: string[]): {
  isAvailable: (a: AgentId) => boolean;
  spawn: (id: AgentId, opts: { prompt: string }) => Promise<AgentResult>;
} {
  return {
    isAvailable: () => true,
    spawn: vi.fn(async (id: AgentId, opts: { prompt: string }): Promise<AgentResult> => {
      spawnedPrompts.push(opts.prompt);
      return {
        taskId: "t1",
        agent: id,
        model: "x",
        status: "completed",
        duration_ms: 1,
        result: '{"reviews":[]}',
        cost: { usd: null, tokens_in: null, tokens_out: null },
        changes: null,
        tests: null,
        session: { id: "x", resumable: false },
      };
    }),
  };
}

beforeEach(() => {
  mockedDiff.mockReset();
  mockedStat.mockReset();
  mockedDiff.mockImplementation(async (_path: string, label: string) => SAMPLE_DIFF(label));
});

describe("review prompt content (ADR-014, bug 1)", () => {
  it("review prompts include actual diff hunks for build operation", async () => {
    const spawnedPrompts: string[] = [];
    const agentManager = makeAgentManager(spawnedPrompts);
    const implementations = {
      claude: makeImpl("claude"),
      codex: makeImpl("codex"),
    };

    await crossReview({
      taskId: "t1",
      implementations,
      agents: ["claude", "codex"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentManager: agentManager as any,
      operation: "build",
    });

    expect(spawnedPrompts.length).toBeGreaterThan(0);
    for (const prompt of spawnedPrompts) {
      // Real diff content reaches the reviewer
      expect(prompt).toContain("```diff");
      expect(prompt).toMatch(/@@\s+-\d/);
      expect(prompt).toContain("diff --git");
    }

    // Regression assertion: the v2.0.0 shape (diffstat-only) is gone.
    expect(mockedDiff).toHaveBeenCalled();
    expect(mockedStat).not.toHaveBeenCalled();
  });

  it("review prompts include test results when present", async () => {
    const spawnedPrompts: string[] = [];
    const agentManager = makeAgentManager(spawnedPrompts);
    const implementations = {
      claude: makeImpl("claude", {
        testResults: { passed: true, exit_code: 0, stdout: "ok", stderr: "" },
      }),
      codex: makeImpl("codex", {
        testResults: { passed: false, exit_code: 1, stdout: "", stderr: "TypeError: x is undefined" },
      }),
    };

    await crossReview({
      taskId: "t1",
      implementations,
      agents: ["claude", "codex"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentManager: agentManager as any,
      operation: "build",
    });

    expect(spawnedPrompts.length).toBeGreaterThan(0);
    for (const prompt of spawnedPrompts) {
      expect(prompt).toContain("## Test results");
      expect(prompt).toContain("Status: passed");
      expect(prompt).toContain("Status: failed (exit 1)");
      expect(prompt).toContain("TypeError: x is undefined");
    }
  });

  it("review prompts omit test results section when no tests ran", async () => {
    const spawnedPrompts: string[] = [];
    const agentManager = makeAgentManager(spawnedPrompts);
    const implementations = {
      claude: makeImpl("claude"),
      codex: makeImpl("codex"),
    };

    await crossReview({
      taskId: "t1",
      implementations,
      agents: ["claude", "codex"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentManager: agentManager as any,
      operation: "build",
    });

    for (const prompt of spawnedPrompts) {
      expect(prompt).not.toContain("## Test results");
    }
  });
});
