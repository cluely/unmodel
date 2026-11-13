import type { EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import type { AnthropicModelId } from "../../catalog/anthropic.gen";
import { GEN_4_7_PLUS_MODEL_IDS } from "./model-ids";
import type { Gen47PlusModelId } from "./model-ids";

export * from "./model-ids";

/** Vision limits source (verified 2026-11-12). */
export const VISION_DOCS = "https://platform.claude.com/docs/en/build-with-claude/vision";
/** Thinking/sampling compatibility source (verified 2026-11-12). */
export const THINKING_DOCS = "https://platform.claude.com/docs/en/build-with-claude/thinking";
/** The documented 400s, with their exact messages, per model generation (verified 2026-11-12). */
export const ERRORS_DOCS = "https://platform.claude.com/docs/en/api/errors";
/** Fast mode: supported models, beta headers, premium rates (verified 2026-11-12). */
export const FAST_MODE_DOCS = "https://platform.claude.com/docs/en/build-with-claude/fast-mode";
/** Pricing page, including the prompt-length tiers (verified 2026-11-12). */
export const PRICING_DOCS = "https://platform.claude.com/docs/en/about-claude/pricing";

// ---------------------------------------------------------------------------
// Per-model id lists. Each is a VALUE-level or shape-level refusal that the
// generic `deny`/`enums` tables cannot express (`deny` withdraws a param
// entirely, `enums` compares top-level scalars), keyed by exact catalog id;
// `isListed` extends every list to dated snapshots (`<id>-YYYYMMDD`). The
// Mythos ids (claude-mythos-5-1, claude-mythos-5-2) share every rule below but
// are limited-availability ids absent from models.dev, so they are not listed:
// an uncataloged id is never refused. The lists the codec also reads —
// `GEN_4_7_PLUS_MODEL_IDS`, `BETWEEN_TOOLS_MODEL_IDS` — and `isListed` live in
// ./model-ids.ts and are re-exported above.
// ---------------------------------------------------------------------------

/**
 * Models that removed forced tool use. `tool_choice: {"type": "any"}` and
 * `{"type": "tool", "name": …}` return a 400 `invalid_request_error`, thinking
 * on or off and on the token-counting endpoint too; `auto` and `none` are
 * unaffected. Errors page: "Claude Fable 5.2, Claude Mythos 5.2, Claude Opus
 * 5.5, Claude Sonnet 5.5, Claude Fable 5.1, and Claude Mythos 5.1 don't
 * support forced tool use." — `tool_choice: type "tool" and "any" are not
 * supported for this model.` Haiku 5.5 is not in that list and keeps forced
 * tool use. The documented replacements are `strict: true` on the tool or
 * structured outputs, which is what the message names.
 */
export const FORCED_TOOL_USE_REMOVED_MODEL_IDS = [
  "claude-fable-5-1",
  "claude-fable-5-2",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
] as const satisfies readonly AnthropicModelId[];

/** A model id whose generation refuses `tool_choice` any/tool. */
export type ForcedToolUseRemovedModelId = (typeof FORCED_TOOL_USE_REMOVED_MODEL_IDS)[number];

/**
 * Adaptive thinking is always on: `thinking: {type: "disabled"}` returns a
 * 400 at every effort level. Thinking docs: "Claude Fable 5.2, Claude Mythos
 * 5.2, Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5,
 * Claude Opus 5.5, and Claude Mythos Preview reject `thinking: {type:
 * "disabled"}`. Thinking can't be turned off on these models." Effort docs on
 * Opus 5.5: "Requests that set `thinking: {"type": "disabled"}` return a 400
 * error at every effort level." The API message: `"thinking.type.disabled" is
 * not supported for this model. Use "thinking.type.adaptive" and
 * "output_config.effort" to control thinking behavior.`
 */
export const THINKING_ALWAYS_ON_MODEL_IDS = [
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-fable-5-2",
  "claude-opus-5-5",
] as const satisfies readonly AnthropicModelId[];

/** A model id that refuses `thinking: {type: "disabled"}` outright. */
export type ThinkingAlwaysOnModelId = (typeof THINKING_ALWAYS_ON_MODEL_IDS)[number];

/**
 * Models that support only manual extended thinking: `thinking: {type:
 * "adaptive"}` is a 400. Errors page: "Models that support only extended
 * thinking (Claude 4.5 and earlier models) reject `thinking: {"type":
 * "adaptive"}` with a 400 `invalid_request_error`" — `adaptive thinking is not
 * supported on this model` — and "Use `thinking: {"type": "enabled",
 * "budget_tokens": N}` on these models". Thinking docs table: Claude Opus 4.5,
 * Sonnet 4.5 and Haiku 4.5 each read "400 error" in the `"adaptive"` column.
 * The dated ids are listed as well as the aliases: `isListed` would cover them
 * at run time, but the compile-time arm keys on exact catalog ids.
 */
export const EXTENDED_THINKING_ONLY_MODEL_IDS = [
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
] as const satisfies readonly AnthropicModelId[];

/** A model id that refuses `thinking: {type: "adaptive"}`. */
export type ExtendedThinkingOnlyModelId = (typeof EXTENDED_THINKING_ONLY_MODEL_IDS)[number];

/**
 * Models that accept `thinking: {type: "disabled"}` at `output_config.effort`
 * high or below only; `xhigh` and `max` return a 400. Thinking docs: "Claude
 * Haiku 5.5 also has thinking on by default and accepts `thinking: {type:
 * "disabled"}` at effort `high` or below. At `xhigh` or `max` effort, that
 * combination returns a 400 error." and, for Opus 5: "On Claude Opus 5,
 * thinking is on by default and `thinking: {"type": "disabled"}` is accepted
 * at effort `high` or below." The API message: `output_config.effort 'xhigh'
 * is not supported when thinking is disabled on this model. Use effort 'high'
 * or below, or enable thinking.`
 */
export const THINKING_OFF_CAPPED_AT_HIGH_MODEL_IDS = [
  "claude-haiku-5-5",
  "claude-opus-5",
] as const satisfies readonly AnthropicModelId[];

/**
 * Claude 4.6 and later: a trailing assistant message (response prefill) is a
 * 400 whether or not thinking is on. Errors page: "Claude 4.6 and later models
 * and Claude Mythos Preview do not support prefilling assistant messages." —
 * `This model does not support assistant message prefill. The conversation
 * must end with a user message.` Earlier models refuse prefill only while
 * thinking is on, which the wire schema enforces for every model.
 */
export const PREFILL_REMOVED_MODEL_IDS = [
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-fable-5-2",
  "claude-haiku-5-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
] as const satisfies readonly AnthropicModelId[];

/**
 * Models that take computer use only through the `computer_toolset_20260801`
 * tool on the Claude API. Errors page: "Claude Fable 5.2, Claude Mythos 5.2,
 * Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 5.5 return a 400 error
 * for any computer use tool version they don't accept. On the Claude API,
 * that includes `computer_20251124` with its beta header. They don't accept
 * `computer_20250124` on any platform." — `'claude-opus-5-5' does not support
 * tool types: computer_20251124.` Amazon Bedrock still accepts
 * `computer_20251124` with its beta header, so this is an `anthropic.chat`
 * rule, not a shared Claude battery.
 */
export const COMPUTER_TOOLSET_ONLY_MODEL_IDS = [
  "claude-fable-5-2",
  "claude-haiku-5-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
] as const satisfies readonly AnthropicModelId[];

/** The computer-use tool types those models return a 400 for. */
export const REMOVED_COMPUTER_TOOL_TYPES: readonly string[] = ["computer_20251124", "computer_20250124"];

/**
 * Models that serve `speed: "fast"` (fast mode). GA with no beta header on
 * Fable 5.2 and Opus 5.5; Opus 5 (research preview) and Opus 4.8 (deprecated)
 * need the `fast-mode-2026-02-01` anthropic-beta header, which this validator
 * cannot see and therefore does not require. Fast-mode docs: "Fast mode is
 * available on Claude Fable 5.2, Claude Mythos 5.2, and Claude Opus 5.5. Fast
 * mode is in research preview on Claude Opus 5 and deprecated on Claude Opus
 * 4.8." and "Requesting `speed: "fast"` on a model that doesn't support fast
 * mode returns an error". Opus 4.8's removal date is November 30, 2026:
 * "After removal, requests to `claude-opus-4-8` with `speed: "fast"` will
 * return an error."
 */
export const FAST_MODE_MODEL_IDS = [
  "claude-fable-5-2",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
] as const satisfies readonly AnthropicModelId[];

/**
 * `speed: "fast"` is accepted but has no effect. Fast-mode docs: "Claude Opus
 * 4.6 is an exception: instead of returning an error, a request with `speed:
 * "fast"` and the `fast-mode-2026-02-01` beta header succeeds, but runs at
 * standard speed. In this situation, `usage.speed` shows `"standard"`."
 * Reported as a warning, like an `ignored` deny rule: the API fulfils the
 * request.
 */
export const FAST_MODE_IGNORED_MODEL_IDS = ["claude-opus-4-6"] as const satisfies readonly AnthropicModelId[];

/** A model id on which `speed: "fast"` is accepted (served or silently standard). */
export type FastModeModelId =
  | (typeof FAST_MODE_MODEL_IDS)[number]
  | (typeof FAST_MODE_IGNORED_MODEL_IDS)[number];

/**
 * Models priced by prompt length. The catalog row carries the rates for
 * prompts up to {@link PROMPT_LENGTH_TIER_THRESHOLD} tokens; above it every
 * rate is different and `ModelCost` has no tier field, so estimates and
 * `checkChat` return no `costUSD` there rather than a number 5x too low.
 * Pricing page: "Claude Haiku 5.5 is priced by prompt length: a request whose
 * prompt is over 100,000 tokens pays higher prices. A request's prompt length
 * counts all of its input tokens, including cache reads and cache writes."
 * and "| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok |
 * $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |".
 */
export const PROMPT_LENGTH_TIERED_MODEL_IDS = ["claude-haiku-5-5"] as const satisfies readonly AnthropicModelId[];

/** Prompt tokens (input + cache reads + cache writes) above which the catalog rates no longer apply. */
export const PROMPT_LENGTH_TIER_THRESHOLD = 100_000;

// ---------------------------------------------------------------------------
// Constraint tables
// ---------------------------------------------------------------------------

const GEN_4_7_PLUS: EndpointConstraints = {
  deny: {
    top_k: {
      reason: "`top_k` was removed on this model generation; any value returns a 400.",
      source: THINKING_DOCS,
    },
  },
  imageTokens: 4784,
};

/** The deny table: one `GEN_4_7_PLUS` row per Claude 4.7+ id. */
export const chatConstraints = Object.fromEntries(
  GEN_4_7_PLUS_MODEL_IDS.map((id) => [id, GEN_4_7_PLUS]),
) as Record<Gen47PlusModelId, EndpointConstraints>;

/**
 * Image limits from the vision docs, identical across all Claude models:
 * JPEG/PNG/GIF/WebP only, at most 8000x8000 px, and at most 10 MB
 * base64-encoded per image on the Claude API (`maxBytes` is compared against
 * the base64 payload size, matching how the docs state the limit).
 * `imageTokens` is the standard-tier per-image visual-token cap (1568);
 * high-resolution models override it to 4784 via their per-model
 * constraints above.
 */
export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "Claude models",
    match: (modelId) => modelId.startsWith("claude"),
    media: {
      image: {
        maxBytes: 10 * 1024 * 1024,
        maxWidth: 8000,
        maxHeight: 8000,
        formats: ["jpeg", "png", "gif", "webp"],
      },
    },
    imageTokens: 1568,
  },
];
