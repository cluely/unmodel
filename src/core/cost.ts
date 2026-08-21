import type { ModelCost } from "./catalog-types";

export interface TokenBreakdown {
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens served from provider cache (billed at cacheRead rate). */
  cachedInputTokens?: number;
  /**
   * Input tokens that were AUDIO (billed at the `inputAudio` rate).
   *
   * Same convention as {@link TokenBreakdown.cachedInputTokens}: they are
   * assumed to be **included in** `inputTokens` and are re-rated, not added —
   * subtracted from the text bill and charged at `cost.inputAudio` instead
   * (falling back to `cost.input` when the catalog carries no audio rate, so a
   * provider without one is billed exactly as before rather than for free).
   *
   * The convention is what the providers report: Gemini's
   * `usageMetadata.promptTokensDetails` breaks `promptTokenCount` down by
   * modality — the parts sum to the total, they do not extend it — and the
   * same is true of every audio-capable model in the catalog. Adding instead
   * of re-rating would double-bill every second of audio.
   *
   * Audio rates are 2–20x the text rate on the models that publish both
   * (`gemini-2.5-flash`: $0.30 text, $1.00 audio per 1M), so the difference
   * between re-rating and ignoring it is not a rounding error.
   */
  audioInputTokens?: number;
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
 *
 * Two slices of `inputTokens` are **re-rated rather than added**, because that
 * is how the providers report them: cached tokens are subtracted from the text
 * bill and charged at the cacheRead rate, and audio tokens likewise at the
 * inputAudio rate. `freshInput` is what is left. Returns undefined when no
 * rate is known.
 */
export function computeCostUSD(cost: ModelCost | undefined, tokens: TokenBreakdown): number | undefined {
  if (!cost) return undefined;

  let total = 0;
  let priced = false;

  const cached = tokens.cachedInputTokens ?? 0;
  const audio = tokens.audioInputTokens ?? 0;
  // Both slices come out of the same total, so a response that is entirely
  // cached audio bills once, not twice — and `Math.max` keeps a provider that
  // reports slices summing to more than the total from producing a credit.
  const freshInput = Math.max(0, (tokens.inputTokens ?? 0) - cached - audio);

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
  if (audio > 0) {
    // `?? cost.input`: a model with no published audio rate bills audio at the
    // text rate, which is what ignoring the slice used to do — the fallback
    // keeps this change from making anything cheaper by accident.
    const rate = cost.inputAudio ?? cost.input;
    if (rate !== undefined) {
      total += (audio * rate) / PER_MILLION;
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

declare const unit: unique symbol;

/**
 * A duration in **minutes**, as a type.
 *
 * The problem it solves is specific and already on this repo's record: every
 * call site of {@link computeAudioMinutesCostUSD} converts, and they convert
 * from three different units spelled four different ways (`seconds / 60`,
 * `ms / 60_000`, `ms / 60000`, and one that divides in a local variable a few
 * lines earlier). Omit one divisor and the estimate is 60× — silently, in the
 * one number the whole library exists to make trustworthy. The same class of
 * bug is documented at `src/providers/kling/models.ts`, where a merge "would
 * let the video row win and hand a `perVideoSecond` rate to a caller who meant
 * `perImage` — a 3x-to-24x unit error".
 *
 * A brand rather than a wrapper object: it erases completely, costs nothing at
 * runtime, and still makes `cost(rate, seconds)` — *and* `cost(rate, seconds /
 * 60)`, which is the mistake that actually happens — a compile error, while
 * leaving branded values usable in ordinary arithmetic.
 */
export type Minutes = number & { readonly [unit]: "minutes" };

/** Seconds → {@link Minutes}. The conversion, named once. */
export const minutesFromSeconds = (seconds: number): Minutes => (seconds / 60) as Minutes;

/** Milliseconds → {@link Minutes}. */
export const minutesFromMilliseconds = (ms: number): Minutes => (ms / 60_000) as Minutes;

/**
 * A duration that is **already** in minutes, from a source that says so.
 *
 * The escape hatch for a provider whose response reports minutes directly, and
 * the only way to produce a {@link Minutes} without a conversion — so "I meant
 * minutes" is a written claim at the call site rather than an omission.
 */
export const minutes = (value: number): Minutes => value as Minutes;

/**
 * Costs a duration-billed request (STT) against catalog pricing
 * (USD per minute of audio processed). Returns undefined when no rate is known.
 *
 * Takes {@link Minutes}, not `number`: see that type for why. Callers convert
 * with `minutesFromSeconds` / `minutesFromMilliseconds` / `minutes`.
 */
export function computeAudioMinutesCostUSD(
  cost: ModelCost | undefined,
  minutes: Minutes,
): number | undefined {
  if (cost?.perAudioMinute === undefined) return undefined;
  return minutes * cost.perAudioMinute;
}
