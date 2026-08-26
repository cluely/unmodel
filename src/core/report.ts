import type { Issue } from "./issues";

export interface UsageReport {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
}

/**
 * Returned by the post-generation `check*` functions. Never throws.
 *
 * `Reason` is the provider's own stop-reason / job-status vocabulary, so
 * `report.finishReason === "` completes the values that endpoint can actually
 * return instead of offering nothing. Each provider's checker declares its own
 * alias (`AnthropicStopReason`, `ChatFinishReason`, `GoogleFinishReason`, …)
 * and returns `ResponseReport<ThatAlias>`.
 *
 * `string | number` because a vocabulary is whatever the provider publishes,
 * and not every provider publishes words: MiniMax's in-band envelope answers
 * `base_resp.status_code: 1004`, so a `string`-only constraint locked the one
 * provider whose route reports every outcome in band out of the field that
 * exists to carry it. A numeric reason makes `finishReason` falsy on success
 * (`0`), so callers branch on `!== 0`, never on truthiness.
 *
 * The parameter DEFAULTS to `string`, which is what keeps every existing
 * annotation source-compatible: a narrowed report is still assignable to a
 * bare `ResponseReport`, and `const x: string | undefined = r.finishReason`
 * still compiles. Widening the field back to `string` on any checker is a
 * regression — it deletes the completions, which is the whole point.
 */
export interface ResponseReport<Reason extends string | number = string> {
  warnings: Issue[];
  finishReason?: Reason;
  usage: UsageReport;
  /** Actual cost in USD priced from catalog rates; undefined if the model is unknown. */
  costUSD?: number;
}
