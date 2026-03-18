import { describe, it, expect, vi } from "vitest";
import { ProgressReporter } from "../interaction/progress.js";

describe("ProgressReporter", () => {
  it("sends MCP progress notifications with progressToken", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const reporter = new ProgressReporter({
      taskId: "test-1",
      sender,
      progressToken: "tok-123",
      totalSteps: 5,
    });

    await reporter.notify("Starting work", "setup");

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: {
        progressToken: "tok-123",
        progress: 1,
        total: 5,
        message: "Starting work",
      },
    });
  });

  it("increments step counter on each notification", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const reporter = new ProgressReporter({
      taskId: "test-2",
      sender,
      progressToken: "tok-456",
      totalSteps: 3,
    });

    await reporter.notify("Step 1");
    await reporter.notify("Step 2");
    await reporter.notify("Step 3");

    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[0][0].params.progress).toBe(1);
    expect(sender.mock.calls[1][0].params.progress).toBe(2);
    expect(sender.mock.calls[2][0].params.progress).toBe(3);
  });

  it("records history of all updates", async () => {
    const reporter = new ProgressReporter({
      taskId: "test-3",
      sender: null,
      progressToken: null,
    });

    await reporter.notify("Alpha", "setup");
    await reporter.notify("Beta", "fan-out", "claude");

    const history = reporter.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].message).toBe("Alpha");
    expect(history[0].stage).toBe("setup");
    expect(history[1].message).toBe("Beta");
    expect(history[1].agent).toBe("claude");
  });

  it("does not throw when sender is null", async () => {
    const reporter = new ProgressReporter({
      taskId: "test-4",
      sender: null,
      progressToken: null,
    });

    // Should not throw
    await reporter.notify("No sender");
    expect(reporter.getHistory()).toHaveLength(1);
  });

  it("does not throw when progressToken is null", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const reporter = new ProgressReporter({
      taskId: "test-5",
      sender,
      progressToken: null,
    });

    await reporter.notify("No token");
    // sender should NOT be called without a token
    expect(sender).not.toHaveBeenCalled();
    expect(reporter.getHistory()).toHaveLength(1);
  });

  it("does not throw when sender rejects", async () => {
    const sender = vi.fn().mockRejectedValue(new Error("transport broken"));
    const reporter = new ProgressReporter({
      taskId: "test-6",
      sender,
      progressToken: "tok-broken",
    });

    // Should not throw even if sender fails
    await reporter.notify("Should survive");
    expect(reporter.getHistory()).toHaveLength(1);
  });

  it("convenience methods send correct messages", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const reporter = new ProgressReporter({
      taskId: "test-7",
      sender,
      progressToken: "tok-conv",
      totalSteps: 10,
    });

    await reporter.councilStarted(["claude", "gemini"]);
    await reporter.worktreesCreated(["claude", "gemini"]);
    await reporter.agentSpawned("claude");
    await reporter.agentCompleted("claude", 45, 3);
    await reporter.agentFailed("gemini");
    await reporter.testsStarted();
    await reporter.testsCompleted(1, 2);
    await reporter.reviewStarted(["claude", "gemini"]);
    await reporter.reviewCompleted();
    await reporter.synthesisStarted("claude");

    expect(sender).toHaveBeenCalledTimes(10);

    const messages = sender.mock.calls.map((c: unknown[]) => (c[0] as { params: { message: string } }).params.message);
    expect(messages[0]).toContain("Council started");
    expect(messages[0]).toContain("claude");
    expect(messages[0]).toContain("gemini");
    expect(messages[1]).toContain("Worktrees created");
    expect(messages[2]).toContain("claude: implementing");
    expect(messages[3]).toContain("claude: done");
    expect(messages[3]).toContain("45s");
    expect(messages[3]).toContain("3 files");
    expect(messages[4]).toContain("gemini: failed");
    expect(messages[5]).toContain("Running tests");
    expect(messages[6]).toContain("Tests: 1/2");
    expect(messages[7]).toContain("Cross-review started");
    expect(messages[8]).toContain("Cross-review complete");
    expect(messages[9]).toContain("Chairman claude synthesizing");
  });

  it("pipeline convenience methods work", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const reporter = new ProgressReporter({
      taskId: "test-8",
      sender,
      progressToken: "tok-pipe",
    });

    await reporter.pipelineStageStarted("fan-out");
    await reporter.pipelineStageCompleted("fan-out");
    await reporter.pipelineStageFailed("test", "npm test failed");

    const messages = sender.mock.calls.map((c: unknown[]) => (c[0] as { params: { message: string } }).params.message);
    expect(messages[0]).toBe("Stage started: fan-out");
    expect(messages[1]).toBe("Stage completed: fan-out");
    expect(messages[2]).toBe("Stage failed: test — npm test failed");
  });

  it("delegate convenience methods work", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const reporter = new ProgressReporter({
      taskId: "test-9",
      sender,
      progressToken: "tok-del",
    });

    await reporter.delegateStarted("gemini");
    await reporter.delegateWorktreeCreated("gemini");

    const messages = sender.mock.calls.map((c: unknown[]) => (c[0] as { params: { message: string } }).params.message);
    expect(messages[0]).toContain("Delegating to gemini");
    expect(messages[1]).toContain("Worktree created for gemini");
  });
});
