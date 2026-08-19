// Hand-maintained overlay on the generated google catalog — refresh from
//   https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
//   https://ai.google.dev/gemini-api/docs/pricing
//
// Provenance note (2026-08-13): the speech-generation guide's Limitations
// section states "A TTS session has a context window limit of 32k tokens",
// while models.dev carries 8,192 for all three TTS ids. The docs win, so the
// merged catalog below re-states the limit; without this, a 20k-token
// transcript would trip a false over_context error.
//
// Everything else about the TTS entries (pricing, modalities text→audio) is
// already correct in the generated catalog and is deliberately NOT restated.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/google.gen";
import { GEMINI_TTS_CONTEXT_TOKENS, GEMINI_TTS_MODEL_IDS } from "./constraints";

/** Doc-sourced `limit.context` overrides for the Gemini TTS ids. */
export const ttsModelOverrides: Record<string, ModelInfo> = Object.fromEntries(
  GEMINI_TTS_MODEL_IDS.flatMap((id) => {
    const info = models[id];
    // Guard rather than assume: if models.dev ever drops an id, the overlay
    // simply has nothing to override (the endpoint then reports unknown_model).
    if (info === undefined) return [];
    return [[id, { ...info, limit: { ...info.limit, context: GEMINI_TTS_CONTEXT_TOKENS } }]];
  }),
);

/**
 * Catalog consumed by the generateContent validator: the generated google
 * catalog with the doc-sourced TTS context limits layered on top.
 */
export const generateContentModels: Record<string, ModelInfo> = {
  ...models,
  ...ttsModelOverrides,
};
