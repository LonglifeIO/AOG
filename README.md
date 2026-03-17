[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)

# AOG — Multi-Agent CLI Orchestrator

**AOG** (Anthropic, OpenAI, Google) is an open-source MCP server that orchestrates Claude Code, Codex CLI, and Gemini CLI as a collaborative multi-agent coding team. Multiple models work the same problem independently, then cross-review and synthesize — applied to CLI coding agents working on real code.

```
                         ┌─────────────────────┐
                         │     MCP Client       │
                         │ (Claude / Cursor /   │
                         │  VS Code / Codex)    │
                         └─────────┬───────────┘
                                   │
                         ┌─────────▼───────────┐
                         │    AOG MCP Server    │
                         │                     │
                         │  ┌──────────────┐   │
                         │  │    Router     │   │
                         │  └──────┬───────┘   │
                         │         │           │
                         │  ┌──────▼───────┐   │
                         │  │  Orchestrator │   │
                         │  └──┬───┬───┬───┘   │
                         │     │   │   │       │
                         └─────┼───┼───┼───────┘
                               │   │   │
              ┌────────────────┘   │   └────────────────┐
              ▼                    ▼                     ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   Claude Code    │ │    Codex CLI     │ │   Gemini CLI     │
    │                  │ │                  │ │                  │
    │  ┌────────────┐  │ │  ┌────────────┐  │ │  ┌────────────┐  │
    │  │ Worktree A │  │ │  │ Worktree B │  │ │  │ Worktree C │  │
    │  │  (git)     │  │ │  │  (git)     │  │ │  │  (git)     │  │
    │  └────────────┘  │ │  └────────────┘  │ │  └────────────┘  │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
              │                    │                     │
              └────────────────────┼─────────────────────┘
                                   ▼
                         ┌─────────────────────┐
                         │   Cross-Review &     │
                         │   Synthesis          │
                         │                     │
                         │  Anonymized diffs    │
                         │  50/30/20 scoring    │
                         │  Chairman merge      │
                         └─────────────────────┘
```

## See It In Action

A single `council_run` command dispatched the same task to Claude Code and Gemini CLI in parallel worktrees:

| Agent | What It Built | Time |
|-------|--------------|------|
| Claude | Clean 9-line `getHealth()` using `Date.now()` | ~9s |
| Gemini | 15-line version with JSDoc, `process.uptime()`, AND wrote tests unprompted | ~10s |

Both implementations were anonymized and cross-reviewed. The chairman merged the best parts of each. Total time: ~2 minutes.

## Prerequisites

- **Node.js** >= 20
- **Git** (for worktree isolation)
- At least one of:
  - [Claude Code](https://claude.ai/code) (Claude Max subscription)
  - [Codex CLI](https://openai.com/codex) (ChatGPT Plus/Pro subscription)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Google account, free tier)

> **Don't have all three?** AOG works with any subset — even just one CLI.
> Delegate mode routes tasks to whatever you have installed. Multi-agent
> modes unlock when you have two or more.

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

```
  Task ──▶ Router ──▶ Best Agent ──▶ Result
              │
              ├── IMPLEMENT → Claude (planning)
              ├── RESEARCH  → Gemini (1M context)
              ├── GENERATE  → Codex  (speed)
              ├── REVIEW    → Gemini (large diffs)
              └── DEBUG     → Claude (reasoning)
```

### COUNCIL — Multi-Agent Consensus

```
                    ┌──── Claude ────┐
                    │                │
  Task ──▶ Fan Out ─┼──── Codex  ────┼──▶ Cross-Review ──▶ Synthesis ──▶ Result
                    │                │    (anonymized)     (chairman)
                    └──── Gemini ────┘
```

1. Each agent gets an isolated git worktree
2. All agents implement the task simultaneously
3. Tests run in each worktree
4. Agents cross-review anonymized diffs (Implementation A/B/C)
5. Chairman merges the best parts into the final implementation

### PIPELINE — Staged Workflows

```
  ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
  │ Research   │───▶│   Plan    │───▶│ Implement  │───▶│  Review   │
  │ (Gemini)   │    │ (Claude)  │    │ (Codex)    │    │ (Claude)  │
  └───────────┘    └───────────┘    └───────────┘    └───────────┘
```

Built-in templates:

| Template | Stages |
|----------|--------|
| **full-council** | implement → test → review → synthesize → final test |
| **quick-fix** | fix → test → review |
| **migration** | research → plan → approve → implement → test → review → synthesize |
| **dependency-update** | analyze → update → test → review |
| **research-synthesis** | synthesize research → plan → approve → build |

The **research-synthesis** pipeline is the simplest way to start: drop research
outputs from multiple LLMs into a `research/` folder, then let AOG synthesize
and build from the plan.

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

## Project Structure

```
src/
├── server.ts              # MCP server — 5 tool definitions
├── agents/                # Claude, Codex, Gemini spawners
├── council/               # Fan-out, cross-review, synthesis
├── pipeline/              # YAML template engine, state machine
├── router/                # Task type → agent routing
├── interaction/           # Decision gates, liveness, progress
├── conflict/              # File scoping, overlap detection
├── dispatch/              # Worker environment setup
└── utils/                 # Output parsers, config, sanitization
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
