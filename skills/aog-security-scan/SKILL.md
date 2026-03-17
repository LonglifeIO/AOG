---
name: aog-security-scan
description: Security-focused code review targeting OWASP Top 10 and common vulnerabilities
compatibility: claude codex gemini cursor
---

# Security Scan

Perform a security-focused review of the specified code.

## Process

1. Read the target code
2. Check for OWASP Top 10 vulnerabilities
3. Check for language/framework-specific security issues
4. Check for credential leaks, injection vectors, auth bypass
5. Produce structured findings

## Output Format

Respond with this JSON:

```json
{
  "risk_level": "critical" | "high" | "medium" | "low" | "clean",
  "vulnerabilities": [
    {
      "id": "SEC-001",
      "severity": "critical" | "high" | "medium" | "low",
      "category": "injection" | "auth" | "xss" | "crypto" | "config" | "data-exposure" | "other",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "SQL injection via unsanitized user input",
      "impact": "What could happen if exploited",
      "remediation": "How to fix it",
      "cwe": "CWE-89"
    }
  ],
  "positive_findings": [
    "Security practices done well"
  ],
  "recommendations": [
    "General security improvements"
  ]
}
```

## Focus Areas

- Input validation and sanitization
- Authentication and authorization
- Cryptographic usage
- Sensitive data exposure
- Dependency vulnerabilities
- Configuration security
