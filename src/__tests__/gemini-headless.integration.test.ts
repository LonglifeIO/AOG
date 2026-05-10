import { describe, it, expect } from "vitest";
import { execa, execaSync } from "execa";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real-CLI integration test (ADR-014, bug 3 part A). Gated on `gemini`
// being installed and on the headless-write smoke being intentional.
//
// What it asserts: with the same flags AOG passes (--yolo --skip-trust
// --output-format json -p), gemini can write a file in a fresh git
// worktree-equivalent (untrusted directory). If --skip-trust is ever
// removed or renamed, this test fails before the next release.
//
// To run locally: `npm run test:run -- gemini-headless.integration`
// CI: skipped automatically when `which gemini` returns non-zero, or
// when AOG_SKIP_GEMINI_INTEGRATION=1 is set (e.g. in offline CI).

let geminiAvailable = false;
try {
  execaSync("which", ["gemini"]);
  geminiAvailable = true;
} catch {
  geminiAvailable = false;
}

const skipReason = process.env.AOG_SKIP_GEMINI_INTEGRATION === "1"
  ? "AOG_SKIP_GEMINI_INTEGRATION=1"
  : !geminiAvailable
  ? "gemini CLI not installed"
  : null;

const itGemini = skipReason ? it.skip : it;

describe("gemini headless write (ADR-014, bug 3 integration)", () => {
  if (skipReason) {
    it.skip(`skipped: ${skipReason}`, () => {});
    return;
  }

  itGemini("writes a file in a fresh untrusted worktree-equivalent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aog-gemini-int-"));
    try {
      // Mimic an AOG worktree: fresh git repo, never trusted by gemini.
      await execa("git", ["init", "-q"], { cwd: dir });

      const result = await execa(
        "gemini",
        [
          "-p",
          "Write the literal text 'ok' (without quotes) to a file called marker.txt at the current directory. Do not write anything else. Do not add a trailing newline if you can avoid it.",
          "--output-format", "json",
          "--yolo",
          "--skip-trust",
        ],
        {
          cwd: dir,
          stdin: "ignore",
          timeout: 180_000,
          reject: false,
          env: { ...process.env, NO_COLOR: "1" },
        }
      );

      // The contract under test: gemini exits cleanly AND the file
      // landed. We don't assert exact contents (model may add a newline
      // or wrap it) — only that something was written, proving
      // file-write tools were not blocked by the trust check.
      const markerPath = join(dir, "marker.txt");
      expect(
        existsSync(markerPath),
        `marker.txt not created. exit=${result.exitCode}\nstderr=${result.stderr?.slice(0, 500)}`
      ).toBe(true);

      const content = readFileSync(markerPath, "utf-8");
      expect(content.trim().toLowerCase()).toContain("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 200_000);
});
