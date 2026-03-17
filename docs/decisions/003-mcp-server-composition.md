# ADR-003: MCP Server Composition

## Status: Proposed

## Context

The MCP ecosystem has many servers that overlap with AOG's needs. We must decide which to depend on, wrap, or build internally.

## Decision

### USE (Runtime)
- `codex mcp-server` (built-in) — optional Codex backend via stdio
- `github/github-mcp-server` — pass through to agents for GitHub ops

### BUILD INTERNAL
- Git worktree management — core path, external dependency adds failure modes
- Diff extraction (merge-base) — deterministic, must be reliable
- Pipeline state machine — AOG-specific; existing servers too heavy
- Output normalization — per-CLI parsing is AOG-specific
- Cross-review orchestration — novel capability
- Process management — tightly integrated with worktree lifecycle

### STUDY (Extract Patterns)
- `git-worktree-toolbox` — session-per-worktree metadata tracking
- `mcp-worktree-voting` — 50/30/20 scoring heuristic
- `ai-cli-mcp` — spawn + PID tracking patterns

### SKIP
- `@cyanheads/git-mcp-server`, `codex-as-mcp`, `@jacob/gemini-cli-mcp`, `server-filesystem`, `server-fetch`, `mcp-tasks`, `git-codereview-mcp`

## Consequences

**Enables:** Minimal external dependencies, full control over critical path, deterministic behavior.
**Limits:** More code to maintain for git operations.

## Sources

GPT and Perplexity argued strongly for built-in git. Claude had the most comprehensive survey.
