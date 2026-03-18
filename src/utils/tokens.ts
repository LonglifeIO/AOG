/**
 * Token estimation for debug logging.
 * Enabled via AOG_DEBUG_TOKENS=true environment variable.
 * Estimates: chars / 4 ≈ tokens.
 */

export interface TokenEstimate {
  prompt_chars: number;
  prompt_tokens_est: number;
  response_chars: number;
  response_tokens_est: number;
  instruction_chars: number;
  instruction_tokens_est: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildTokenEstimate(opts: {
  prompt: string;
  response: string;
  instructions?: string;
}): TokenEstimate {
  return {
    prompt_chars: opts.prompt.length,
    prompt_tokens_est: estimateTokens(opts.prompt),
    response_chars: opts.response.length,
    response_tokens_est: estimateTokens(opts.response),
    instruction_chars: opts.instructions?.length ?? 0,
    instruction_tokens_est: estimateTokens(opts.instructions ?? ""),
  };
}

export function tokenLoggingEnabled(): boolean {
  return process.env.AOG_DEBUG_TOKENS === "true";
}
