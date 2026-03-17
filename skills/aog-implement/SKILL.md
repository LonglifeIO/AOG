---
name: aog-implement
description: Implement a feature or change from a specification with structured progress reporting
compatibility: claude codex gemini cursor
---

# Implementation from Specification

Implement the described feature or change. Follow the specification precisely.

## Process

1. Read the specification/task description
2. Plan the implementation (identify files to create/modify)
3. Implement all changes
4. Verify the code compiles
5. Output a structured summary

## Output Format

After completing the implementation, output this JSON:

```json
{
  "status": "completed" | "partial" | "blocked",
  "files_created": ["path/to/new/file.ts"],
  "files_modified": ["path/to/existing/file.ts"],
  "summary": "What was implemented and any decisions made",
  "notes": ["Any caveats or follow-up items"],
  "tests_needed": ["Descriptions of tests that should be written"]
}
```

## Rules

- Make all changes functional, not placeholder stubs
- Follow existing code patterns and conventions
- Do not modify files outside the scope of the task
- If blocked, explain what's needed in the output
