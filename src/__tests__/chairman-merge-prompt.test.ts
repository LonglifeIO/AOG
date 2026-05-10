import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentId, AgentImplementation, AgentResult } from "../agents/types.js";

// Mock readFile so we can control what the chairman prompt sees
// without setting up real worktrees. The synthesis module reads each
// rival's changed files from impl.worktreePath.
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, readFile: vi.fn() };
});

import { readFile } from "node:fs/promises";
import { synthesize } from "../council/synthesis.js";

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

// 26 KB per rival — well over the v2.0.0 3000-char truncation cap.
const LARGE_BODY = "// large file content line\n".repeat(1024);

function makeImpl(agent: AgentId, marker: string): AgentImplementation {
  return {
    agent,
    branch: `aog/${agent}/test`,
    worktreePath: `/tmp/wt-${agent}`,
    diff: `dummy diff for ${agent}`,
    diffSummary: "index.html | 1024 +++++\n 1 file changed, 1024 insertions(+)",
    testResults: null,
    exitCode: 0,
    pid: null,
    status: "completed",
    outputContent: null,
    result: marker,
  };
}

beforeEach(() => {
  mockedReadFile.mockReset();
  // Path-based file content: each worktree returns its own large file
  // with a unique end-marker so we can prove the full content survived.
  mockedReadFile.mockImplementation(async (path: string | URL) => {
    const p = String(path);
    if (p.includes("/wt-codex/")) return LARGE_BODY + "// CODEX_END_MARKER\n";
    if (p.includes("/wt-claude/")) return LARGE_BODY + "// CLAUDE_END_MARKER\n";
    if (p.includes("/wt-gemini/")) return LARGE_BODY + "// GEMINI_END_MARKER\n";
    throw new Error(`unexpected read: ${p}`);
  });
});

describe("chairman merge prompt content (ADR-014, bug 2)", () => {
  it("includes full file contents per rival without truncation", async () => {
    let chairmanPrompt = "";
    const agentManager = {
      isAvailable: (a: AgentId) => a === "claude",
      spawn: vi.fn(async (_id: AgentId, opts: { prompt: string }): Promise<AgentResult> => {
        chairmanPrompt = opts.prompt;
        return {
          taskId: "t1",
          agent: "claude",
          model: "x",
          status: "completed",
          duration_ms: 1,
          result: "",
          cost: { usd: null, tokens_in: null, tokens_out: null },
          changes: null,
          tests: null,
          session: { id: "x", resumable: false },
        };
      }),
    };

    const implementations = {
      claude: makeImpl("claude", "claude-marker"),
      codex: makeImpl("codex", "codex-marker"),
    };

    await synthesize({
      taskId: "t1",
      implementations,
      reviews: {},
      chairman: "claude",
      operation: "build",
      strategy: "chairman-merge",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentManager: agentManager as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      worktreeManager: {} as any,
    });

    // Full content from the rival reaches the chairman: end-marker
    // proves nothing was clipped before the EOF.
    expect(chairmanPrompt).toContain("// CODEX_END_MARKER");

    // No "truncated" marker — the v2.0.0 shape is gone.
    expect(chairmanPrompt).not.toContain("[truncated]");
    expect(chairmanPrompt).not.toContain("(truncated)");

    // Prompt is at least the size of one rival's full file (~26 KB),
    // proving we're not capping at the old 3000-char limit.
    expect(chairmanPrompt.length).toBeGreaterThan(20_000);
  });

  it("includes file content from each non-winner rival", async () => {
    let chairmanPrompt = "";
    const agentManager = {
      isAvailable: (a: AgentId) => a === "claude",
      spawn: vi.fn(async (_id: AgentId, opts: { prompt: string }): Promise<AgentResult> => {
        chairmanPrompt = opts.prompt;
        return {
          taskId: "t1",
          agent: "claude",
          model: "x",
          status: "completed",
          duration_ms: 1,
          result: "",
          cost: { usd: null, tokens_in: null, tokens_out: null },
          changes: null,
          tests: null,
          session: { id: "x", resumable: false },
        };
      }),
    };

    const implementations = {
      claude: makeImpl("claude", "claude-marker"),
      codex: makeImpl("codex", "codex-marker"),
      gemini: makeImpl("gemini", "gemini-marker"),
    };

    await synthesize({
      taskId: "t1",
      implementations,
      reviews: {},
      chairman: "claude",
      operation: "build",
      strategy: "chairman-merge",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentManager: agentManager as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      worktreeManager: {} as any,
    });

    // Both non-winner rivals contribute their full files
    expect(chairmanPrompt).toContain("// CODEX_END_MARKER");
    expect(chairmanPrompt).toContain("// GEMINI_END_MARKER");
  });
});
