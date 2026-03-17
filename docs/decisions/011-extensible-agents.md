# ADR-011: Extensible Agent Interface

## Status: Proposed

## Context

The agent spawners are hardcoded to three CLIs. Adding a fourth (GitHub Copilot CLI, Aider, Kiro) would require architecture changes.

## Decision

**Config-driven agent interface.** Agent definitions can be loaded from `agents.config.yaml` or fall back to hardcoded defaults.

### Agent Config Schema

```yaml
agents:
  claude:
    command: "claude"
    detect: "claude --version"
    headless: ["-p", "{prompt}", "--output-format", "json", "--dangerously-skip-permissions"]
    output_format: "json"
    output_parser: "claude"
    strengths: [orchestration, refactoring, debugging, planning]
    instruction_file: "CLAUDE.md"
    timeout_seconds: 300
```

### Implementation

- `GenericCLIAgent` base class reads config and builds CLI invocations from templates
- Existing `ClaudeSpawner`, `CodexSpawner`, `GeminiSpawner` extend it for CLI-specific parsing quirks
- `AgentManager` loads from config, falls back to hardcoded
- Router reads `strengths` from config for task routing
- Output parsers registered by name, loaded dynamically

### Adding a New Agent

1. Add entry to `agents.config.yaml`
2. Optionally add a custom parser in `src/utils/output.ts`
3. AOG auto-detects and includes it in routing

## Consequences

**Enables:** New CLI support via config change. Community contributions without core changes.
**Limits:** Config-only agents lack CLI-specific optimizations. Custom parsers still need code.

## Sources

All four research sources discussed extensibility. The config-driven approach draws from the MCP server configuration pattern used across all CLIs.
