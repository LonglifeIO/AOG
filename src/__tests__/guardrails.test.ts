import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapCouncilPrompt } from "../council/guardrails.js";

describe("wrapCouncilPrompt — G1/G2/G3 operation-specific constraints", () => {
  it("G1: build wraps with 'implement only' constraint", () => {
    const out = wrapCouncilPrompt({
      task: "Add a rate limiter",
      operation: "build",
      projectRoot: tmpdir(),
    });
    expect(out).toContain("Add a rate limiter");
    expect(out).toContain("Implement only");
    expect(out).toContain("Do not research");
    expect(out).not.toContain("Do NOT modify code");
    expect(out).not.toContain("Do NOT implement code");
  });

  it("G2: research wraps with 'no code edits' constraint", () => {
    const out = wrapCouncilPrompt({
      task: "How does Express handle rate limits?",
      operation: "research",
      projectRoot: tmpdir(),
      outputPath: "research/express-rate-limits.md",
    });
    expect(out).toContain("Research and write");
    expect(out).toContain("research/express-rate-limits.md");
    expect(out).toContain("Do NOT modify code");
    expect(out).not.toContain("Implement only");
  });

  it("G3: synthesize wraps with 'no implementation' constraint", () => {
    const out = wrapCouncilPrompt({
      task: "Plan the migration",
      operation: "synthesize",
      projectRoot: tmpdir(),
      outputPath: "docs/IMPLEMENTATION-PLAN.md",
    });
    expect(out).toContain("Read the research files");
    expect(out).toContain("docs/IMPLEMENTATION-PLAN.md");
    expect(out).toContain("Do NOT implement code");
    expect(out).not.toContain("Implement only");
  });
});

describe("wrapCouncilPrompt — G4 auto-attach existing context", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "aog-guardrails-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("attaches plan + research/ when both present (build)", () => {
    mkdirSync(join(scratch, "docs"), { recursive: true });
    writeFileSync(join(scratch, "docs", "IMPLEMENTATION-PLAN.md"), "# plan\n");
    mkdirSync(join(scratch, "research"), { recursive: true });
    writeFileSync(join(scratch, "research", "x.md"), "# x\n");

    const out = wrapCouncilPrompt({
      task: "Build it",
      operation: "build",
      projectRoot: scratch,
    });
    expect(out).toContain("Available context (read-only)");
    expect(out).toContain("docs/IMPLEMENTATION-PLAN.md");
    expect(out).toContain("research/");
    expect(out).toContain("Do not regenerate them");
  });

  it("attaches only what exists", () => {
    mkdirSync(join(scratch, "research"), { recursive: true });
    writeFileSync(join(scratch, "research", "x.md"), "# x\n");

    const out = wrapCouncilPrompt({
      task: "Build it",
      operation: "build",
      projectRoot: scratch,
    });
    expect(out).toContain("Available context (read-only)");
    expect(out).toContain("research/");
    expect(out).not.toContain("docs/IMPLEMENTATION-PLAN.md");
  });

  it("emits no context block when neither plan nor research/ exist", () => {
    const out = wrapCouncilPrompt({
      task: "Build it",
      operation: "build",
      projectRoot: scratch,
    });
    expect(out).not.toContain("Available context");
    expect(out).toContain("Implement only");
  });
});
