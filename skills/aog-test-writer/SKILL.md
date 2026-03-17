---
name: aog-test-writer
description: Generate comprehensive tests for existing code
compatibility: claude codex gemini cursor
---

# Test Generation

Generate comprehensive tests for the specified code.

## Process

1. Read the target code and understand its behavior
2. Identify test cases: happy path, edge cases, error conditions
3. Write tests using the project's test framework
4. Verify tests are syntactically correct

## Output Format

After writing tests, output this JSON:

```json
{
  "test_file": "path/to/test/file.test.ts",
  "framework": "vitest" | "jest" | "mocha" | "other",
  "test_count": 12,
  "categories": {
    "happy_path": 4,
    "edge_cases": 5,
    "error_handling": 3
  },
  "coverage_targets": ["list of functions/methods covered"],
  "not_covered": ["things intentionally not tested and why"]
}
```

## Guidelines

- Match the existing test framework and patterns
- Test behavior, not implementation details
- Include both positive and negative test cases
- Test edge cases and boundary conditions
- Keep tests independent and deterministic
