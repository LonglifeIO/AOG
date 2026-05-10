# ADR-014: Council Information Fidelity

## Status: Proposed (2026-05-09)

Three bugs found during the v2.0.0 release-validation run (session
`c6104ff8`, comparing solo vs. council on a maze-app spec) collapse
council mode to "best-wins by alphabetical tiebreak." The 7-minute
council run produced what solo Claude produces in ~2 minutes — the
extra agents never affected the output.

This ADR proposes the minimal fixes. Out of scope: progress visibility
(Claude Code's `claude/channel` capability) — UX issue, separate ADR.

## Decisions (Locked, pending implementation approval)

1. **Cross-review receives full anonymized diffs**, not diffstats. Plus
   test results when present.
2. **Chairman merge receives full file contents** for each file each
   rival changed (not diffs, not truncated).
3. **Gemini spawner passes `--skip-trust`** when permission bypass is
   on. Without it, gemini headless writes silently fail in untrusted
   worktrees.
4. **Per-CLI instruction-file scaffolding is removed.** It duplicates
   the prompt, pollutes diffs with files no agent wrote, and made the
   bug-3 diagnosis harder.
5. **Failed-agent error text is persisted** to the session JSON. We
   currently throw it away.
6. **Three new prompt-content tests + one real-gemini integration test**
   added. The current 44-test suite is fully mocked at `agentManager.spawn`
   and asserts orchestration but never the prompt body — every bug
   below would still pass it.

## Bug 1: Cross-review is blind

### Root cause

`src/council/review.ts:60` — for the `build` operation, the per-implementation
payload is built via `anonymizedDiffStat`, which produces only the file
list and `+/-` line counts:

```
## Implementation Alpha
 CLAUDE.md  |  35 ++++
 index.html | 665 ++++++…+
 2 files changed, 700 insertions(+)
```

The review prompt at `src/council/review.ts:105-126` then asks reviewers
to "rank each on correctness, readability, performance, and
test_coverage (1-10)." Reviewers correctly answered they couldn't:
every review in `c6104ff8.json` returned `summary: "cannot assess
actual code quality from diffstat alone"` and the parser at
`src/council/review.ts:153-156` filled in defaults `5/5/5/1`.

The score function at `src/council/synthesis.ts:296-304` then averages
identical defaults across all implementations, producing identical
review scores. Combined with identical test scores (no `package.json`
in the test repo, so tests skipped — both got the 25-point
no-test-results fallback at `src/council/synthesis.ts:288`) and
identical impact bands (both diffs > 500 lines → 10 points), the
council tied at **50/50**. Tiebreak in `scoreImplementations` is array
order, which iterates `Object.entries(implementations)` — alphabetical
in v8 — so claude wins.

The whole review apparatus is decorative.

### Fix

In `src/council/review.ts`:

- Line 60: replace `anonymizedDiffStat(...)` with `anonymizedDiff(...)`.
  `anonymizedDiff` already exists at `src/worktree/diff.ts:53` —
  identical signature, returns the full diff with agent names stripped
  and wrapped in a fenced ` ```diff ` block.
- Line 9: drop the `MAX_CONTENT_CHARS = 6000` cap for build (research
  and synthesize markdown can keep an upper bound only as a
  context-window safety net — propose 200 KB, well above any real
  research doc).
- Line 122-125: extend the review prompt to include a `## Test
  results` block per implementation when `impl.testResults` is
  populated (passed/failed + first 1 KB of stderr on failure).
- No changes to `parseReviewOutput` — the JSON shape stays the same.

### Why this works

Reviewers get the actual code. They produce real rankings. Score
function gets real signal. Ties become rare and meaningful.

Wall-time impact: zero — same CLI spawn, larger prompt.

Token impact: not a constraint per session brief. Diffs in the
representative run were ~22 KB each; three implementations × ~22 KB =
~66 KB into a 200K/1M context window.

## Bug 2: Chairman merge truncates rival diffs to 3 KB

### Root cause

`src/council/synthesis.ts:354`:

```ts
prompt += `Key changes (truncated):\n\`\`\`diff\n${
  sanitizeInterAgentOutput(impl.diff.slice(0, 3000))
}\n\`\`\`\n\n`;
```

Real diffs in the run were 22 KB (claude) and 23 KB (codex). The
chairman saw the first ~14% of each rival, then ran in claude's
worktree where claude's `index.html` was already present. With
fragments of rival work and a complete copy of its own base, the
chairman did the rational thing: nothing. `merged_from: { "index.html":
"claude" }` — claude's 665-line file shipped unchanged, codex's 713
lines were discarded.

The build-merge prompt at `src/council/synthesis.ts:338-359` is the
only place the chairman sees rival content. There is no second pass.

### Fix

Replace `buildBuildMergePrompt` with a version that, for each rival,
reads the full content of every file the rival changed from the rival's
worktree (worktrees are still alive at synthesis time — they're torn
down in the `finally` of `runCouncilPipeline`).

New shape:

```
Merge the best parts of N implementations. You're in the winner's worktree.

Scores: claude=50, codex=50

### codex (50) — final files:

#### index.html (713 lines)
<full file content>

#### AGENTS.md (35 lines)
<full file content>

---

(repeat per rival)

You have the winner's version of each file in your worktree (read it
directly). Compare with the rival versions above. Write a synthesized
final version of any file where a rival has clearly better ideas.
```

### Decision: full file contents over full diffs

Both options were considered (no truncation, just choice of representation):

| | Full diffs | **Full file contents** |
|---|---|---|
| Greenfield (new file) | Identical to file content with `+` prefix | Same content, no prefix noise |
| Modification (small change to large file) | Tighter — shows only the change | Verbose — repeats unchanged regions |
| Chairman mental model | "Apply patch in head, then synthesize" | "Compare versions side by side, write best" |
| Match to chairman's actual job | Diff = review unit; merge ≠ review | File = merge unit; matches the deliverable |
| Recovery from divergent structure | Hard — diff doesn't show the whole architecture | Trivial — full structure visible |

**Pick: full file contents.** The chairman is producing a final file,
not approving/rejecting hunks. Synthesizing from three complete
candidates is closer to how a senior engineer actually merges
competing implementations. For greenfield work (the common council
case — agents start from scratch), the size is identical. For
modifications, the slightly larger payload is irrelevant under the
session brief's "context window is the only bound."

The chairman already has the winner's file at hand via the filesystem
(it's in its own worktree). We give it the rival files explicitly in
the prompt rather than asking it to read across worktrees, because
prompt content is more reliably consumed than tool-driven cross-tree
reads.

### Why this works

Chairman has all candidates in full. It can write a real merged file.

Wall-time impact: zero — same single chairman spawn, larger prompt.

## Bug 3: Gemini fails silently

### Root cause

The headline symptom (gemini produced only `.gemini/GEMINI.md`, no
`index.html`) had two parts:

**Part A — the actual failure (verified directly):** Gemini CLI requires
explicit workspace trust to use file-write tools in headless mode.
`--yolo` alone is **not sufficient.** Reproduced in `/tmp/gemini-trust-test`:

```
$ gemini -p "Write hello world to test.txt" --output-format json --yolo
YOLO mode is enabled. All tool calls will be automatically approved.
Approval mode overridden to "default" because the current folder is not trusted.
Gemini CLI is not running in a trusted directory. To proceed, either use
`--skip-trust`, set the `GEMINI_CLI_TRUST_WORKSPACE=true` environment
variable, or trust this directory in interactive mode.
```

`src/agents/gemini.ts:70-82` — `buildArgs` adds `--yolo` when permission
bypass is on but never passes `--skip-trust`. Worktrees in `.worktrees/`
are fresh git directories, never trusted. Result: gemini downgrades
approval-mode to "default," can't prompt (no TTY), exits non-zero. We
catch the throw at `src/agents/gemini.ts:51-60`, return `status:
"failed"`, and the error message disappears (see Part C below).

**Part B — the misleading evidence:** The `.gemini/GEMINI.md` file in
gemini's diff was *not* written by gemini. It was written by AOG
**before gemini spawned**, by `writeWorkerInstructions`
(`src/dispatch/instructions.ts:21-35`):

```ts
const INSTRUCTION_FILES: Record<AgentId, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: ".gemini/GEMINI.md",
};
```

`extractChanges` (`src/worktree/diff.ts:17`) does `git add -A` and
commits everything in the worktree. So the pre-written instruction
file ends up in the diff, looking exactly like a gemini-authored
deliverable. This made the initial diagnosis ("gemini wrote the wrong
file") wrong; the correct diagnosis is "gemini wrote nothing, and the
instruction file we wrote for it got swept into its diff."

The same noise affects claude (CLAUDE.md) and codex (AGENTS.md) — visible in
their diffSummaries from the same run.

**Part C — the silent part:** `src/tools/build.ts:124-132` saves only
`status, branch, diff, diffSummary, testResults` per implementation in
the session JSON. The agent's `result` text — which for gemini contained
the trust error — is dropped. Next time, we'll be just as blind.

### Fix

**Primary (Part A — restore gemini functionality):**
`src/agents/gemini.ts:73` — when `allowPermissionBypass` is true, push
`--skip-trust` alongside `--yolo`. One-line change. (Alternative: set
`GEMINI_CLI_TRUST_WORKSPACE=true` in the env at line 45-46. The flag
is more explicit and grep-able; prefer the flag.)

**Secondary (Part C — never lose the error again):**
`src/tools/build.ts:122-134` — extend the persisted-implementation
record with `result_excerpt` (first 2 KB of `impl.result` when
`status !== "completed"`). One field, ~3 lines.

**Tertiary (Part B — kill the instruction-file scaffolding):**

Decision was framed as "remove vs. unify." Pick **remove** because:

- The task is already in the `-p` prompt for every spawn
  (`src/council/fanout.ts:78-83`, then `src/council/fanout.ts:96`).
  The instruction file is a verbatim duplicate.
- The files pollute every council diff with non-deliverable content
  (CLAUDE.md, AGENTS.md, .gemini/GEMINI.md show up as if the agent
  wrote them).
- "Unify" would require choosing a path the *worktree's* CLI
  auto-loads, which is by definition CLI-specific — there's no
  unification, only choice of which CLI to hold to a different file
  path. Each CLI's auto-load path is fixed by that CLI's contract.
- The original intent (give workers persistent context across
  multiple-turn runs) doesn't apply to AOG: spawns are single-shot,
  worktrees are torn down in `runCouncilPipeline`'s `finally`. There's
  no "next turn" to carry context to.

Concrete change:

- Delete `writeWorkerInstructions` and `INSTRUCTION_FILES` from
  `src/dispatch/instructions.ts`.
- Delete the call at `src/dispatch/environment.ts:40`.
- Keep `readProjectInstructions` (it reads existing project-level
  CLAUDE.md/AGENTS.md/GEMINI.md from the user's repo root for context
  inclusion — different concern, not noise).
- Worktree creation (`src/worktree/manager.ts:67-78`) still calls
  `setupWorkerEnvironment` for skills installation and the read-only
  context plumbing.

### Why this works

Gemini gets `--skip-trust` and writes files normally. When any future
CLI fails, its error survives in the session JSON. Diffs contain only
what agents actually wrote, so the next time we compare implementations
the only files in the diffSummary are real deliverables.

Wall-time impact: zero (the gemini fix is one CLI flag; the other two
are after-the-fact persistence and pre-spawn file removal).

## Test plan — the 44 mocked tests are not enough

The current suite at `src/__tests__/` mocks `agentManager.spawn` and
`runCouncilPipeline` at the boundary. Every bug in this ADR would pass
that suite because none of them touches the mocked layer's contract —
they're all about *what we put inside the prompt body* and *what flag
strings we pass to which binary*.

Three new test classes cover this. None require the council to actually
run end-to-end; the first two intercept the spawn boundary and inspect
the prompt argument, the third spawns a real CLI in a worktree.

**T1 — bug 1: review prompts contain diffs.** New file
`src/__tests__/review-prompt.test.ts`. Spy on `agentManager.spawn`
inside `crossReview`, capture the `prompt` argument for each reviewer
spawn, assert:
- prompt contains the substring `"```diff"` for build operations
- prompt contains a recognizable diff hunk header (`@@ -`)
- prompt does NOT contain only the diffstat-summary line `"files changed,"`
  on its own (regression assertion against the v2.0.0 shape)
- when `impl.testResults` is set, prompt contains `"## Test results"`

**T2 — bug 2: chairman merge prompt contains full files.** New file
`src/__tests__/chairman-merge-prompt.test.ts`. Spy on the chairman
spawn, fixture-feed two implementations with file content > 5 KB each,
assert:
- prompt contains the *full* content of each rival's changed files
  (no `"…[truncated]"` marker)
- regression assertion: prompt does NOT contain `slice(0, 3000)`-style
  3001+ characters of one implementation paired with absence of the
  rest

**T3 — bug 3: gemini args + real headless write.** Two parts:

3a (unit, runs everywhere) — `src/__tests__/gemini-args.test.ts`:
```ts
expect(spawner.buildArgs({ ..., allowPermissionBypass: true })).toContain("--skip-trust");
```

3b (integration, gated by `gemini` on PATH) —
`src/__tests__/gemini-headless.integration.test.ts`. Skip when
`which gemini` fails. Otherwise: create a temp dir, `git init`, spawn
the same args AOG produces (`-p`, `--output-format json`, `--yolo`,
`--skip-trust`), prompt = "write the literal text 'ok' to a file
called marker.txt". Assert exit 0 and that `marker.txt` exists with
content `ok`. If this passes, gemini's headless-write contract works
in a fresh worktree-equivalent. If it ever breaks, this test catches
it before the next release.

The 3b pattern (gate on CLI presence, run for real) generalizes — we
could add 3-CLI smoke tests later, but one test per CLI we're known to
have broken is the minimum bar.

## Estimated diff size

| File | Lines changed |
|---|---|
| `src/council/review.ts` | ~15 (swap helper, extend prompt, drop content cap for build) |
| `src/council/synthesis.ts` | ~40 (rewrite `buildBuildMergePrompt` to read+attach full file content per rival) |
| `src/agents/gemini.ts` | ~3 (`--skip-trust` flag) |
| `src/dispatch/instructions.ts` | ~30 deletions (drop write path + map) |
| `src/dispatch/environment.ts` | ~5 deletions (drop the call) |
| `src/tools/build.ts` | ~3 (persist `result_excerpt` for failed agents) |
| `src/__tests__/review-prompt.test.ts` | ~60 new |
| `src/__tests__/chairman-merge-prompt.test.ts` | ~60 new |
| `src/__tests__/gemini-args.test.ts` | ~30 new |
| `src/__tests__/gemini-headless.integration.test.ts` | ~50 new |
| **Total** | **~250 lines (~half new tests)** |

## Wall-time impact

**~0.** No new pipeline stages, no extra LLM round trips, no new spawns.
Each existing prompt carries more bytes:
- Reviewer prompt: ~200 B (diffstat) → ~22 KB × N (full diffs). One-time
  per reviewer per round.
- Chairman merge prompt: ~6 KB (truncated) → ~50–100 KB (full file
  contents from N–1 rivals). One-time per merge.

Both fit comfortably in 200K and 1M context windows. CLI inference time
on prompts at this size is dominated by output generation, not input
processing — observed delta on representative inputs is sub-second per
spawn. Net council wall-time should be unchanged within measurement
noise.

## Risks

- **Larger reviewer prompts may push gemini closer to its rate-limit
  cap.** Not new risk in shape, just larger payloads. Mitigation:
  partial-failure tolerance (ADR-013 §8) already handles the case
  where one council agent goes down.
- **Removing the per-CLI instruction file** removes a (currently
  unused) extension point for project-specific worker guidance. If we
  later want per-CLI worker hints, re-add deliberately rather than as
  a side-effect of `setupWorkerEnvironment`. Note in the deletion
  commit.
- **Full-file synthesis prompts will leak structural choices between
  agents to the chairman in a way the current truncated form
  obscures.** This is intentional — the whole point of council is the
  chairman seeing the full picture — but it does mean the chairman has
  more latitude to write a synthesis that resembles none of the inputs.
  Acceptable; that's the job.

## Approval gate

Stop here. Implementation begins on user "go."
