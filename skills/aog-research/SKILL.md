---
name: aog-research
description: Codebase research and analysis with structured findings
compatibility: claude codex gemini cursor
---

# Codebase Research and Analysis

Analyze the codebase or documentation to answer specific questions.

## Process

1. Read the research question or analysis request
2. Explore relevant files, documentation, and code
3. Cross-reference findings across multiple sources if applicable
4. Produce structured findings

## Output Format

Respond with this JSON structure:

```json
{
  "question": "The research question asked",
  "findings": [
    {
      "topic": "Name of finding",
      "confidence": "high" | "medium" | "low",
      "evidence": "Where this was found (files, docs, etc.)",
      "detail": "The finding itself"
    }
  ],
  "recommendations": [
    "Actionable recommendation based on findings"
  ],
  "gaps": [
    "Things that couldn't be determined and why"
  ],
  "files_examined": ["list/of/files/read.ts"]
}
```

## Guidelines

- Read broadly before drawing conclusions
- Distinguish between facts and inferences
- Note confidence levels for each finding
- Identify gaps in understanding
