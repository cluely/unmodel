import type { ModelCost } from "./catalog-types";

export interface TokenBreakdown {
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens served from provider cache (billed at cacheRead rate). */
  cachedInputTokens?: number;
  /** Tokens written to provider cache (billed at cacheWrite rate). */
  cacheWriteTokens?: number;
  /**
   * Reasoning tokens. Only billed when the catalog carries a distinct
   * reasoning rate — most providers already count these inside outputTokens.
   */
  reasoningTokens?: number;
}

const PER_MILLION = 1_000_000;

/**
 * Costs a token breakdown against catalog pricing (USD per 1M tokens).
 * Cached input tokens are assumed to be included in `inputTokens` and are
 * re-rated: they are subtracted from the input bill and charged at the
 * cacheRead rate instead. Returns undefined when no rate is known.
 */
export function computeCostUSD(cost: ModelCost | undefined, tokens: TokenBreakdown): number | undefined {
  if (!cost) return undefined;

  let total = 0;
  let priced = false;

  const cached = tokens.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, (tokens.inputTokens ?? 0) - cached);

  if (cost.input !== undefined && tokens.inputTokens !== undefined) {
    total += (freshInput * cost.input) / PER_MILLION;
    priced = true;
  }
  if (cached > 0) {
    const rate = cost.cacheRead ?? cost.input;
    if (rate !== undefined) {
      total += (cached * rate) / PER_MILLION;
      priced = true;
    }
  }
  if (cost.cacheWrite !== undefined && tokens.cacheWriteTokens) {
    total += (tokens.cacheWriteTokens * cost.cacheWrite) / PER_MILLION;
    priced = true;
  }
  if (cost.output !== undefined && tokens.outputTokens !== undefined) {
    total += (tokens.outputTokens * cost.output) / PER_MILLION;
    priced = true;
  }
  if (tokens.reasoningTokens && cost.reasoning !== undefined) {
    total += (tokens.reasoningTokens * cost.reasoning) / PER_MILLION;
    priced = true;
  }

  return priced ? total : undefined;
}

/**
 * Costs a character-billed request (TTS) against catalog pricing
 * (USD per 1M input characters). Returns undefined when no rate is known.
 */
export function computeCharacterCostUSD(
  cost: ModelCost | undefined,
  characters: number,
): number | undefined {
  if (cost?.perMillionCharacters === undefined) return undefined;
  return (characters * cost.perMillionCharacters) / PER_MILLION;
}

/**
 * Costs a duration-billed request (STT) against catalog pricing
 * (USD per minute of audio processed). Returns undefined when no rate is known.
 */
export function computeAudioMinutesCostUSD(
  cost: ModelCost | undefined,
  minutes: number,
): number | undefined {
  if (cost?.perAudioMinute === undefined) return undefined;
  return minutes * cost.perAudioMinute;
}
