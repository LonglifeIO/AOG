# AOG Research Synthesis

Cross-referencing research from Claude, GPT, Gemini, and Perplexity on the AOG (Anthropic, OpenAI, Google) MCP server project.

---

## 1. CLI Headless Commands

### Where Sources AGREE (High Confidence)

**Claude Code:**
- All sources confirm: `claude -p "prompt"` is the headless mode flag
- `--output-format json` returns `{ type, subtype, session_id, total_cost_usd, duration_ms, num_turns, is_error, result }`
- `--output-format stream-json` returns NDJSON event stream
- `--dangerously-skip-permissions` bypasses ALL permission prompts (cannot run as root)
- `--max-turns N` and `--max-budget-usd N` for cost/iteration control
- `--session-id` / `--continue` / `--resume` for session management
- No `--cwd` flag exists (feature request #26287 open) — must use `cd /path && claude -p`
- Agent SDK (`@anthropic-ai/claude-agent-sdk`) supports `cwd` natively

**Codex CLI:**
- All sources confirm: `codex exec "prompt"` is the headless subcommand
- `--full-auto` sets `-a on-request -s workspace-write` (safe sandbox + auto-approve)
- `--json` outputs JSONL event stream (thread.started, item.completed, turn.completed)
- `-C` / `--cd <path>` for working directory
- `-o` / `--output-last-message <file>` saves final output
- `codex mcp-server` runs as first-party stdio MCP server with "codex" and "codex-reply" tools
- `--yolo` / `--dangerously-bypass-approvals-and-sandbox` disables ALL safety

**Gemini CLI:**
- All sources confirm: `gemini -p "prompt"` is the headless mode
- `--output-format json` returns `{ response, stats: { models, tools, files } }`
- `--yolo` / `-y` auto-approves all tool calls
- Supports stdin piping: `cat file | gemini -p "review"`
- MCP config via `~/.gemini/settings.json` or `.gemini/settings.json` only (no CLI flag)
- Rate limits: 60 req/min, 1,000 req/day on free tier

### Where Sources DISAGREE or CONFLICT

| Topic | Resolution |
|-------|------------|
| Gemini `--yolo` vs `--approval-mode=yolo` | Both work. `--yolo` auto-enables Docker sandbox. |
| Claude Agent SDK for AOG | Skip SDK, use CLI binary spawn. ToS-safe path. |
| Codex MCP vs CLI spawn | Support both: `codex mcp-server` primary, CLI spawn fallback |
| Gemini `-p` deprecation | Only one source mentions. Keep `-p` for now, verify. |

### Needs Live Testing

- Exact JSON schema shape from `claude -p --output-format json`
- Codex `--json` JSONL event types and structure
- Gemini `--output-format json` exact field names in `stats` block
- Whether `--allowedTools` is respected with `--dangerously-skip-permissions` on Claude
- Concurrent instance behavior for all three CLIs

---

## 2. ToS and Legal Risk

### The Safe Path (All Sources Agree)

1. Spawn official CLI binaries only (not SDKs with subscription tokens)
2. Let each CLI handle its own authentication
3. Do NOT extract OAuth tokens or session cookies
4. Do NOT use the Claude Agent SDK with subscription auth for automated orchestration
5. Support API keys as first-class alternative

### Rate Limits as Practical Constraint

| CLI | Rate Limit Model | Impact |
|-----|-------------------|--------|
| Claude Code | USD-based (`--max-budget-usd`) | Cost-controllable per task |
| Codex CLI | Message-based, 5hr window (Plus: 30-150, Pro: 300-1,500) | Hard ceiling |
| Gemini CLI | 60 req/min, 1,000 req/day (free tier) | Most restrictive |

---

## 3. Existing MCP Servers

### Consensus Decisions

| Server | Decision | Confidence |
|--------|----------|------------|
| `codex mcp-server` (built-in) | **USE** | Very High |
| `github/github-mcp-server` | **USE** | Very High |
| `codex-as-mcp` (kky42) | **SKIP** | Very High |
| `@jacob/gemini-cli-mcp` | **SKIP** | High |

### Disputed — Our Resolution

| Server | Decision | Rationale |
|--------|----------|-----------|
| `@cyanheads/git-mcp-server` | **BUILD INTERNAL** | Call git directly. External MCP dependency adds failure modes. |
| `git-worktree-toolbox` | **STUDY patterns** | Extract session-per-worktree pattern, don't depend. |
| `mcp-worktree-voting` | **EXTRACT pattern** | Reimplement 50/30/20 scoring. No license = can't use directly. |
| `mcp-tasks` | **SKIP** | Build lightweight internal state machine. |

---

## 4. Git Worktree Isolation

**Universal agreement on core pattern:**
```bash
git worktree add .worktrees/agent-${AGENT}-${TASK_ID} -b aog/${AGENT}/${TASK_ID}
# Agents work in parallel (latency = max, not sum)
git worktree remove .worktrees/agent-${AGENT}-${TASK_ID}
git worktree prune --expire now
git branch -D aog/${AGENT}/${TASK_ID}
```

**Design Decision:** Use `simple-git` library. Built-in manager with orphan detection, signal handler cleanup, metadata in `.aog/worktrees.json`.

---

## 5. Cross-Review and Synthesis

**Unanimous agreement:** Merge-base diff extraction, anonymized reviews (A/B/C labels), structured JSON output, 50/30/20 scoring heuristic.

**Chairman selection:** Configurable per template. Default Claude for multi-file synthesis, Gemini for large-context tasks.

---

## 6. Task Routing

| Task | Agent | Confidence |
|------|-------|------------|
| RESEARCH/ANALYZE | Gemini | Very High |
| GENERATE | Codex | High |
| DEBUG/MIGRATE | Claude | High |
| IMPLEMENT/REFACTOR | Claude | High |
| REVIEW | Gemini | High |

---

## 7. Skills Ecosystem

All sources agree on SKILL.md (agentskills.io) as cross-CLI format. Ship agents in `.claude/agents/`, instructions in `.codex/AGENTS.md` and `.gemini/GEMINI.md`.

---

## 8. Distribution

npm package (`aog-mcp-server`), npx quick start, setup wizard, dual MCP + skills distribution. Works with any subset of CLIs.
