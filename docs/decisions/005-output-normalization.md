# ADR-005: Output Normalization

## Status: Proposed

## Context

Each CLI produces different output formats. AOG must normalize into a unified schema for cross-review, synthesis, and reporting.

## Decision

**Repo-first extraction: diffs and file changes from git, not from agent prose.**

| Field | Claude | Codex | Gemini |
|-------|--------|-------|--------|
| Final text | `.result` from JSON | Parse JSONL | `.response` from JSON |
| Session ID | `.session_id` | `threadId` | Generated UUID |
| Cost (USD) | `.total_cost_usd` | null (message-based) | null (free tier) |
| Tokens | Stream events | `turn.completed` usage | `stats.models.*.tokens` |
| Files/Diff | **git** | **git** | **git** |

File changes are ALWAYS extracted from git (authoritative, consistent).

### Unified `AgentResult` Interface
Contains: taskId, agent, model, status, duration_ms, result, cost, changes (from git), tests, session.

## Consequences

**Enables:** Consistent comparison, reliable diffs, cost tracking where available.
**Limits:** Some CLI-specific metadata lost. Token counts not always available.

## Sources

All four sources agree on repo-first model. Perplexity emphasized defensive null fallbacks.
