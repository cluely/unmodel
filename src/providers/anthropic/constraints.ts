import type { EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import type { AnthropicModelId } from "../../catalog/anthropic.gen";

/** Vision limits source (verified 2026-08-12). */
export const VISION_DOCS = "https://platform.claude.com/docs/en/build-with-claude/vision";
/** Thinking/sampling compatibility source (verified 2026-08-12). */
export const THINKING_DOCS = "https://platform.claude.com/docs/en/build-with-claude/thinking";
/** Fable 5.1's per-model departures from the generation (verified 2026-09-02). */
export const FABLE_5_1_DOCS =
  "https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1";

/**
 * Models that removed forced tool use. `tool_choice: {"type": "any"}` and
 * `{"type": "tool", "name": …}` return a 400 `invalid_request_error` (the API
 * message is `tool_choice: type 'tool' and 'any' are not supported for this
 * model`), thinking on or off; `auto` and `none` are unaffected.
 *
 * A list rather than a `chatConstraints` entry because this is a VALUE-level
 * refusal on one param: `deny` would withdraw `tool_choice` entirely and
 * `enums` compares scalars, while `tool_choice` is an object. The documented
 * replacements are `strict: true` on the tool or structured outputs, which is
 * what the message names.
 */
export const FORCED_TOOL_USE_REMOVED_MODEL_IDS = ["claude-fable-5-1"] as const;

/** A model id whose generation refuses `tool_choice` any/tool. */
export type ForcedToolUseRemovedModelId = (typeof FORCED_TOOL_USE_REMOVED_MODEL_IDS)[number];

/**
 * Claude Opus 4.7+, Opus 4.8, Opus 5, Sonnet 5, Fable 5 and Fable 5.1
 * ("Claude 4.7 and later" generations):
 *
 * - Sampling parameters were removed. `top_k` rejects ANY value (API
 *   deprecation note: "any value will be rejected with a 400 error") and is
 *   denied here. `temperature` (only the default 1.0 accepted) and `top_p`
 *   (only values >= 0.99 accepted) keep backwards-compatible defaults and
 *   are value-checked in checkCapabilities off the catalog's
 *   `temperature: false` flag.
 * - These models form the high-resolution vision tier: up to 4784 visual
 *   tokens per image (vs 1568 standard), per the vision docs table.
 */
const GEN_4_7_PLUS: EndpointConstraints = {
  deny: {
    top_k: {
      reason: "`top_k` was removed on this model generation; any value returns a 400.",
      source: THINKING_DOCS,
    },
  },
  imageTokens: 4784,
};

export const chatConstraints = {
  "claude-fable-5": GEN_4_7_PLUS,
  "claude-fable-5-1": GEN_4_7_PLUS,
  "claude-opus-4-7": GEN_4_7_PLUS,
  "claude-opus-4-8": GEN_4_7_PLUS,
  "claude-opus-5": GEN_4_7_PLUS,
  "claude-sonnet-5": GEN_4_7_PLUS,
} satisfies Partial<Record<AnthropicModelId, EndpointConstraints>>;

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
