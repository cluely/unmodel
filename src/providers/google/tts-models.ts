// Hand-maintained catalog for `google.tts` — refresh from
//   https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
//   https://ai.google.dev/gemini-api/docs/pricing
//
// HAND ROWS, not an overlay on the generated catalog, and the difference is a
// bundle rule rather than a preference: `src/catalog/google.gen.ts` is ~90 KiB
// and `unmodel/tts`'s budget asserts the pack reaches ZERO generated catalogs
// (test/bundle-budget.test.ts). Three models cannot justify that, so the three
// rows are written out here — and `tts-models.test.ts` compares them
// field-for-field against `google.gen`, so "hand-written" cannot quietly mean
// "out of date".
//
// The ONE deliberate difference is `limit.context`. The speech-generation
// guide's Limitations section states "A TTS session has a context window limit
// of 32k tokens", while models.dev carries 8,192 for all three ids. The docs
// win: without the correction a 20k-token transcript would trip a false
// over_context error. The drift test asserts BOTH halves — that the hand rows
// say 32768 and that the generated rows still say 8192 — so the day models.dev
// is fixed, the correction stops being real and the test says so.
//
// `google.chat` makes the same correction, for the same reason, through
// `./chat-tts-overlay.ts`; that module stays an overlay because a chat body may
// name any of the 38 catalogued models and therefore needs the whole table.

import type { ModelInfo } from "../../core/catalog-types";
import { GEMINI_TTS_CONTEXT_TOKENS } from "./tts-constraints";

/**
 * The three Gemini TTS rows.
 *
 * `as const satisfies`, not `: Record<string, ModelInfo>` — the annotation
 * type-checks the rows exactly the same way and then erases every one of them:
 * `keyof` collapses to `string` and `reasoning` / `temperature` widen to
 * `boolean`, so the per-model arms in ./tts ("the ids whose `reasoning` is
 * false take no thinkingConfig") become underivable. `satisfies` keeps the
 * check and the literals both.
 */
export const ttsModels = {
  "gemini-2.5-flash-preview-tts": {
    id: "gemini-2.5-flash-preview-tts",
    name: "Gemini 2.5 Flash Preview TTS",
    family: "gemini-flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    temperature: true,
    openWeights: false,
    knowledge: "2025-01",
    releaseDate: "2025-05-01",
    lastUpdated: "2025-05-01",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: GEMINI_TTS_CONTEXT_TOKENS, output: 16384 },
    cost: { input: 0.5, output: 10 },
  },
  "gemini-2.5-pro-preview-tts": {
    id: "gemini-2.5-pro-preview-tts",
    name: "Gemini 2.5 Pro Preview TTS",
    family: "gemini-flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    temperature: true,
    openWeights: false,
    knowledge: "2025-01",
    releaseDate: "2025-05-01",
    lastUpdated: "2025-05-01",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: GEMINI_TTS_CONTEXT_TOKENS, output: 16384 },
    cost: { input: 1, output: 20 },
  },
  "gemini-3.1-flash-tts-preview": {
    id: "gemini-3.1-flash-tts-preview",
    name: "Gemini 3.1 Flash TTS Preview",
    family: "gemini-flash",
    attachment: false,
    // The one capability that differs across the three: 3.1 is the reasoning
    // TTS model, so it is the only arm in ./tts that takes a thinkingConfig.
    reasoning: true,
    toolCall: false,
    temperature: true,
    openWeights: false,
    knowledge: "2025-01",
    releaseDate: "2026-04-15",
    lastUpdated: "2026-04-15",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: GEMINI_TTS_CONTEXT_TOKENS, output: 16384 },
    cost: { input: 1, output: 20 },
  },
} as const satisfies Record<string, ModelInfo>;

/** One of the three Gemini TTS model ids. */
export type GoogleTtsModelId = keyof typeof ttsModels;
