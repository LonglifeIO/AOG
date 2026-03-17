# ADR-006: Distribution and Packaging

## Status: Proposed

## Context

AOG needs easy installation and registration across MCP clients (Claude Code, Codex, Gemini CLI, Cursor, VS Code).

## Decision

### npm Package
`@aog/mcp-server` with bin entry `aog`. ESM module, TypeScript compiled.

### Installation
```bash
npx @aog/mcp-server           # Quick start
npm install -g @aog/mcp-server # Global
npx @aog/mcp-server init      # Setup wizard
```

### MCP Registration
```bash
claude mcp add --transport stdio aog -- npx -y @aog/mcp-server
```

### Setup Wizard
1. Detect CLIs (`which claude/codex/gemini`)
2. Check minimum versions
3. Verify auth status
4. Generate `aog.config.yaml`
5. Create `.aog/` directory
6. Offer MCP client registration

### Dual Distribution
MCP server + SKILL.md skills library + Claude Code agent definitions.

### Single-CLI Mode
Works with any subset. DELEGATE always works. COUNCIL degrades to single-agent with worktree.

## Consequences

**Enables:** Zero-friction onboarding, works with all major clients, graceful degradation.
**Limits:** npx cold start ~3s, skills separate from MCP server.

## Sources

All sources agree on npm + npx. Claude and Gemini suggested dual distribution.
