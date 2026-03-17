---
name: aog-code-review
description: Structured code review with severity ratings and actionable feedback
compatibility: claude codex gemini cursor
---

# Structured Code Review

Review the specified code changes and produce a structured JSON assessment.

## Process

1. Read the diff or changed files
2. Evaluate: correctness, security, performance, readability, test coverage
3. Output a JSON review object

## Output Format

Respond with ONLY this JSON structure:

```json
{
  "verdict": "approve" | "reject" | "suggest",
  "confidence": 0.0-1.0,
  "summary": "One-paragraph overall assessment",
  "issues": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "critical" | "major" | "minor" | "nit",
      "category": "bug" | "security" | "performance" | "style" | "logic",
      "message": "Description of the issue",
      "suggested_fix": "How to fix it"
    }
  ],
  "ranking": {
    "correctness": 1-10,
    "readability": 1-10,
    "performance": 1-10,
    "test_coverage": 1-10
  }
}
```

Focus on issues that could cause bugs, security vulnerabilities, or production incidents.
Nits and style suggestions should be clearly marked as such.
