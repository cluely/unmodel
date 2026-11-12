// Hand-maintained catalog for `google.tts` — refresh from
//   https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
//   https://ai.google.dev/gemini-api/docs/pricing
//
// HAND ROWS, not an overlay on the generated catalog, and the difference is a
// bundle rule rather than a preference: `src/catalog/google.gen.ts` is ~90 KiB
// and `unmodel/tts`'s budget asserts the pack reaches ZERO generated catalogs
// (test/bundle-budget.test.ts). Five models cannot justify that, so the rows
// are written out here — and `tts-models.test.ts` compares the three models.dev
// carries field-for-field against `google.gen`, so "hand-written" cannot
// quietly mean "out of date".
//
// The ONE deliberate difference on those three is `limit.context`. The
// speech-generation guide's Limitations section stated "A TTS session has a
// context window limit of 32k tokens", while models.dev carries 8,192 for all
// three ids. The docs win: without the correction a 20k-token transcript would
// trip a false over_context error. The drift test asserts BOTH halves — that
// the hand rows say 32768 and that the generated rows still say 8192 — so the
// day models.dev is fixed, the correction stops being real and the test says
// so.
//
// The Gemini 3.8 TTS pair is not in models.dev at all (verified 2026-11-12), so
// those two rows are transcribed from their model pages and the pricing page,
// and carry the pages' own "Input token limit 8,192" rather than the 32k
// correction — the sentence that correction cites is no longer on the
// speech-generation page, and a number without a current quote does not exist.
//
// `google.chat` serves the same ids through `./chat-tts-overlay.ts`, which
// applies the context correction to the generated rows and mirrors the 3.8
// pair from here; that module stays an overlay because a chat body may name
// any catalogued model and therefore needs the whole table.

import type { ModelInfo } from "../../core/catalog-types";
import { GEMINI_TTS_CONTEXT_TOKENS } from "./tts-constraints";

/**
 * "Input token limit 8,192 / Output token limit 16,384 (Gemini API serving
 * limit)" — both Gemini 3.8 TTS model pages, 2026-11-12.
 */
const GEMINI_38_TTS_LIMIT = { context: 8192, output: 16384 } as const;

/**
 * The five Gemini TTS rows.
 *
 * `as const satisfies`, not `: Record<string, ModelInfo>` — the annotation
 * type-checks the rows exactly the same way and then erases every one of them:
 * `keyof` collapses to `string` and `reasoning` / `temperature` widen to
 * `boolean`, so the per-model arms in ./tts ("the ids whose `reasoning` is
 * false take no thinkingConfig") become underivable. `satisfies` keeps the
 * check and the literals both.
 */
export const ttsModels = {
  /**
   * https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts (2026-11-12):
   * the limits above; Thinking carries a not-supported badge (`reasoning:
   * false`); 130+ languages. Pricing (pricing page, 2026-11-12): $0.50 per 1M
   * text input; "$9.00 (audio) through December 31, 2026. $18.00 (audio)
   * starting January 1, 2027." — the rate below is the one in force today and
   * must move on 2027-01-01. Deprecations: "September 22, 2026 — No shutdown
   * date announced". Named replacement for the three preview TTS ids.
   */
  "gemini-3.8-flash-tts": {
    id: "gemini-3.8-flash-tts",
    name: "Gemini 3.8 Flash TTS",
    family: "gemini-flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-09-22",
    lastUpdated: "2026-09-22",
    modalities: { input: ["text"], output: ["audio"] },
    limit: GEMINI_38_TTS_LIMIT,
    cost: { input: 0.5, output: 9 },
  },
  /**
   * https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts (2026-11-12):
   * the same limits; 101 languages. Pricing (pricing page, 2026-11-12): $0.50
   * per 1M text input; "$6.00 (audio) through December 31, 2026. $12.00
   * (audio) starting January 1, 2027." — must move on 2027-01-01. Changelog:
   * "Fast, cost-efficient TTS model built to replace
   * `gemini-3.1-flash-tts-preview` for high-throughput production and
   * real-time voice agent cascades."
   */
  "gemini-3.8-flash-lite-tts": {
    id: "gemini-3.8-flash-lite-tts",
    name: "Gemini 3.8 Flash-Lite TTS",
    family: "gemini-flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-09-22",
    lastUpdated: "2026-09-22",
    modalities: { input: ["text"], output: ["audio"] },
    limit: GEMINI_38_TTS_LIMIT,
    cost: { input: 0.5, output: 6 },
  },
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

/** One of the five Gemini TTS model ids. */
export type GoogleTtsModelId = keyof typeof ttsModels;
