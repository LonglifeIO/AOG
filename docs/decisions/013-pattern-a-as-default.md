# ADR-013: Pattern A as Default — Council on Every Task

## Status: Accepted (2026-05-09)

Supersedes parts of ADR-012 (tool layout, default agent counts). The
template-cleanup, hang-fix, and synthesize-fail-on-empty-research sections
of ADR-012 still stand.

## Decisions (Locked)

The following resolve §(g) Open Questions and add three implementation
requirements not in the original draft.

1. **Versioning: v2.0.0.** The default-behavior change for three tools
   is a breaking change at the cost/latency level; major bump is the
   honest signal. v2.0.0 also drops the legacy `council_*` aliases
   carried from ADR-012, unblocking that timeline. v2.1.0 drops the
   `aog_council` deprecation alias.
2. **Research output: single merged file.** Each agent writes
   `research/{slug}.md` in its worktree; chairman produces one merged
   file at the same path in the project root. Per-agent variants are
   not preserved (the worktrees are torn down).
3. **Scoring weights for research/synthesize: 0/70/30** (no test
   score; review-quality 70; depth 30). Implementation marks them
   `// TODO(weights): tune after first real-world runs`.
4. **Keep the `research-synthesis` pipeline template.** Reposition it
   in the README as the customization surface (approval gate, custom
   stages); `then_build: true` is the simple shortcut for the 90%
   case.
5. **`defaults.mode` config knob ships in v2.0.0.** Users can set
   `defaults.mode: solo` in `aog.config.yaml` to flip the global
   default. Per-call `mode:` overrides config.
6. **`use_worktree: false` in council mode is force-overridden to
   true** with a one-time stderr notice. Documented in
   `docs/routing.md` as a known constraint.
7. **`run_tests` auto-detects.** Default `true` if `package.json`
   exists in the project root; default `false` otherwise. Explicit
   per-call override always wins.
8. **(NEW) Partial-failure semantics.** When 1 of N council agents
   fails (rate limit, auth, timeout) mid-run, AOG continues with
   survivors. The response carries `participated: [...]` and
   `failed: [...]`. Hard-error only if 0 agents complete successfully.
   Council degrades 3→2 gracefully without user intervention.
9. **(NEW) Empty-repo edge case: fail-fast.** Council mode requires
   `git worktree add`, which fails on empty repos. Before any spawn,
   AOG verifies the project is a git repo with at least one commit.
   Clear error if not: "Repository at {cwd} has no commits. AOG
   council mode uses git worktrees, which require at least one
   commit. Stage and commit something first." Solo mode has no such
   requirement.
10. **(NEW) Default response observability.** Council responses for
    `aog_build`, `aog_research`, and `aog_synthesize` include
    `chairman: <agent>`, `participated: [<agents>]`, `failed:
    [<agents>]`, and (for build) `merged_from: { file: agent }` so
    the council story is visible without an extra `aog_status` call.

## Context

AOG's value proposition is **multi-agent council** — Claude, Codex, and
Gemini independently work the same problem, then cross-review and
synthesize. The README's tagline says exactly this. But the *defaults*
ship the opposite: `aog_build`, `aog_research`, and `aog_synthesize` are
all single-agent today, and council is opt-in via a separate
`aog_council` tool. The marquee feature is hidden behind a sibling tool
nobody calls by default.

This ADR flips it. Council becomes the default of `aog_build`,
`aog_research`, and `aog_synthesize`. Solo (single-agent) becomes a cost
escape hatch via a `mode: "solo"` parameter. `aog_council` becomes a
deprecated alias.

Out of scope: **Pattern B** (task decomposition with per-agent role
specialization — Claude plans, Codex implements, Gemini reviews). That's
a v2 project. No hooks for it in this ADR.

## (a) Coupling Problems in the Current Design

1. **Council is a sibling tool, not the default behavior.**
   `src/server.ts:194-205` registers `aog_build` as "the minimal default"
   that runs one agent. `src/server.ts:233-247` registers `aog_council`
   as a separate tool that the user has to know to call. The product's
   main differentiator requires opt-in by tool name.

2. **`aog_build` is just a thin wrapper around single-agent delegation.**
   `src/tools/build.ts:31-47` forwards every call to `handleDelegate`,
   which routes to one agent via `routeTask` (`src/tools/delegate.ts:38-40`).
   There is no path through `handleBuild` that fans out.

3. **Council guardrails are private to fan-out.** `wrapCouncilPrompt`
   lives in `src/council/fanout.ts:130-155` as a non-exported helper.
   The "implement only — do not research" constraint and the auto-attach
   of `docs/IMPLEMENTATION-PLAN.md` and `research/` only apply when the
   call enters through `handleCouncil → fanOut`. Any other entry point
   (e.g., `aog_synthesize` chaining into a build) silently loses the
   guardrails.

4. **Routing returns one agent, not a set.** `src/router/index.ts:26-32`
   returns a single `AgentId` per `TaskType`. There is no "all
   available" mode in the router; the council path bypasses the router
   entirely (`src/tools/council.ts:35` uses `agentManager.getAvailableAgents()`).
   The two paths are wired separately and don't share defaults.

5. **Per-tool single-agent defaults conflict with the council-first
   premise.** `src/tools/research.ts:41` defaults to `gemini → claude`.
   `src/tools/synthesize.ts:74` defaults to `claude` (and errors if
   missing). Each tool's "default agent" decision is hardcoded to a
   single CLI; there is no mechanism to express "use whoever's
   available, and merge."

6. **Council requires ≥2 CLIs and errors otherwise.**
   `src/tools/council.ts:36-40` throws `"Council mode requires at least
   2 agents"` if only one CLI is installed. A single-CLI user gets a
   hard wall instead of a graceful degradation.

7. **Chairman default is positional, not principled.**
   `src/tools/council.ts:42` uses `args.chairman ?? agents[0]`. If
   `agents` is `[codex, gemini, claude]`, the chairman is Codex — not
   Claude. The READMEs and routing doc both claim "default chairman:
   Claude," but the code's behavior depends on iteration order.

8. **Synthesis scoring is build-specific.**
   `src/council/synthesis.ts:115-166` weights 50% test pass,
   30% review, 20% impact (LOC). For research and synthesize council
   runs there are no tests and "impact" doesn't mean LOC. The current
   pipeline can't score non-code outputs without changes.

9. **`aog_council` carries dead schema.** `council_mode:
   "hierarchical" | "equal" | "user-chairman"` is declared at
   `src/server.ts:127-129` but never read by `handleCouncil`. Migrating
   this tool's surface area is an opportunity to drop dead params.

10. **README and CLAUDE.md framing is stale.** `CLAUDE.md:23-29` calls
    out three modes — DELEGATE / COUNCIL / PIPELINE — which positions
    council as one of three peers. Under the new design, council is the
    default substrate of `aog_build`/`aog_research`/`aog_synthesize`,
    not a peer.

## (b) Proposed Tool Signatures

### `aog_build`

```ts
{
  // Task input (one required)
  task?: string,
  task_file?: string,

  // Mode selection
  mode?: "council" | "solo",         // default: "council"

  // Council params (used when mode="council"; ignored otherwise)
  agents?: AgentId[],                // default: all available; min 2
  chairman?: AgentId | "best-scorer", // default: "claude" if available, else "best-scorer"
  synthesis_strategy?: "best-wins" | "chairman-merge" | "auto",  // default: "auto"
  run_tests?: boolean,               // default: true
  test_command?: string,             // default: "npm test"

  // Solo params (used when mode="solo"; ignored otherwise)
  agent?: AgentId,                   // force a specific CLI
  task_type?: TaskType,              // routing key; default: "IMPLEMENT"

  // Shared params
  use_worktree?: boolean,            // default: solo=false, council=true (forced)
  model?: string,
  max_turns?: number,
  max_budget_usd?: number,
  timeout?: number,
}
```

Behavior:
- `mode="council"` (default): fan out to all `agents` in parallel
  worktrees, run tests if enabled, cross-review, chairman synthesizes.
- `mode="council"` with only 1 CLI available: log one-time stderr notice
  ("Council mode requires 2+ CLIs; running solo with `<name>`"), then
  run the solo path with that CLI. Don't error.
- `mode="solo"`: route via `routeTask(task_type, available)` (existing
  behavior), single agent, optional worktree.
- In council mode, `task_type` is **ignored** for routing. All
  available CLIs run regardless of task_type.

### `aog_research`

```ts
{
  // Task input
  question?: string,
  task_file?: string,

  // Mode selection
  mode?: "council" | "solo",         // default: "council"

  // Council params
  agents?: AgentId[],                // default: all available
  chairman?: AgentId | "best-scorer", // default: "claude"
  synthesis_strategy?: "best-wins" | "chairman-merge" | "auto",

  // Solo params
  agent?: AgentId,                   // default: gemini (1M context), then claude

  // Shared
  output_path?: string,              // default: "research/{slug(question)}.md"
  scope_paths?: string[],            // path filters
  model?: string,
  max_turns?: number,
  max_budget_usd?: number,
  timeout?: number,
}
```

Council variant: each agent writes to `output_path` inside its own
worktree; chairman reads all three (anonymized), produces one merged
file at `output_path` in the project root.

### `aog_synthesize`

```ts
{
  // Inputs
  research_dir?: string,             // default: "research"
  output_path?: string,              // default: "docs/IMPLEMENTATION-PLAN.md"
  task?: string,                     // optional steering context
  task_file?: string,

  // Mode selection
  mode?: "council" | "solo",         // default: "council"

  // Council params
  agents?: AgentId[],                // default: all available
  chairman?: AgentId | "best-scorer", // default: "claude"
  synthesis_strategy?: "best-wins" | "chairman-merge" | "auto",

  // Solo params
  agent?: AgentId,                   // default: claude

  // Chaining
  then_build?: boolean,              // default: false. After plan is
                                     // written, automatically chain
                                     // into aog_build with the same
                                     // mode/agents/chairman.

  // Shared
  include_synthesis?: boolean,       // also write docs/SYNTHESIS.md (default: true)
  model?: string,
  max_turns?: number,
  max_budget_usd?: number,
  timeout?: number,
}
```

`then_build: true` semantics:
- After the synthesis council finishes and the plan file exists, AOG
  spawns a follow-up `aog_build` call with `task = "Execute the
  implementation plan in {output_path}. Build all files specified."`.
- The build phase inherits `mode`, `agents`, `chairman`,
  `synthesis_strategy` from the synthesize call (so council → council
  by default).
- Returns a combined response: `{ synthesize_task_id, build_task_id,
  status, files_changed, duration_ms, session_paths: [...] }`.
- If synthesis fails, build is skipped and the failure is returned
  unchanged.

### Council pipeline shape (per operation)

The shared "fan-out → review → synthesize" pipeline needs to know which
operation it's running because the test phase, the review prompts, and
the scoring weights differ:

| Phase | `build` | `research` | `synthesize` |
|------|---------|-----------|--------------|
| Fan-out | each agent implements in worktree | each agent writes `output_path` in worktree | each agent writes `output_path` in worktree |
| Tests | run `test_command` per worktree | skip | skip |
| Cross-review | rank correctness/readability/perf/coverage | rank evidence/clarity/coverage of question | rank feasibility/ordering/completeness |
| Synthesis scoring | 50/30/20 (test/review/impact) | 0/70/30 (review/depth) | 0/70/30 (review/depth) |
| Chairman output | merged code in winner's worktree | merged markdown at `output_path` | merged markdown at `output_path` |

This is the core implementation work. The proposal commits to the shape;
the exact ranking criteria for non-build council reviews can be tuned
during implementation.

### Shared council guardrails

`wrapCouncilPrompt` becomes operation-aware and moves out of
`fanout.ts`:

```ts
// src/council/guardrails.ts (new)
export type CouncilOperation = "build" | "research" | "synthesize";

export function wrapCouncilPrompt(opts: {
  task: string;
  operation: CouncilOperation;
  projectRoot: string;
  outputPath?: string;
}): string;
```

Constraint blocks per operation:

- **build** (existing): "Implement only. Do not research, browse, or
  write planning documents. Stay focused on the task above; another
  agent already covered upstream steps."
- **research**: "Research and write the structured markdown file. Do
  NOT modify code. Do NOT write planning documents — that's a separate
  step (`aog_synthesize`)."
- **synthesize**: "Read the research files and write the implementation
  plan. Do NOT implement code — the build step is a separate tool call.
  Use existing research as the source of truth; do not regenerate it."

The auto-attach of `docs/IMPLEMENTATION-PLAN.md` and `research/` as
read-only context applies to all three operations (build needs both,
research needs neither but should still link them if present so it
doesn't duplicate prior work, synthesize needs research/).

## (c) Migration Path

### Tool surface changes

| Today | After v1.2.0 |
|------|---------|
| `aog_build` (solo) | `aog_build` (council by default) — **breaking** |
| `aog_research` (solo, gemini) | `aog_research` (council by default) — **breaking** |
| `aog_synthesize` (solo, claude) | `aog_synthesize` (council by default) — **breaking** |
| `aog_council` (council) | `aog_council` deprecated alias → forwards to `aog_build` with `mode: "council"`. Stderr notice. Removed in v1.4.0. |
| `council_run` (legacy alias) | Continues forwarding (now to `aog_build` mode=council). Stderr notice. Removed in v1.3.0 (per ADR-012). |
| `council_delegate` (legacy alias) | Forwards to `aog_build` with `mode: "solo"` (preserves prior single-agent semantics). Stderr notice. Removed in v1.3.0. |
| `aog_pipeline` | Unchanged. |
| `aog_status` / `aog_cancel` | Unchanged. |

### Breaking changes (what existing callers see)

1. **`aog_build` defaults to council.** Callers who passed only `task`
   will now run all 3 CLIs in parallel worktrees. This is the intended
   behavior change, but it's a cost and latency change too. Mitigation:
   stderr notice on first `aog_build` call per process pointing at
   `mode: "solo"` for the prior behavior.
2. **`aog_research` and `aog_synthesize` default to council.** Same
   note: stderr-notice + `mode: "solo"` opt-out.
3. **`aog_council` calls keep working** via the alias, but the alias
   strips the dead `council_mode` parameter. No functional regression
   because `council_mode` was never wired through.
4. **Chairman default becomes principled.** Today `agents[0]` decides
   the chairman by iteration order; new behavior is "Claude if
   available, else `best-scorer`." Most users will see no change; users
   who built scripts assuming `agents[0]` was the chairman will see a
   shift in scoring narratives but no behavior break.
5. **`aog_build` in council mode forces `use_worktree: true`** even if
   the caller passed `false`. Council fundamentally requires
   per-agent isolation; we can't honor `use_worktree: false` and run
   three CLIs against the same cwd. Stderr notice on this override.

### Deprecation timeline

The user instruction says "Remove in v0.4.0." The package currently
ships at v1.1.2 (`src/server.ts:187`), and existing council_* aliases
are documented as removed in v0.3.0 (already past). I'm reading "v0.4.0"
as a slip and proposing the timeline below, anchored to current
versioning. **Confirm before merge.**

| Version | Action |
|---------|--------|
| v1.2.0 | Council-by-default ships. `aog_council` deprecated alias added. Stderr notice on first `aog_build` call. |
| v1.3.0 | Legacy `council_*` aliases (from ADR-012) removed. `aog_council` alias still present. |
| v1.4.0 | `aog_council` alias removed. |

### `aog.config.yaml` additions

Two new keys to give users a global escape hatch:

```yaml
defaults:
  mode: council          # or "solo" — flips the default for build/research/synthesize
  chairman: claude       # already exists
  pipeline: full-council # already exists
```

`defaults.mode: solo` lets cost-sensitive users (Claude Pro single-CLI,
ChatGPT Plus single-CLI) flip the global default without setting `mode`
on every call.

### What breaks for existing callers

| Caller pattern | Breaks? | Mitigation |
|----------------|---------|------------|
| `aog_build` with single CLI installed | No — auto-falls-back to solo | Stderr notice |
| `aog_build` with 2+ CLIs, expecting solo | **Yes** — now runs council | Pass `mode: "solo"` or set `defaults.mode: solo` |
| `aog_research` with `agent: "gemini"` | No — solo behavior preserved | None |
| `aog_research` with no agent param, 2+ CLIs | **Yes** — now runs council | Pass `mode: "solo"` |
| `aog_synthesize` (any) | **Yes** if 2+ CLIs | Pass `mode: "solo"` |
| `aog_council` callers | No — alias preserves behavior | Migrate to `aog_build mode="council"` before v1.4.0 |
| `council_run`/`council_delegate` callers | No — aliases preserved through v1.3.0 | Migrate per ADR-012 timeline |

## (d) Routing Doc Updates

Replacement content for `docs/routing.md`:

```markdown
# AOG Tool Routing

Quick reference for which CLI runs when. Source of truth:
`src/router/index.ts` (solo mode), `src/council/pipeline.ts` (council
mode), and the per-tool defaults in `src/tools/`.

## Default mode: council

`aog_build`, `aog_research`, and `aog_synthesize` all run council mode
by default. Council means:

- Every available CLI works the task in parallel git worktrees
- Outputs are anonymized and cross-reviewed
- A chairman synthesizes the result (default: Claude)
- Total wall time = max(individual times), not sum

Pass `mode: "solo"` on any of the three to fall back to single-agent
routing-by-strength.

## Solo-mode routing matrix

Used when `mode: "solo"` is passed. Same matrix the router has always
applied; documentation just makes its scope explicit.

| Tool | task_type | Primary | Fallback |
|------|-----------|---------|----------|
| `aog_build` | IMPLEMENT (default) | Claude | Codex |
| `aog_build` | GENERATE | Codex | Claude |
| `aog_build` | RESEARCH / REVIEW / ANALYZE | Gemini | Claude |
| `aog_build` | DEBUG / REFACTOR / MIGRATE | Claude | Codex |
| `aog_research` | (n/a) | Gemini | Claude |
| `aog_synthesize` | (n/a) | Claude | (errors if Claude not installed; pass `agent: "codex"` or `agent: "gemini"` to override) |

The arrow means fallback: AOG picks primary if installed, otherwise
fallback, otherwise whatever's available. Pass an explicit `agent` to
override.

## Council-mode behavior

| Property | Value |
|----------|-------|
| Agents | All available (or whatever you pass via `agents: [...]`) |
| Minimum agents | 2 in council mode (auto-falls-back to solo if only 1) |
| Worktrees | One per agent, run in parallel; forced on |
| `task_type` | **Ignored** — all CLIs run regardless |
| Default chairman | Claude (if available); else `best-scorer` |
| Chairman options | `claude` / `codex` / `gemini` / `best-scorer` |
| Synthesis strategies | `best-wins`, `chairman-merge`, or `auto` (default — strategy decided by score margin) |
| Tests | Run per worktree for `aog_build`. Skipped for `aog_research` / `aog_synthesize`. |
| Operation guardrails | Built-in per operation: build = "implement only," research = "no code edits," synthesize = "no implementation." |
| Auto-attached context | `docs/IMPLEMENTATION-PLAN.md`, `research/` if they exist (read-only) |

## Single-CLI users

If only one CLI is installed and authenticated, council mode silently
falls back to solo with a one-time stderr notice:

```
[aog] Council mode requires 2+ CLIs; running solo with claude.
```

| You have | What you get |
|----------|--------------|
| Claude only | All tools work in solo with Claude. Council auto-degrades. |
| Codex only | All tools work in solo with Codex (override `aog_synthesize`'s default with `agent: "codex"`). Council auto-degrades. |
| Gemini only | Same as Codex. Council auto-degrades. |
| Any 2 of 3 | Council runs with those 2. |
| All 3 | Council runs with all 3. |

## Pipelines

`aog_pipeline` runs YAML-defined multi-stage workflows. Routing per
stage is defined in the template — see `templates/` and
`src/pipeline/templates.ts`. This is the escape hatch for power users
who want approval gates, conditional stages, or custom per-stage agent
selection.
```

## (e) README Changes

The current README does not have a literal "Three Modes" section, but
its **Tools** table (lines 122-133) and **Routing for `aog_build`**
section (lines 146-156) implicitly carry the old framing — `aog_build`
described as "One agent does the task. The default," with `aog_council`
described as the multi-agent variant for "high-stakes work." That
positioning is wrong under the new design.

`CLAUDE.md:23-29` does call out three modes (DELEGATE / COUNCIL /
PIPELINE) and **does** need a literal section replacement.

### Proposed README replacement: "Tools" section

Replace the `Tools` table and the paragraph above it (current lines
120-145) with:

```markdown
## How AOG Works

AOG runs every task as a **council** by default. You ask once; every
available CLI works the problem in parallel git worktrees; outputs are
anonymized and cross-reviewed; a chairman (Claude by default) merges
the best of each into a single result. Three opinions, one call.

When you want a single agent for cost or speed, pass `mode: "solo"` and
AOG routes by task type. When you want multi-stage workflows with
approval gates, use `aog_pipeline`.

## Tools

| Tool | What it does | Default behavior |
|------|--------------|------------------|
| `aog_build` | Implement / fix / refactor a task | Council on every call. `mode: "solo"` for single-agent. |
| `aog_research` | Investigate a question, write structured findings | Council. Output: `research/{slug}.md`. |
| `aog_synthesize` | Turn research into an implementation plan | Council. Output: `docs/IMPLEMENTATION-PLAN.md`. Pass `then_build: true` to chain into `aog_build`. |
| `aog_pipeline` | Multi-stage YAML workflow | Per-template. For approval gates, conditional stages. |
| `aog_status` | Inspect a session | Returns progress, diffs, reviews. |
| `aog_cancel` | Stop a session | Terminates agents and removes worktrees. |
| `aog_council` | **Deprecated alias** | Forwards to `aog_build mode="council"`. Removed in v1.4.0. |

### Operations are independent

Research, synthesize, and build are separate calls. The MCP client
chains them — there's no forced pipeline. For from-scratch work,
`aog_research` → `aog_synthesize` → `aog_build` works as three explicit
calls. To shortcut the latter two, pass `then_build: true` to
`aog_synthesize`.

### Single-agent escape hatch

`mode: "solo"` runs one CLI with the existing routing-by-strength matrix:

| Tool | task_type | Routes to |
|------|-----------|-----------|
| `aog_build` | IMPLEMENT (default) | Claude |
| `aog_build` | GENERATE | Codex |
| `aog_build` | RESEARCH / REVIEW / ANALYZE | Gemini |
| `aog_build` | DEBUG / REFACTOR / MIGRATE | Claude |
| `aog_research` | (n/a) | Gemini |
| `aog_synthesize` | (n/a) | Claude |

See `docs/routing.md` for the full table including fallbacks.

### Single-CLI users

If only one CLI is installed, council mode silently falls back to solo
and prints a one-time stderr notice. Every tool works with any subset
of CLIs.
```

### Proposed CLAUDE.md replacement: "Three Execution Modes"

Replace `CLAUDE.md:21-29`:

```markdown
## Default behavior: council on every task

`aog_build`, `aog_research`, and `aog_synthesize` all run as a council
by default: every available CLI works the same task in parallel git
worktrees, outputs are anonymized and cross-reviewed, and a chairman
(Claude by default) synthesizes the result.

## Two escape hatches

- **`mode: "solo"`** — single-agent routing-by-strength. Cost or speed
  escape for trivial tasks. AOG picks the CLI best suited to the
  `task_type`.
- **`aog_pipeline`** — multi-stage YAML workflow with custom stages,
  approval gates, and per-stage agent selection.

## Single-CLI graceful fallback

If only one CLI is installed and authenticated, council mode silently
falls back to solo with a one-time stderr notice. AOG works with any
subset of CLIs.
```

## (f) Test Plan

Smoke tests for each tool in both modes plus the single-CLI fallback.
Each test asserts side effects (files written, branches created,
session JSON shape).

### `aog_build`

1. **B1 — council, all 3 CLIs.** Pre-condition: claude/codex/gemini all
   installed. Call `aog_build` with `task` only. Expect: 3 worktrees
   created, all 3 spawn in parallel, cross-review session step emitted,
   chairman synthesizes, response includes `files_changed` and
   `session_path`.
2. **B2 — solo, default task_type.** Call with `mode: "solo"`. Expect:
   Claude is selected (IMPLEMENT default), no worktree unless requested,
   single agent in session JSON.
3. **B3 — solo with `task_type: GENERATE`.** Expect Codex selected.
4. **B4 — council, single CLI installed.** Mock `getAvailableAgents` to
   return `["claude"]`. Call without `mode`. Expect: stderr notice
   emitted exactly once per process, falls back to solo with Claude,
   response shape matches solo.
5. **B5 — council, `agents: ["claude"]` explicitly.** Same fallback to
   solo with notice.
6. **B6 — council, `agents: ["claude", "codex"]`.** Expect: 2-agent
   council runs, no fallback notice, chairman defaults to Claude.

### `aog_research`

7. **R1 — council, all 3 CLIs.** Each agent writes `research/{slug}.md`
   in its own worktree. Chairman produces final merged
   `research/{slug}.md` in project root. Verify file content is the
   chairman's output.
8. **R2 — solo, default agent.** Gemini selected. Single
   `research/{slug}.md` written.
9. **R3 — solo, only Claude installed.** Pass `mode: "solo"`. Claude
   used (Gemini fallback path).
10. **R4 — council, only Codex installed.** Council auto-degrades to
    solo with Codex. Stderr notice. File written.
11. **R5 — council, custom `output_path`.** All agents and chairman
    respect the path.

### `aog_synthesize`

12. **S1 — council with populated `research/`.** Each agent writes
    `docs/IMPLEMENTATION-PLAN.md` in its worktree, chairman merges.
13. **S2 — solo, default agent.** Claude used.
14. **S3 — solo, missing `research/`.** Returns the structured error
    (`MissingResearch`) — no spawn happens.
15. **S4 — council, single CLI installed.** Falls back to solo, notice
    emitted, plan written.
16. **S5 — `then_build: true`, council both phases.** Synthesis council
    completes, plan written, build council runs immediately, response
    includes both `synthesize_task_id` and `build_task_id`.
17. **S6 — `then_build: true`, synthesize fails.** Build is skipped,
    response surfaces the synthesize failure unchanged.
18. **S7 — `then_build: true`, `mode: "solo"`.** Both phases run solo.

### Council guardrails

19. **G1 — build council.** Inspect the prompt sent to each agent
    (`session.json` records). Assert it contains the build constraint
    block ("Implement only…").
20. **G2 — research council.** Assert it contains the research
    constraint block ("Research and write the file. Do NOT modify
    code…").
21. **G3 — synthesize council.** Assert it contains the synthesize
    constraint block.
22. **G4 — auto-attach.** Place a stub `docs/IMPLEMENTATION-PLAN.md` and
    `research/sample.md` in the project. Run a build council. Assert
    both paths appear in the prompt's "Available context (read-only)"
    section.

### `aog_council` deprecation alias

23. **D1 — call `aog_council`.** Stderr notice emitted once per process.
    Same response shape as `aog_build mode="council"`. Confirm the dead
    `council_mode` parameter is silently ignored without errors.

### `task_type` interaction

24. **T1 — council mode, `task_type: GENERATE`.** Confirm all available
    CLIs run (not just Codex). The `task_type` is recorded in the
    session JSON for documentation but doesn't affect routing.
25. **T2 — solo mode, `task_type: GENERATE`.** Codex is selected.

### `defaults.mode` config

26. **C1 — `aog.config.yaml` with `defaults.mode: solo`.** Call
    `aog_build` without `mode` argument. Expect solo behavior.
27. **C2 — same config, explicit `mode: "council"`.** Council overrides
    config default.

## Out of Scope

- **Pattern B** — task decomposition with per-agent role specialization
  (Claude plans, Codex implements, Gemini reviews). Separate v2
  project. No hooks, no schema reservations, no comments referencing
  it in the new code paths.
- **The hang fix from ADR-012 §(c).** Still valid, still needed,
  tracked there. Not part of this ADR's implementation surface.
- **Template cleanup from ADR-012 §(b) "Template cleanup."** Already
  underway (commit `7ca26c1` and the deletion of `templates/*.yaml` in
  the working tree). Not part of this ADR.
- **Score weighting tuning for non-build council.** This ADR commits to
  the *shape* (no test score for research/synthesize) but leaves the
  exact weights tunable during implementation.

## Open Questions / Decisions Needed

1. **Deprecation timeline anchor.** Instruction says "v0.4.0," but the
   package is at v1.1.2 and the prior `council_*` aliases are
   documented as removed in v0.3.0 (already past). I'm proposing
   v1.2.0 (this change) → v1.3.0 (drop legacy `council_*` aliases) →
   v1.4.0 (drop `aog_council` alias). Confirm or specify the actual
   version numbers.
2. **`aog_research` council output convention.** Two options:
   (a) **Single merged file.** Each agent writes
   `research/{slug}.md` in its worktree; chairman produces one merged
   `research/{slug}.md` in project root. **Recommended** — matches
   `aog_build`'s "one final result" mental model.
   (b) **Per-agent files plus index.** Agents write
   `research/{slug}.{agent}.md`; chairman writes `research/{slug}.md`
   that summarizes/cross-references all three. More transparent but
   produces 4 files for one call.
3. **Synthesis scoring weights for non-build council.** Proposed
   0/70/30 (review/depth) for research and synthesize; the original
   50/30/20 (test/review/impact) keeps for build. Confirm or
   re-weight.
4. **`research-synthesis` pipeline template.** With `then_build: true`
   on `aog_synthesize`, the existing `research-synthesis` template is
   redundant. Options: (a) delete it (consistent with the per-call
   model); (b) keep it as a "still works for advanced users" escape;
   (c) deprecate with stderr notice and remove in v1.4.0. Lean toward
   (c).
5. **`aog.config.yaml`'s `defaults.mode`.** Worth shipping in v1.2.0
   alongside the council-by-default flip, or defer to v1.3.0?
   Recommend ship together — gives single-CLI users / Claude-Pro-only
   users a clean global flag from day one.
6. **`aog_build` `use_worktree: false` in council mode.** Council
   needs worktrees. Options: (a) silently force `true` with a stderr
   notice (proposed), (b) hard-error, (c) accept and run all 3 CLIs in
   the same cwd (will conflict — bad). Pick (a).
7. **`run_tests` semantics on `aog_build` council with no test
   command.** Currently `args.run_tests !== false` always runs
   `npm test`. For users without an npm project this is noisy. Should
   we default to `false` when no `package.json` is present? Or keep the
   current eager-default behavior and let users opt out per call?
   Lean toward auto-detect.

## Consequences

**Enables:** the project's marquee feature is now the default, which
matches the README's existing tagline. Single-CLI users see graceful
degradation instead of a wall. Synthesize-and-build chaining via
`then_build` collapses the 90% case to one call. Council guardrails
apply uniformly across all three operations.

**Limits:** every default call now uses 2-3× the tokens of a solo call.
Users on token-constrained plans must learn `mode: "solo"` or set
`defaults.mode: solo`. Wall-time goes up modestly (council runs at
max(individual times), so the slowest CLI sets the floor — typically
30-90s longer than the solo equivalent). The chairman synthesis adds
one extra spawn even on clear-winner runs (mitigated by `best-wins`
strategy when scores are uneven).

**Implementation surface:** new shared `src/council/pipeline.ts` and
`src/council/guardrails.ts`. Refactor of `src/tools/build.ts`,
`src/tools/research.ts`, `src/tools/synthesize.ts` to delegate council
runs to the shared pipeline. Drop `src/tools/council.ts` (move logic
into shared pipeline). Update `src/server.ts` to register the
`aog_council` deprecation alias and remove the now-redundant `aog_council`
schema's `council_mode` field. Update `src/router/index.ts` (no
behavior change but a new comment scoping it to solo mode). Update
`src/agents/manager.ts` if needed for the chairman-default ("Claude if
available, else best-scorer") logic, or surface that policy in the
shared pipeline.

**Estimated diff size:** ~900-1200 lines of TS changed across ~10
files; new tests for ~27 scenarios; doc updates for README, CLAUDE.md,
docs/routing.md, plus this ADR.
