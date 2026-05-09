# AOG — CLI Council MCP Server

## Status

v2.0.0 — council is now the default for `aog_build`, `aog_research`,
and `aog_synthesize`. Single-CLI environments auto-degrade to solo with
a stderr notice. Solo mode (the prior default) is still available via
`mode: "solo"` or `defaults.mode: solo` in `aog.config.yaml`.

## What is this?

AOG (Anthropic, OpenAI, Google) is an MCP server that orchestrates Claude Code,
Codex CLI, and Gemini CLI as a collaborative multi-agent coding team. It
implements the "CLI Council" pattern — inspired by multi-model council
approaches, adapted for CLI coding agents working on real code.

## Architecture

```
MCP Client (Claude Desktop / Cursor / VS Code)
  └── AOG MCP Server (TypeScript, stdio)
       ├── Agent Manager (Claude/Codex/Gemini spawners)
       ├── Worktree Manager (git isolation)
       ├── Pipeline Engine (YAML-driven state machine)
       ├── Council (fan-out → cross-review → synthesis)
       ├── Router (task type → agent selection)
       ├── Interaction (decision gates, liveness, progress)
       ├── Conflict (file scoping, detection, resolution)
       └── Dispatch (worker environment, instructions, skills)
```

## Default behavior: council on every task

`aog_build`, `aog_research`, and `aog_synthesize` all run as a council
by default: every available CLI works the same task in parallel git
worktrees, outputs are anonymized and cross-reviewed, and a chairman
(Claude by default) synthesizes the result.

## Two escape hatches

- **`mode: "solo"`** — single-agent routing-by-strength. Cost or speed
  escape for trivial tasks. AOG picks the CLI best suited to the
  `task_type` (or honors an explicit `agent`).
- **`aog_pipeline`** — multi-stage YAML workflow with custom stages,
  approval gates, and per-stage agent selection.

## Single-CLI graceful fallback

If only one CLI is installed and authenticated, council mode silently
falls back to solo with a one-time stderr notice. AOG works with any
subset of CLIs.

## Key Design Decisions

- **CLI binary spawning only** — no SDK auth, no OAuth extraction (ToS-safe)
- **Git worktrees for isolation** — agents work in parallel without conflicts
- **Built-in git operations** — no external MCP server dependency for core ops
- **File-based state** — JSON sessions in `.aog/` for crash recovery
- **Output from git, not prose** — diffs extracted via `git diff merge-base..branch`
- **stdin: "ignore"** — critical for spawning CLIs via execa (prevents stdin contention)

## Project Structure (78 files, 34 TypeScript modules)

- `src/server.ts` — MCP server with 6 primary tools + `aog_council` deprecation alias
- `src/agents/` — Per-CLI spawners (claude.ts, codex.ts, gemini.ts), generic base, manager
- `src/worktree/` — Git worktree lifecycle, merge-base diff extraction
- `src/council/` — Operation-aware fan-out + cross-review + chairman synthesis. `pipeline.ts` orchestrates; `guardrails.ts` wraps prompts per operation. Build scores 50/30/20 (test/review/impact); research/synthesize score 0/70/30 (review/depth).
- `src/pipeline/` — YAML template engine, state machine, inter-stage context
- `src/router/` — Task type → agent routing matrix
- `src/tools/` — MCP tool handlers (build, research, synthesize, pipeline, status, cancel; delegate.ts is the internal solo-mode helper)
- `src/interaction/` — Decision gates, liveness monitoring, progress reporting
- `src/conflict/` — File scoping, overlap detection, resolution strategies
- `src/dispatch/` — Worker environment setup, per-CLI instruction generation
- `src/utils/` — Output parsers, sanitization, config loader, process management
- `templates/` — 5 YAML pipeline templates including research-synthesis
- `skills/` — 7 cross-CLI SKILL.md skills (agentskills.io standard)

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Run with tsx
npm test             # Run vitest (no tests yet)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `aog_build` | Implement / fix / refactor. Council by default; `mode: "solo"` for single agent. |
| `aog_research` | Investigate, write `research/{slug}.md`. Council by default. |
| `aog_synthesize` | Research → plan. Council by default. `then_build: true` chains into `aog_build`. |
| `aog_pipeline` | Run a named multi-stage YAML pipeline. |
| `aog_status` | Inspect a running or completed session. |
| `aog_cancel` | Stop a running session and clean up worktrees. |
| `aog_council` | **Deprecated alias** → forwards to `aog_build` mode=council. Removed in v2.1.0. |

## Conventions

- TypeScript strict mode, ES2022 target
- Use `execa` for child processes with `stdin: "ignore"`
- Use `simple-git` for git operations
- Use `zod` for all schemas
- All inter-agent context is structured JSON (never raw conversation)
- Agent output is sanitized before passing to other agents
- State persists to `.aog/sessions/` with atomic writes
- Registry operations use a promise-based lock to prevent race conditions

## Not Yet Built

- `aog init` setup wizard
- Container isolation mode
- Pipeline resume after approval pause
- Metrics / learned adaptive routing
- Codex native MCP server backend
