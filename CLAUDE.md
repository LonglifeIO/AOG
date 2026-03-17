# AOG — CLI Council MCP Server

## What is this?

AOG (Anthropic, OpenAI, Google) is an MCP server that orchestrates Claude Code, Codex CLI, and Gemini CLI as a collaborative multi-agent coding team. It implements the "CLI Council" pattern — inspired by multi-model council approaches, adapted for CLI coding agents working on real code.

## Architecture

```
MCP Client (Claude Desktop / Cursor / VS Code)
  └── AOG MCP Server (TypeScript, stdio)
       ├── Agent Manager (Claude/Codex/Gemini spawners)
       ├── Worktree Manager (git isolation)
       ├── Pipeline Engine (YAML-driven state machine)
       ├── Council (fan-out → cross-review → synthesis)
       └── Router (task type → agent selection)
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

## Project Structure

- `src/server.ts` — MCP server with tool definitions
- `src/agents/` — Per-CLI spawners (claude.ts, codex.ts, gemini.ts)
- `src/worktree/` — Git worktree lifecycle management
- `src/council/` — Fan-out, cross-review, synthesis
- `src/pipeline/` — YAML template engine, state machine
- `src/router/` — Task type → agent routing
- `src/tools/` — MCP tool handlers
- `templates/` — Pipeline YAML templates

## Development

```bash
npm install
npm run dev          # Run with tsx
npm run build        # Compile TypeScript
npm test             # Run vitest
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
- Use `execa` for child processes, `simple-git` for git, `zod` for schemas
- All inter-agent context is structured JSON (never raw conversation)
- Agent output is sanitized before passing to other agents
- State persists to `.aog/sessions/` with atomic writes
