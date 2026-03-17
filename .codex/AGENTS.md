# AOG — CLI Council Integration for Codex

This project uses AOG (CLI Council) to orchestrate multi-agent coding workflows
across Claude Code, Codex CLI, and Gemini CLI.

## Available MCP Tools

When the AOG MCP server is running, you have access to:

- `council_delegate` — Route a task to the best CLI agent
- `council_run` — Fan out a task to multiple agents with cross-review
- `council_pipeline` — Execute a multi-stage pipeline
- `council_status` — Check running session status
- `council_cancel` — Cancel a running session

## Project Structure

- `src/` — TypeScript MCP server source
- `templates/` — YAML pipeline templates
- `skills/` — Cross-CLI SKILL.md definitions
- `.aog/` — Runtime state (sessions, worktrees, PIDs)

## Conventions

- Use `execa` for child process management
- Use `simple-git` for git operations
- Use `zod` for schema validation
- All agent output is normalized to the `AgentResult` interface
- Inter-agent context is passed as structured JSON, never raw conversation
