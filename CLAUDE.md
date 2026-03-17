# AOG — CLI Council MCP Server

## Status

Built and tested. All three CLIs (Claude Code, Codex CLI, Gemini CLI) confirmed
working end-to-end. Council mode with parallel worktrees, cross-review, and
chairman synthesis tested and operational.

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

## Three Execution Modes

1. **DELEGATE** — Route a single task to the best agent based on task type
2. **COUNCIL** — Fan out to all agents in parallel, cross-review, chairman synthesis
3. **PIPELINE** — Multi-stage sequential/parallel workflow from YAML templates

## Key Design Decisions

- **CLI binary spawning only** — no SDK auth, no OAuth extraction (ToS-safe)
- **Git worktrees for isolation** — agents work in parallel without conflicts
- **Built-in git operations** — no external MCP server dependency for core ops
- **File-based state** — JSON sessions in `.aog/` for crash recovery
- **Output from git, not prose** — diffs extracted via `git diff merge-base..branch`
- **stdin: "ignore"** — critical for spawning CLIs via execa (prevents stdin contention)

## Project Structure (78 files, 34 TypeScript modules)

- `src/server.ts` — MCP server with 5 Zod-validated tool definitions
- `src/agents/` — Per-CLI spawners (claude.ts, codex.ts, gemini.ts), generic base, manager
- `src/worktree/` — Git worktree lifecycle, merge-base diff extraction
- `src/council/` — Fan-out, anonymized cross-review, 50/30/20 scoring, chairman synthesis
- `src/pipeline/` — YAML template engine, state machine, inter-stage context
- `src/router/` — Task type → agent routing matrix
- `src/tools/` — MCP tool handlers (delegate, council, pipeline, status, cancel)
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
| `council_delegate` | Route task to best single agent |
| `council_run` | Fan-out + cross-review + synthesis |
| `council_pipeline` | Execute named pipeline template |
| `council_status` | Check session status |
| `council_cancel` | Cancel running session |

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

- Unit tests
- `aog init` setup wizard
- Container isolation mode
- Pipeline resume after approval pause
- Metrics / learned adaptive routing
- Codex native MCP server backend
