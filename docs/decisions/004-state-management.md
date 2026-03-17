# ADR-004: Pipeline State Management

## Status: Proposed

## Context

AOG pipelines involve multi-stage execution across multiple agents. Need state persistence for crash recovery, progress tracking, and inter-stage context.

## Decision

**File-based JSON state machine with per-task session files.**

### Storage Layout
```
.aog/
├── sessions/${taskId}.json      # Pipeline state
├── sessions/${taskId}.audit.jsonl  # Audit log
├── worktrees.json               # Active worktree registry
├── pids.json                    # Process registry
└── config.yaml                  # User configuration
```

### State Transitions
State persisted after every stage transition via atomic write (write to .tmp, rename). On crash: read last state, identify completed stages, resume from next.

### Inter-Stage Context
Agents receive structured `handoff.json` (problem diagnosis, target files, decisions) not raw conversation history. Diffs generated lazily from git and cached.

## Consequences

**Enables:** Crash recovery, full audit trail, human-readable state, no database dependency.
**Limits:** Doesn't scale to many concurrent tasks, no built-in locking.

## Sources

All sources agree on file-based state. Gemini contributed the handoff.json pattern.
