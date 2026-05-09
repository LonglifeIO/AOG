import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { ensureCommittableRepo } from "../utils/repo.js";

describe("ensureCommittableRepo — empty-repo guard", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "aog-repo-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("rejects a non-git directory", async () => {
    await expect(ensureCommittableRepo(scratch)).rejects.toThrow(/Not a git repository/);
  });

  it("rejects a git repo with no commits", async () => {
    await execa("git", ["init"], { cwd: scratch });
    await expect(ensureCommittableRepo(scratch)).rejects.toThrow(/no commits/);
  });

  it("accepts a git repo with at least one commit", async () => {
    await execa("git", ["init"], { cwd: scratch });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: scratch });
    await execa("git", ["config", "user.name", "Test"], { cwd: scratch });
    writeFileSync(join(scratch, "README.md"), "test");
    await execa("git", ["add", "."], { cwd: scratch });
    await execa("git", ["commit", "-m", "initial"], { cwd: scratch });

    await expect(ensureCommittableRepo(scratch)).resolves.toBeUndefined();
  });
});
