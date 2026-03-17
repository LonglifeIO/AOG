# ADR-001: Agent Spawning Strategy

## Status: Proposed

## Context

AOG needs to invoke Claude Code, Codex CLI, and Gemini CLI programmatically in headless mode. Options: (a) spawn official CLI binaries, (b) use SDK/library bindings, (c) connect to native MCP server modes. Must remain ToS-compliant with subscription-based auth.

## Decision

**Spawn official CLI binaries as the primary method.** Support Codex's native MCP server mode as optional backend.

### Per-CLI Strategy

**Claude Code:** `cd /path/to/worktree && claude -p "prompt" --output-format json --dangerously-skip-permissions --max-turns 20 --session-id ${TASK_ID}`
- No `--cwd` flag; use `cwd` option in child process spawn
- Agent SDK available but uses subscription auth programmatically — gray area

**Codex CLI:** `codex exec "prompt" --full-auto --json --cd /path/to/worktree -m gpt-5.4`
- Has native `--cd` flag
- Alternative: `codex mcp-server` as stdio MCP server

**Gemini CLI:** `gemini -p "prompt" --output-format json --yolo -m gemini-2.5-pro`
- Spawn with `cwd` set to worktree path
- `--yolo` auto-enables Docker sandbox

### Process Management

- Processes spawned via `execa` with timeout
- PID registry in `.aog/pids.json`
- Graceful shutdown: SIGTERM -> 10s -> SIGKILL
- Orphan cleanup on startup

## Consequences

**Enables:** Full ToS compliance, works with subscription-only accounts, clean process lifecycle.
**Limits:** No `cwd` for Claude (requires `cd` wrapper), CLI flag changes require spawner updates.
**Risks:** CLI breaking changes between versions, shared rate limits with interactive use.

## Sources

All four sources (Claude, GPT, Gemini, Perplexity) agree on CLI binary spawning as the ToS-safe path.
