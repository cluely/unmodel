import type { EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import type { AnthropicModelId } from "../../catalog/anthropic.gen";

/** Vision limits source (verified 2026-08-12). */
export const VISION_DOCS = "https://platform.claude.com/docs/en/build-with-claude/vision";
/** Thinking/sampling compatibility source (verified 2026-08-12). */
export const THINKING_DOCS = "https://platform.claude.com/docs/en/build-with-claude/thinking";

/**
 * Claude Opus 4.7+, Opus 4.8, Opus 5, Sonnet 5 and Fable 5 ("Claude 4.7 and
 * later" generations):
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
