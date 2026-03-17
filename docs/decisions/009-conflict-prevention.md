# ADR-009: File Conflict Prevention

## Status: Proposed

## Context

Git worktrees prevent physical conflicts during parallel execution, but when merging, two agents may have modified the same file with conflicting changes.

## Decision

**Four-layer conflict prevention system:**

1. **Task decomposition with file scoping (proactive):** Before dispatch, analyze task and assign file scopes per agent. Each `TaskAssignment` includes `scopedFiles` and `readOnlyContext`.

2. **Overlap detection (pre-dispatch):** Compare `scopedFiles` across assignments. Strategies: `serialize`, `designate`, `council`, `user_decide`.

3. **Post-execution conflict detection (reactive):** After agents complete, `git diff --name-only` to find files modified by multiple agents. Generate three-way diffs for overlapping files.

4. **Council mode exception:** In COUNCIL mode, file overlap IS the point. Layers 1-3 still run but response is "compare and rank" not "prevent."

## Consequences

**Enables:** Safe parallel execution in delegate/pipeline modes. Informed merge decisions. Council mode not blocked.
**Limits:** Scoping is best-effort (agents may ignore file scope). Post-execution detection is reactive.

## Sources

The Zapier merge-base technique (all sources) provides the diff extraction. File scoping is novel to AOG.
