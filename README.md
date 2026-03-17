[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)

# AOG — Multi-Agent CLI Council

**AOG** (Anthropic, OpenAI, Google) is an open-source MCP server that orchestrates Claude Code, Codex CLI, and Gemini CLI as a collaborative multi-agent coding team. Inspired by the LLM council pattern — multiple models working the same problem independently, then cross-reviewing and synthesizing — but applied to CLI coding agents working on real code.

## See It In Action

A single `council_run` command dispatched the same task to Claude Code and Gemini CLI in parallel worktrees:

| Agent | What It Built | Time |
|-------|--------------|------|
| Claude | Clean 9-line `getHealth()` using `Date.now()` | ~9s |
| Gemini | 15-line version with JSDoc, `process.uptime()`, AND wrote tests unprompted | ~10s |

Both implementations were anonymized and cross-reviewed. The chairman merged the best parts of each into the final result. Total council time: ~2 minutes.

## Prerequisites

- **Node.js** >= 20
- **Git** (for worktree isolation)
- At least one of:
  - [Claude Code](https://claude.ai/code) (Claude Max subscription)
  - [Codex CLI](https://openai.com/codex) (ChatGPT Plus/Pro subscription)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Google account, free tier)

> **Don't have all three?** AOG works with any subset — even just one CLI.
> Delegate mode routes tasks to whatever you have installed. Council and
> pipeline modes unlock when you have two or more.

## Quick Start

```bash
# Install and register with Claude Code
claude mcp add --transport stdio aog -- npx -y @aog/mcp-server

# Or register with Codex CLI
codex mcp add aog -- npx -y @aog/mcp-server

# Or add to Gemini CLI (~/.gemini/settings.json)
# { "mcpServers": { "aog": { "command": "npx", "args": ["-y", "@aog/mcp-server"] } } }
```

Then ask your AI coding agent:
> "Use the council_run tool to implement a rate limiter for the API endpoints"

## Three Modes

### DELEGATE — Single Agent Routing
Routes a task to the best available CLI based on task type:

| Task Type | Preferred Agent | Why |
|-----------|----------------|-----|
| IMPLEMENT | Claude Code | Best multi-file planning |
| RESEARCH | Gemini CLI | 1M token context window |
| GENERATE | Codex CLI | Fastest execution |
| REVIEW | Gemini CLI | Large context for diffs |
| DEBUG | Claude Code | Diagnostic reasoning |

### COUNCIL — Multi-Agent Consensus
Fan out a task to all agents working in parallel, with anonymized cross-review and chairman synthesis:

1. Each agent gets an isolated git worktree
2. All agents implement the task simultaneously
3. Tests run in each worktree
4. Agents cross-review anonymized diffs (Implementation A/B/C)
5. Chairman merges the best parts into a final implementation

### PIPELINE — Staged Workflows
Execute multi-stage pipelines from YAML templates:

- **full-council** — implement -> test -> review -> synthesize -> final test
- **quick-fix** — fix -> test -> review
- **migration** — research -> plan -> approve -> implement -> test -> review -> synthesize
- **dependency-update** — analyze -> update -> test -> review
- **research-synthesis** — read multi-source research -> synthesize -> plan -> approve -> build

The research-synthesis pipeline is the simplest way to use AOG: drop research
outputs from multiple LLMs into a `research/` folder, then let AOG synthesize
findings and build from the plan.

## Security

AOG follows the principle of least privilege:

- **Spawns official CLI binaries only** — no OAuth token extraction, no SDK auth hacks
- **Git worktree isolation** — each agent works in its own directory
- **Output sanitization** — strips prompt injection patterns between agents
- **Approval gates** — configurable human-in-the-loop at critical pipeline stages
- **Audit logging** — all operations logged to `.aog/sessions/`

## Configuration

Create `aog.config.yaml` in your project root:

```yaml
agents:
  claude:
    enabled: true
    model: sonnet          # or claude-sonnet-4-6
    maxTurns: 20
    maxBudgetUsd: 5.0
  codex:
    enabled: true
    model: gpt-5.4         # or your preferred model
  gemini:
    enabled: true
    model: gemini-2.5-pro   # override with your available model

defaults:
  chairman: claude
  timeout: 300000
  pipeline: full-council

security:
  require_approval_before_merge: true
  allow_permission_bypass: false
  max_parallel_agents: 3
  max_budget_per_task_usd: 10.0
  audit_logging: true
```

## Development

```bash
git clone https://github.com/LonglifeIO/AOG.git
cd AOG
npm install
npm run build   # Compile TypeScript
npm run dev     # Start MCP server with tsx
```

## Not Yet Built

- Unit tests (vitest configured, no test files yet)
- `aog init` setup wizard
- Container isolation mode
- Pipeline resume after pause
- Metrics / learned adaptive routing

## Contributing

This project is in early development. Issues, bug reports, and PRs welcome.
See `docs/decisions/` for architecture context before making major changes.

## License

MIT
