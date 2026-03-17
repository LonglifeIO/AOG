---
name: council-review
description: Run a multi-agent cross-review on the current branch changes using AOG CLI Council
compatibility: claude codex gemini cursor
---

# Council Cross-Review

When activated, use the `council_run` MCP tool to fan out the current branch's changes for review by all available AI coding agents.

## Usage

This skill triggers a full council review cycle:
1. Each available agent (Claude, Codex, Gemini) reviews the changes independently
2. Reviews are anonymized — agents don't know which implementation they're reviewing
3. Results are synthesized with scoring: tests (50pts), code quality (30pts), impact (20pts)

## Invocation

Call the `mcp__aog__council_run` tool with:
- `task`: "Review the changes on the current branch for correctness, security, and code quality"
- `run_tests`: true
- `test_command`: the project's test command (default: `npm test`)

## Output

Returns structured review results including:
- Per-reviewer verdicts (approve/reject/suggest)
- File-level comments with severity ratings
- Aggregate scores and ranking
- Synthesis recommendation
