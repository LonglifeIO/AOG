# ADR-002: Git Worktree Isolation Strategy

## Status: Proposed

## Context

Council mode requires multiple agents to work on the same task simultaneously without filesystem conflicts. Each agent needs an independent working directory with its own staging area while sharing the git object database.

## Decision

**Use git worktrees as the isolation primitive, managed internally via `simple-git`.**

### Worktree Lifecycle

- **Create:** `git worktree add .worktrees/agent-${AGENT}-${TASK_ID} -b aog/${AGENT}/${TASK_ID}`
- **Cleanup:** `git worktree remove .worktrees/agent-*-${TASK_ID} && git worktree prune && git branch -D aog/*/${TASK_ID}`
- **Metadata:** Tracked in `.aog/worktrees.json`
- **Crash recovery:** Orphan detection + cleanup on startup
- **Signal handling:** SIGINT/SIGTERM -> kill PIDs -> remove worktrees -> exit

## Consequences

**Enables:** True parallel execution, minimal disk overhead, clean per-agent diffs.
**Limits:** Must be on same filesystem, dependency install adds latency.
**Risks:** Stale worktrees on crash, disk space for large repos.

## Sources

Universal agreement across all four sources. Claude added pnpm optimization, GPT and Perplexity emphasized built-in git over MCP dependency.
