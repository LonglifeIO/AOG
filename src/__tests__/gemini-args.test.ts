import { describe, it, expect } from "vitest";
import { GeminiSpawner } from "../agents/gemini.js";
import type { SpawnOptions } from "../agents/types.js";

const baseOptions: SpawnOptions = {
  prompt: "build something",
  cwd: "/tmp/wt",
  taskId: "t1",
};

// buildArgs is private — cast to access for unit testing.
type WithBuildArgs = { buildArgs: (o: SpawnOptions) => string[] };

describe("gemini args (ADR-014, bug 3)", () => {
  it("includes --skip-trust alongside --yolo when allowPermissionBypass is true", () => {
    const spawner = new GeminiSpawner();
    const args = (spawner as unknown as WithBuildArgs).buildArgs({
      ...baseOptions,
      allowPermissionBypass: true,
    });

    // Both flags present; without --skip-trust gemini downgrades to
    // "default" approval mode in untrusted worktrees and silently fails
    // in headless mode.
    expect(args).toContain("--yolo");
    expect(args).toContain("--skip-trust");
  });

  it("omits --skip-trust in read-only mode", () => {
    const spawner = new GeminiSpawner();
    const args = (spawner as unknown as WithBuildArgs).buildArgs({
      ...baseOptions,
      readOnly: true,
    });

    expect(args).not.toContain("--skip-trust");
    expect(args).not.toContain("--yolo");
  });

  it("omits --skip-trust when allowPermissionBypass is false", () => {
    const spawner = new GeminiSpawner();
    const args = (spawner as unknown as WithBuildArgs).buildArgs({
      ...baseOptions,
      allowPermissionBypass: false,
    });

    expect(args).not.toContain("--skip-trust");
  });
});
