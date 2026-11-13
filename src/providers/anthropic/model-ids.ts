/**
 * The per-model id lists the anthropic-messages codec compiles by — and
 * nothing else.
 *
 * Import-free (catalog ids are type-only) because `./interop.ts` decides per
 * target model how to say a unified `reasoning` value, and the codec is part
 * of the provider-free `unmodel/chat/factory` graph, which
 * test/bundle-budget.test.ts pins to the three codecs: reading these lists
 * from `./constraints.ts` would carry its constraint tables into that entry.
 * `./constraints.ts` re-exports everything below, so the validator reads the
 * same single source. A list moves here only when the codec reads it; every
 * other per-model list stays in `./constraints.ts`, beside the rules it drives.
 */
import type { AnthropicModelId } from "../../catalog/anthropic.gen";

/**
 * Claude 4.7 and later — Opus 4.7, Opus 4.8, Opus 5, Opus 5.5, Sonnet 5,
 * Sonnet 5.5, Haiku 5.5, Fable 5, Fable 5.1 and Fable 5.2. Three facts ride on
 * this generation, so the list is the single source for all three:
 *
 * - Sampling parameters were removed. `top_k` rejects ANY value and is denied
 *   in `chatConstraints`; `temperature` (only the default 1.0 accepted) and
 *   `top_p` (only values >= 0.99 accepted) keep backwards-compatible defaults
 *   and are value-checked in checkCapabilities off the catalog's
 *   `temperature: false` flag. Thinking docs: "On Claude Fable 5.2, Claude
 *   Mythos 5.2, Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude
 *   Mythos 5, Claude Mythos Preview, Claude Opus 5.5, Claude Opus 5, Claude
 *   Opus 4.8, Claude Opus 4.7, Claude Sonnet 5.5, Claude Sonnet 5, and Claude
 *   Haiku 5.5, non-default `temperature`, `top_p`, or `top_k` values return a
 *   400 error on every request, regardless of whether thinking is used."
 * - Manual extended thinking was removed: `thinking: {type: "enabled"}` is a
 *   400. Errors page: "Claude 4.7 and later models don't support extended
 *   thinking. Sending `thinking: {"type": "enabled"}` to any of these models
 *   returns a 400 `invalid_request_error`" — `"thinking.type.enabled" is not
 *   supported for this model. Use "thinking.type.adaptive" and
 *   "output_config.effort" to control thinking behavior.`
 * - High-resolution vision tier: up to 4784 visual tokens per image. Vision
 *   docs table: "High-resolution | Claude 4.7 and later models | 2,576 px |
 *   4,784".
 */
export const GEN_4_7_PLUS_MODEL_IDS = [
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-fable-5-2",
  "claude-haiku-5-5",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
] as const satisfies readonly AnthropicModelId[];

/** A Claude 4.7+ model id (see {@link GEN_4_7_PLUS_MODEL_IDS}). */
export type Gen47PlusModelId = (typeof GEN_4_7_PLUS_MODEL_IDS)[number];

/**
 * Models whose lowest thinking setting is `thinking: {type: "between_tools"}`
 * — up-front thinking off, the short updates between tool calls still
 * returned as thinking blocks — and which refuse `disabled`. Thinking docs:
 * "Claude Sonnet 5.5 also has thinking on by default, and it rejects
 * `thinking: {type: "disabled"}` with a 400 error. To turn off up-front
 * thinking, send `thinking: {type: "between_tools"}` instead." and
 * "`between_tools` is accepted at `low`, `medium`, and `high` effort. At
 * `xhigh` or `max` effort, a request with `between_tools` returns a 400
 * error." Every other model refuses the value (errors page: "Sending
 * `thinking: {"type": "between_tools"}` to any model other than Claude Sonnet
 * 5.5 returns a 400 `invalid_request_error`").
 */
export const BETWEEN_TOOLS_MODEL_IDS = ["claude-sonnet-5-5"] as const satisfies readonly AnthropicModelId[];

/** A model id whose thinking-off form is `between_tools`. */
export type BetweenToolsModelId = (typeof BETWEEN_TOOLS_MODEL_IDS)[number];

/** True when `modelId` is one of `ids` or a dated snapshot of one. */
export function isListed(modelId: string, ids: readonly string[]): boolean {
  return ids.some((id) => isModelOrSnapshot(modelId, id));
}

/**
 * True when `modelId` is `base` or a dated snapshot of it (`base-YYYYMMDD`).
 * Every dateless id is itself a pinned snapshot (models overview: "Every
 * Claude model ID is a pinned snapshot, including the dateless IDs used from
 * the 4.6 generation on."), so a `-N` suffix is a different model:
 * `claude-opus-5-5` is not a snapshot of `claude-opus-5`.
 */
function isModelOrSnapshot(modelId: string, base: string): boolean {
  if (modelId === base) return true;
  if (!modelId.startsWith(`${base}-`)) return false;
  return /^\d{8}$/.test(modelId.slice(base.length + 1));
}
