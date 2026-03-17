---
name: aog-refactor
description: Code refactoring with validation that behavior is preserved
compatibility: claude codex gemini cursor
---

# Refactoring with Validation

Refactor the specified code while preserving existing behavior.

## Process

1. Read and understand the current code
2. Identify the refactoring to perform
3. Make changes incrementally
4. Verify behavior is preserved (tests pass, types check)
5. Output a structured summary

## Output Format

After refactoring, output this JSON:

```json
{
  "status": "completed" | "partial",
  "refactoring_type": "extract" | "rename" | "restructure" | "simplify" | "pattern",
  "files_modified": ["path/to/file.ts"],
  "changes": [
    {
      "file": "path/to/file.ts",
      "description": "What was changed and why",
      "before_lines": 45,
      "after_lines": 32
    }
  ],
  "behavior_preserved": true,
  "validation": "How behavior preservation was verified",
  "risks": ["Any potential issues to watch for"]
}
```

## Guidelines

- Make one logical change at a time
- Preserve all existing behavior
- Keep changes reversible
- If tests exist, ensure they still pass
- Document the reasoning behind structural changes
