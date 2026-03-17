# AOG — Multi-Agent CLI Council

**AOG** (Anthropic, OpenAI, Google) is an open-source MCP server that orchestrates Claude Code, Codex CLI, and Gemini CLI as a collaborative multi-agent coding team. Inspired by the LLM council pattern — multiple models working the same problem independently, then cross-reviewing and synthesizing — but applied to CLI coding agents working on real code.

## Prerequisites

- **Node.js** >= 20
- **Git** (for worktree isolation)
- At least one of:
  - [Claude Code](https://claude.ai/code) (Claude Max subscription)
  - [Codex CLI](https://openai.com/codex) (ChatGPT Plus/Pro subscription)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Google account, free tier)

AOG works with any subset of CLIs — even just one. More CLIs = more capabilities.

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
    model: sonnet
    maxTurns: 20
    maxBudgetUsd: 5.0
  codex:
    enabled: true
    model: gpt-5.4
  gemini:
    enabled: true
    model: gemini-2.5-pro

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
git clone https://github.com/anthropic-openai-google/aog
cd aog
npm install
npm run dev     # Start MCP server with tsx
npm run build   # Compile TypeScript
npm test        # Run tests
```

## License

MIT
