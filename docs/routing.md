# AOG Tool Routing

Quick reference for which CLI runs when. Source of truth:
`src/router/index.ts` (solo mode), `src/council/pipeline.ts` (council
mode), and the per-tool defaults in `src/tools/`.

## Default mode: council

`aog_build`, `aog_research`, and `aog_synthesize` all run council mode
by default. Council means:

- Every available CLI works the task in parallel git worktrees.
- Outputs are anonymized and cross-reviewed.
- A chairman synthesizes the result (default: Claude if installed, else
  the highest-scoring agent).
- Total wall time = max(individual times), not sum.

Pass `mode: "solo"` on any of the three tools to fall back to
single-agent routing-by-strength. Set `defaults.mode: solo` in
`aog.config.yaml` to flip the global default.

## Solo-mode routing matrix

Used when `mode: "solo"` is passed (or when council auto-degrades on a
single-CLI environment).

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
| Agents | All available, or whatever you pass via `agents: [...]` |
| Minimum agents | 2 in council mode (auto-degrades to solo if only 1) |
| Worktrees | One per agent, run in parallel; **always forced on** |
| `task_type` | **Ignored** — all CLIs run regardless |
| Default chairman | Claude if available; else the highest-scoring agent (`best-scorer`) |
| Chairman options | `claude` / `codex` / `gemini` / `best-scorer` |
| Synthesis strategies | `auto` (default — chairman-merge if scores close, best-wins if clear winner), `best-wins`, `chairman-merge` |
| Tests | Run per worktree for `aog_build` (skipped automatically when no `package.json`). Skipped for `aog_research` / `aog_synthesize`. |
| Operation guardrails | Auto-prefixed per operation. build = "implement only," research = "no code edits," synthesize = "no implementation." |
| Auto-attached context | `docs/IMPLEMENTATION-PLAN.md`, `research/` if they exist (read-only) |
| Partial failure | Survivors continue. Hard-error only if 0 agents complete successfully. |
| Empty repo | Council fails fast: "Repository at {cwd} has no commits…" Use solo mode if no commits yet. |

### Known constraints

- **`use_worktree: false` is silently overridden in council mode.**
  Council requires per-agent isolation. AOG forces `use_worktree: true`
  and emits a one-time stderr notice on the first call per process.
- **The branch produced by build council is torn down with the
  worktrees.** The diff lives in `.aog/sessions/{taskId}.json`. To
  preserve a branch, use `aog_pipeline` with a `full-council` template
  (which leaves the merged branch in place) or copy the diff manually
  from the session file.

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
`src/pipeline/templates.ts`. This is the customization surface for
power users who want approval gates, conditional stages, or custom
per-stage agent selection. The `then_build` shortcut on
`aog_synthesize` covers the common research → plan → build flow without
needing a pipeline template.
