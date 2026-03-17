# AOG — CLI Council Integration for Gemini

This project uses AOG (CLI Council) to orchestrate multi-agent coding workflows.
Gemini CLI is used as the primary agent for RESEARCH and ANALYZE tasks due to its
1M token context window.

## Available MCP Tools

- `council_delegate` — Route a task to the best CLI agent
- `council_run` — Fan out a task to multiple agents with cross-review
- `council_pipeline` — Execute a multi-stage pipeline
- `council_status` — Check running session status
- `council_cancel` — Cancel a running session

## Project Structure

- `src/` — TypeScript MCP server source
- `templates/` — YAML pipeline templates
- `skills/` — Cross-CLI SKILL.md definitions

## Development Guidelines

- TypeScript with strict mode
- MCP SDK v2 with stdio transport
- All agent spawning via official CLI binaries
- Git worktrees for isolation in council/pipeline modes
