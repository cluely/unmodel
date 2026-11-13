// Hand-maintained supplement to the generated google catalog for `google.stt` —
// the transcription ids models.dev does not carry; refresh from
//   https://ai.google.dev/gemini-api/docs/transcribe              (model ids, REST samples)
//   https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe
//   https://ai.google.dev/gemini-api/docs/pricing                 (per-token / per-minute rates)
//
// The generated catalog stays the source for every mainline Gemini row (see the
// header of ./stt.ts); this file adds only what models.dev lacks, and
// `stt.test.ts` asserts each id here stays absent from the generated file so
// a hand row cannot silently shadow a generated one.
//
// `as const satisfies`, so the per-model arms in ./stt derive from these rows
// exactly as they do from the generated ones (the `reasoning: false` below is
// what types `thinkingConfig` as `never` on the transcribe arm).

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/google.gen";

/** Transcription ids the generated google catalog lacks. */
export const sttSupplementModels = {
  /**
   * https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe (2026-11-12):
   * "Up to 1 hour per request (up to 30 minutes when speaker diarization or
   * word-level timestamps are enabled)"; 85+ languages; diarization up to 8
   * speakers; custom vocabulary up to 1,000 terms; Thinking, context caching,
   * Batch, Flex and Priority carry not-supported badges — hence `reasoning:
   * false` and no `cacheRead`. The page carries no Structured outputs badge
   * either way (re-read 2026-11-13), so `structuredOutput` is absent — the
   * tri-state "no answer", matching models.dev's vercel row for the same id,
   * which carries no `structured_output` field. The transcribe guide's REST
   * sample: `curl -X POST ".../v1beta/models/gemini-3.5-transcribe:generateContent"`.
   *
   * Pricing (pricing page, 2026-11-12): "$2.00 or $0.003/min (audio)" input,
   * "$12.00 or $0.002/min (text)" output. The page prices INPUT as audio only,
   * so the row carries `inputAudio` and no text `input` rate: a text prompt
   * beside the audio is left unpriced rather than billed at a rate no page
   * states. Changelog: "Gemini 3.5 Transcribe (`gemini-3.5-transcribe`):
   * High-accuracy, low-latency non-streaming speech-to-text".
   *
   * `limit.context: 0` — the pages state the cap as audio duration, not tokens
   * (HAND_CATALOGS.md rule), so the pipeline's context-window check is skipped.
   * The 1-hour / 30-minute bound is `checkTranscribeDuration` in ./stt — a
   * WARNING, because the guide says over-long audio "is truncated at the
   * limit while still returning a completed response"; the audio MediaRule
   * there carries only the generic 9.5-hour cap.
   */
  "gemini-3.5-transcribe": {
    id: "gemini-3.5-transcribe",
    name: "Gemini 3.5 Transcribe",
    family: "gemini-flash",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-08-26",
    lastUpdated: "2026-08-26",
    modalities: { input: ["text", "audio"], output: ["text"] },
    limit: { context: 0 },
    cost: { output: 12, inputAudio: 2 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Catalog used by the transcription validator: the full generated google
 * catalog plus the hand rows above. `as const satisfies` for the reason in
 * ./chat-tts-overlay: an annotation would erase the literals the per-model
 * arms are derived from.
 */
export const sttModels = {
  ...models,
  ...sttSupplementModels,
} as const satisfies Record<string, ModelInfo>;

/** Hand-supplemented transcription ids. */
export type GoogleSttSupplementModelId = keyof typeof sttSupplementModels;
