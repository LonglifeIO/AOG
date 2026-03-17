# ADR-008: Interaction Model — Decision Gates

## Status: Proposed

## Context

All three CLIs are fire-and-forget in headless mode. The unsolved problem is: when does the USER get interrupted, and how? A 15-minute council session or 5-stage pipeline needs visibility and control points without constant prompting.

## Decision

**Decision gates are the ONLY user interaction points.** Between gates, agents run autonomously with progress notifications.

### Gate Types

| Gate | When | Skip in auto mode? |
|------|------|---------------------|
| Pre-dispatch | Before spawning agents, show plan | Yes |
| Post-implementation | After all agents complete, show results | Never skipped |
| Pre-merge | Before applying changes to main branch | Yes |
| On-failure | When an agent fails/times out | Never skipped |
| Pipeline-approval | At `type: approval` pipeline stages | Configurable |

### Liveness Monitoring

- Heartbeat: check process alive every 15s
- Stall warning: no output for 60s
- Stall critical: no output for 120s (offer kill)
- Timeout: per-agent configurable (Claude: 300s, Codex: 300s, Gemini: 180s)

### Pipeline Resume

Paused pipelines persist state to `.aog/sessions/`. The `council_pipeline` tool accepts a `resume_task_id` parameter to continue from the last completed stage.

## Consequences

**Enables:** User visibility without interruption, configurable autonomy, crash recovery.
**Limits:** No mid-task steering (agents are fire-and-forget).

## Sources

All research sources confirm fire-and-forget headless mode for all three CLIs. The gate pattern is novel to AOG.
