import type { CostInfo } from "../agents/types.js";

export function parseClaudeOutput(stdout: string): {
  result: string;
  sessionId: string | null;
  cost: CostInfo;
  isError: boolean;
} {
  try {
    const parsed = JSON.parse(stdout);
    return {
      result: parsed.result ?? "",
      sessionId: parsed.session_id ?? null,
      cost: { usd: parsed.total_cost_usd ?? null, tokens_in: null, tokens_out: null },
      isError: parsed.is_error ?? false,
    };
  } catch {
    return { result: stdout, sessionId: null, cost: { usd: null, tokens_in: null, tokens_out: null }, isError: false };
  }
}

export function parseCodexOutput(stdout: string): {
  result: string;
  threadId: string | null;
  cost: CostInfo;
} {
  const lines = stdout.trim().split("\n").filter(Boolean);
  let finalText = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let threadId: string | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "turn.completed" && event.usage) {
        tokensIn += event.usage.input_tokens ?? 0;
        tokensOut += event.usage.output_tokens ?? 0;
      }
      if (event.type === "item.completed" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) finalText += block.text;
        }
      }
      if (event.threadId) threadId = event.threadId;
    } catch {
      finalText += line;
    }
  }

  return { result: finalText, threadId, cost: { usd: null, tokens_in: tokensIn || null, tokens_out: tokensOut || null } };
}

export function parseGeminiOutput(stdout: string): {
  result: string;
  cost: CostInfo;
} {
  try {
    const parsed = JSON.parse(stdout);
    let tokensIn = 0;
    let tokensOut = 0;

    if (parsed.stats?.models) {
      for (const modelStats of Object.values(parsed.stats.models) as Array<Record<string, unknown>>) {
        const tokens = modelStats.tokens as Record<string, number> | undefined;
        if (tokens) {
          tokensIn += tokens.prompt ?? 0;
          tokensOut += tokens.candidates ?? 0;
        }
      }
    }

    return { result: parsed.response ?? "", cost: { usd: null, tokens_in: tokensIn || null, tokens_out: tokensOut || null } };
  } catch {
    return { result: stdout, cost: { usd: null, tokens_in: null, tokens_out: null } };
  }
}

/**
 * Sanitize agent output before passing to another agent.
 * Strips prompt injection patterns, model-specific delimiters, and secret leaks.
 */
export function sanitizeInterAgentOutput(text: string): string {
  return text
    // XML/HTML injection
    .replace(/<system>[\s\S]*?<\/system>/gi, "[REDACTED]")
    .replace(/<instructions>[\s\S]*?<\/instructions>/gi, "[REDACTED]")
    // Llama/Mistral instruction delimiters
    .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, "[REDACTED]")
    // Anthropic turn delimiters
    .replace(/(?:^|\n)\s*(?:Human|User)\s*:[\s\S]*?(?:Assistant|AI)\s*:/gi, "[REDACTED]")
    // Tool call XML tags (Claude, generic)
    .replace(/<\/?(?:tool_call|tool_use|tool_result|function_calls|antml_invoke|output)[^>]*>/gi, "[REDACTED]")
    // Broad "ignore/forget previous" — catches with or without IMPORTANT: prefix
    .replace(/(?:ignore|forget|disregard|override)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|context|rules|prompts|directives)/gi, "[REDACTED]")
    // Identity override attempts
    .replace(/(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as)\s+/gi, "[REDACTED]")
    // SYSTEM: prefix injection
    .replace(/(?:^|\n)\s*SYSTEM\s*:/gi, "[REDACTED]")
    // Secret/credential variable interpolation
    .replace(/\$\{?\w*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)\w*\}?/gi, "[REDACTED]");
}
