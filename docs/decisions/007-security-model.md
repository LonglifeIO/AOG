# ADR-007: Security Model

## Status: Proposed

## Context

AOG orchestrates autonomous agents with filesystem and shell access. Each CLI has different permission models. The orchestrator amplifies both power and risk.

## Decision

### Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Prompt injection from codebase | HIGH | Sanitize inter-agent output; strip injection patterns |
| Agent-to-agent poisoning | HIGH | Structured JSON only; provenance annotations |
| Directory escape | MEDIUM | Worktree scoping; post-completion diff verification |
| Excessive permissions | MEDIUM | Least-privilege per task type |
| Resource exhaustion | LOW-MEDIUM | Timeouts, budget caps, process limits |

### Least-Privilege Per Task Type
- RESEARCH/ANALYZE: read-only tools
- REVIEW: read-only + structured output
- IMPLEMENT/REFACTOR: workspace-write, scoped to worktree
- Full bypass: container isolation required

### Inter-Agent Sanitization
All agent output treated as untrusted. Strip `<system>`, `IMPORTANT: ignore`, credential patterns. Pass structured JSON not raw prose. Annotate provenance.

### Approval Gates
Pipeline YAML supports `type: approval` stages. Default: present diff, require approval before merge.

### AOG Must NOT
- Auto-enable bypass flags without explicit config
- Capture or log auth tokens
- Store credentials in state files
- Pass environment variables to agent output

## Consequences

**Enables:** Defense in depth, configurable posture, full audit trail.
**Limits:** Read-only mode prevents some actions, approval gates slow autonomous flow.
**Risks:** Novel injection techniques, Claude `--dangerously-skip-permissions` has widest blast radius.

## Sources

All four sources provided security analysis. Claude most detailed on blast radius. GPT added GitHub lockdown and SSRF. Gemini noted Codex sandbox vulnerability.
