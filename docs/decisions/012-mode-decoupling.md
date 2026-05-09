# ADR-012: Decouple Research, Synthesize, and Build

## Status: Proposed

## Context

AOG today conflates three distinct operations behind a single happy-path
("synthesize research and build"). The README's onboarding example, the
`research-synthesis` pipeline, and the migration template all bundle
research → synthesize → build into one fire-and-forget call. Users who only
want to build, or only want to synthesize an existing plan, must either pick
the wrong tool (`council_delegate` is named for routing, not for "just
build") or accept the full pipeline and try to short-circuit it.

This proposal makes the three operations independently invokable, makes
`build` the default, and fixes a hang that the coupling has been masking.

## (a) Coupling Problems in the Current Architecture

1. **No "build only" tool.** `council_delegate` is the closest match but its
   name signals routing, not building. `council_run` always fans out to 2+
   agents and forces cross-review + synthesis (`src/tools/council.ts:48-106`).
   There is no minimal "do this task with one agent in a worktree" tool.

2. **No "synthesize only" path.** The `research-synthesis` template
   hard-codes four stages — `synthesize → plan → approve → build`
   (`templates/research-synthesis.yaml`). The approval gate is currently
   auto-approved (`src/pipeline/engine.ts:267-275`), so a user who wants
   only the plan gets a build whether they want it or not. There is no
   `stop_after` parameter and no way to drop the build stage without
   editing or shadowing the template.

3. **No "research only" path with structured output.**
   `council_delegate` with `task_type=RESEARCH` runs one agent and returns
   prose. There is no convention for *where* the research lands on disk,
   no slug naming, no scope parameter, no expectation that the next tool
   will be able to find it.

4. **Pipeline templates drift silently.** `loadTemplate`
   (`src/pipeline/templates.ts:87-107`) reads `templates/{name}.yaml`
   *before* falling back to `BUILT_IN_TEMPLATES`. Commit `7ca26c1`
   updated the hardcoded `migration` template to a lightweight scan, but
   `templates/migration.yaml` still contains the deep-research fan-out
   stage and silently overrides the fix. This is invisible to the user
   until they wonder why migration is still slow.

5. **YAML `flags` are not honored for `sequential` stages.** The engine
   spawns the agent with `prompt`, `cwd`, `taskId`, `timeout`, and
   `allowPermissionBypass` only (`src/pipeline/engine.ts:232-238`). The
   `flags: ["--max-turns", "30", ...]` declared in every template
   (`templates/research-synthesis.yaml:13`) never reach the CLI. This is
   a separate bug, but it falls out of the same monolithic design: the
   pipeline is the only path for these stages, so the missing wiring
   never showed up against `council_delegate`.

6. **Inconsistent `council_*` naming.** Three tools share the
   `council_` prefix, but only `council_run` is actually a council. New
   users read `council_delegate` and assume it's part of the council
   flow.

## (b) Proposed Tool & Mode Changes

### Three new top-level tools

```ts
// aog_build — the new default
{
  task: string,                 // or task_file
  task_file?: string,
  agents?: AgentId[],           // 1 = delegate; 2+ = fan-out + chairman synthesis
  use_worktree?: boolean,       // default: false; auto-true when agents.length > 1
  task_type?: TaskType,         // for routing when agents is omitted
  preferred_agent?: AgentId,
  model?: string,
  max_turns?: number,           // default: from config (claude=20)
  max_budget_usd?: number,
  timeout?: number,
}
// → Always stops after build. Never runs research or synthesis.

// aog_synthesize — research → plan, stops
{
  research_dir?: string,        // default: "research/"
  output_path?: string,         // default: "docs/IMPLEMENTATION-PLAN.md"
  task?: string,                // optional steering prompt
  task_file?: string,
  agent?: AgentId,              // default: claude
  include_synthesis?: boolean,  // also write docs/SYNTHESIS.md (default: true)
  model?: string,
  timeout?: number,
}
// → Reads research_dir, writes plan, stops. Never builds.
// → Errors (not warns) if research_dir is empty or missing.

// aog_research — explicit research with a known landing spot
{
  question: string,             // or task_file
  task_file?: string,
  agent?: AgentId,              // default: gemini (1M context)
  output_path?: string,         // default: "research/{slug(question)}.md"
  scope_paths?: string[],       // optional path filters
  model?: string,
  timeout?: number,
}
// → Single agent, structured output to a known path, stops.
```

Combinations are user-driven: the MCP client chains
`aog_research` → `aog_synthesize` → `aog_build` as separate tool calls.
This is what good MCP clients already do; we shouldn't re-invent the
pipeline for the common cases.

### Existing tools

| Tool | Disposition |
|------|------------|
| `council_delegate` | **Deprecate, alias to `aog_build`.** Schema gains a deprecation notice in its description. Remove in 0.3.0. |
| `council_run`      | **Rename to `aog_council`.** Keep `council_run` as a one-version alias. Same semantics. |
| `council_pipeline` | **Rename to `aog_pipeline`.** Keep alias. Pipelines remain the escape hatch for advanced multi-stage YAML workflows. |
| `council_status`   | Rename to `aog_status` + alias. |
| `council_cancel`   | Rename to `aog_cancel` + alias. |

### Default workflow

`aog_build` becomes the canonical entry point. The README's first example
becomes:

> "Use AOG to build a rate limiter for the API endpoints"

Instead of the current synthesize-and-build full-pipeline example. The
research-synthesis flow is documented but not the default.

### Template cleanup

- Delete `templates/research-synthesis.yaml` and
  `templates/migration.yaml`. Keep the hardcoded versions in
  `src/pipeline/templates.ts` as the single source of truth, OR keep YAML
  and delete the hardcoded duplicates. **Pick one.** The current dual
  ownership is the silent-drift bug from problem (4).
- The YAML-vs-hardcoded behavior should be: YAML in `.aog/templates/`
  (user customizations) overrides built-ins; `templates/` in the
  installed package is read-only and matches `BUILT_IN_TEMPLATES`.

## (c) The Hang Bug — Likely Cause

I could not reproduce live (no `.aog/sessions/` exists in the repo, so
either no run has completed or the dir is wiped). But code reading points
to a primary cause and two compounding factors.

**Primary: sequential stages spawn agents with no `--max-turns` cap.**
`src/pipeline/engine.ts:232-238` builds `SpawnOptions` from the stage
config but **never reads `template.agents[].flags`**. So when the build
stage of `research-synthesis` invokes Claude with the prompt
`"Execute the implementation plan in docs/IMPLEMENTATION-PLAN.md. Build
every file specified..."`, Claude runs without any iteration cap. With a
fuzzy plan or an empty `research/` (which the synthesize stage tolerates
silently), Claude can churn until the spawn timeout fires. From the MCP
client's vantage point — no progress notifications between
`stage started: build` and the eventual timeout 15 minutes later — this
is indistinguishable from a hang.

**Compounding factor 1: pipeline timeout < sum of stage timeouts.**
`research-synthesis` declares `timeout: 1800` (30 min) but stages sum to
2100s (10 + 10 + 15 min). The pipeline timeout check at
`engine.ts:64-68` runs *only at stage start*. If the first two stages
each take ~10 min, build starts with elapsed=20min, the check passes
(20 < 30), but build's own 15-min timeout outlives the pipeline budget.
The engine doesn't kill the in-flight spawn — it just sits and waits.

**Compounding factor 2: silent auto-approve.** `executeApproval`
(`engine.ts:267-275`) logs "auto-approved" to stderr and returns. There
is no progress notification, no MCP message, no signal to the client.
A user who *expected* to be prompted between `plan` and `build` will
think the pipeline has stalled at the approval gate when in fact it has
silently moved on.

**Proposed fix.**

1. In `engine.executeSequential`, parse `template.agents[i].flags` into
   structured `SpawnOptions` (`maxTurns`, `maxBudgetUsd`, `model`) and
   pass them through. Apply the same to fan-out stages
   (`council/fanout.ts` should already be doing this — verify).
2. Set a hard default of `maxTurns: 20` in `agents/manager.ts:spawn` for
   sequential pipeline stages when neither the YAML flags nor the call
   site specify one.
3. Validate `pipeline.timeout >= sum(stage.timeout)` at template-load
   time; fail loudly otherwise.
4. Move the pipeline-timeout check to a parallel timer that uses an
   `AbortSignal` to kill the in-flight spawn, not just block the next
   loop iteration.
5. Make `executeApproval` emit a progress notification
   (`progress.notify("Approval auto-approved (resume not implemented)")`)
   so the client sees the transition.
6. Make `aog_synthesize` *fail* if `research_dir` is empty or missing
   rather than silently producing a no-op SYNTHESIS.md that downstream
   tools will treat as authoritative.

Items 1–2 are the most likely fix for the user-reported hang. Items 3–4
are belt-and-suspenders. Item 5 removes the user-confusion mode. Item 6
prevents the upstream cause of fuzzy build prompts.

## (d) Migration Path

**For users who already script against AOG:**

- Existing tools (`council_delegate`, `council_run`, `council_pipeline`,
  `council_status`, `council_cancel`) keep working and route to the
  renamed implementations under the hood. They emit a one-line stderr
  deprecation notice on first call per process.
- The `research-synthesis` template still loads and runs end-to-end.
  Documentation reframes it as "the legacy bundled pipeline; prefer
  separate `aog_research` / `aog_synthesize` / `aog_build` calls."
- Removal of the deprecated names in 0.3.0 (or whichever release follows
  two minor bumps) — give external scripts a calendar quarter to
  migrate.

**For the README:**

- Replace the onboarding example "synthesize research and build a rate
  limiter" with "build a rate limiter" using `aog_build`.
- Add a short section "Three operations, three tools" with one example
  each.
- Move the research-synthesis example to a new "Bring your own research"
  section, demonstrating `aog_research` → `aog_synthesize` → `aog_build`
  as three explicit calls.

**For the on-disk YAML templates:**

- Either delete `templates/*.yaml` (rely on hardcoded built-ins) **or**
  delete the hardcoded built-ins (rely on packaged YAML). Document the
  override hierarchy: `.aog/templates/` (user) > `templates/` (package)
  > none. No silent shadowing of in-code defaults.

## Consequences

**Enables:** explicit operation selection, minimal default behavior,
composable tool calls, clearer onboarding, and elimination of the
silent-template-drift class of bugs.

**Limits:** five tools become eight (three new + five aliased) for one
release cycle; users have to learn three names instead of one. The
research-synthesis "magic" one-liner becomes a three-step chain that
the MCP client must orchestrate (this is fine for any modern MCP client
but may surprise long-time AOG users).

## Open Questions

- Should `aog_build` accept `agents: AgentId[]` and silently turn into
  council mode at length ≥ 2, or should that stay a separate tool?
  Argument for: one tool, scales naturally. Argument against: the
  semantics shift (synthesis vs. no synthesis) is hidden behind array
  length.
- Should `aog_synthesize` require `research_dir` to be non-empty
  (proposed), or accept an empty dir + a `task` string and synthesize
  from the task alone? The latter blurs back into "build with a plan
  step" — recommend keeping the strict version.
- Naming: `aog_*` vs. keeping the `council_*` prefix. The `council_`
  prefix made sense when council was the marquee feature. Now that
  build is the default, the prefix misleads. Recommend `aog_*`.
