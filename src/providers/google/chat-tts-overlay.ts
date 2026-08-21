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

/**
 * The three TTS rows as this overlay states them — the generated row with the
 * doc-sourced context limit substituted.
 *
 * Keys are OPTIONAL because the loop below guards: the type says exactly what
 * the guard does, so `chatModels` types those three ids as "the generated row
 * or the overridden one" instead of pretending it knows which. A required
 * mapped type here would be the lie — `Record<string, ModelInfo>` was merely
 * the erasure.
 */
type TtsModelOverrides = {
  readonly [Id in (typeof GEMINI_TTS_MODEL_IDS)[number]]?: Omit<ModelInfo, "limit"> & {
    limit: Omit<ModelInfo["limit"], "context"> & { context: typeof GEMINI_TTS_CONTEXT_TOKENS };
  };
};

/** Doc-sourced `limit.context` overrides for the Gemini TTS ids. */
export const ttsModelOverrides: TtsModelOverrides = Object.fromEntries(
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
 *
 * `as const satisfies`, not `: Record<string, ModelInfo>` — the annotation
 * type-checks exactly the same rows and then erases every one of them: `keyof`
 * collapses to `string` and each row's `reasoning` / `toolCall` /
 * `temperature` / `modalities` flags widen to their base types, so a per-model
 * type derived from this table ("the ids whose `reasoning` is false") is not
 * merely imprecise, it is underivable. `satisfies` keeps the check and the
 * literals both.
 *
 * The three TTS ids type as a UNION of the generated row and the overridden
 * one, because `ttsModelOverrides` declares optional keys — which is the same
 * thing its guard does at run time. That is deliberately not tightened by
 * re-authoring the three rows as literals here: it would trade a runtime
 * `unknown_model` for a build break the day models.dev drops an id.
 */
export const chatModels = {
  ...models,
  ...ttsModelOverrides,
} as const satisfies Record<string, ModelInfo>;
