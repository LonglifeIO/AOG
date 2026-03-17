# ADR-010: Cross-CLI Skills and Worker Environment

## Status: Proposed

## Context

When AOG creates a worktree and dispatches an agent, that worktree has no task context. The agent doesn't know its scope, expected output format, or AOG constraints.

## Decision

### Per-Task Worker Environment

When AOG creates a worktree, it generates temporary task-specific instruction files:

- Claude worktree: `CLAUDE.md` with task, scope, constraints
- Codex worktree: `AGENTS.md` with same info in Codex format
- Gemini worktree: `.gemini/GEMINI.md` with same info

The `setupWorkerEnvironment()` function runs after worktree creation, before agent spawn.

### Universal Skills (SKILL.md standard)

Six cross-CLI skills producing structured JSON output:

| Skill | Purpose |
|-------|---------|
| aog-code-review | Structured review with severity ratings |
| aog-implement | Implementation with progress reporting |
| aog-research | Codebase analysis with confidence levels |
| aog-test-writer | Test generation with coverage tracking |
| aog-security-scan | OWASP-focused vulnerability scan |
| aog-refactor | Refactoring with behavior preservation validation |

### MCP Callback (v2 prep)

Worker agents can optionally call back to AOG via MCP for progress reporting and file lock requests. Disabled by default; infrastructure in place for v2.

## Consequences

**Enables:** Consistent agent behavior, structured parseable output, cross-CLI portability.
**Limits:** Instruction files add to agent context budget. Skills are suggestions, not enforced.

## Sources

SKILL.md standard from agentskills.io (all sources). Worker environment pattern from Gemini source's instruction injection approach.
