// Hand-maintained supplement — models.dev's mistral snapshot
// (src/catalog/mistral.gen.ts) carries only the `voxtral-*-latest` aliases,
// with no audio pricing and no dated transcription ids. Refresh from
//   https://docs.mistral.ai/models/model-cards/voxtral-mini-transcribe-26-02           (voxtral-mini-2602)
//   https://docs.mistral.ai/models/model-cards/voxtral-mini-transcribe-25-07           (voxtral-mini-2507)
//   https://docs.mistral.ai/models/model-cards/voxtral-small-25-07                     (voxtral-small-2507)
//   https://docs.mistral.ai/models/model-cards/voxtral-mini-transcribe-realtime-26-02  (realtime)
//   https://docs.mistral.ai/inference/pricing                                          (rates)
//   https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription          (endpoint + per-model audio caps)
// Verified 2026-08-13.
//
// Pricing: the docs render EUR by default with a USD toggle; the USD figures
// below are the ones the pages carry alongside each EUR price
// (voxtral-mini-2602 $0.003/min = €0.0026/min, realtime $0.006/min =
// €0.0053/min, voxtral-small-2507 $0.004/min = €0.0035/min audio plus
// $0.10/$0.40 per 1M tokens). voxtral-mini-2507 is absent from the current
// pricing table, so it carries NO cost rather than a guessed one.
//
// `limit.context: 0` for the transcribe-only models — they are not
// token-windowed and the pipeline skips context checks. The real per-request
// bound is the audio length, which `ModelLimit` cannot express; it lives in
// {@link TRANSCRIPTION_MAX_AUDIO_SECONDS} and is enforced by ./transcription.
// voxtral-small keeps its generated 32k context (it is also a chat model).

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/mistral.gen";

/** Shared shape of the transcribe-only Voxtral entries. */
const TRANSCRIBE = {
  family: "voxtral",
  attachment: false,
  reasoning: false,
  toolCall: false,
  temperature: true,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  limit: { context: 0 },
} as const;

/** Dated transcription ids the generated catalog lacks. */
export const transcriptionSupplementModels = {
  "voxtral-mini-2602": {
    ...TRANSCRIBE,
    id: "voxtral-mini-2602",
    name: "Voxtral Mini Transcribe 2",
    releaseDate: "2026-02-04",
    cost: { perAudioMinute: 0.003 },
  },
  "voxtral-mini-2507": {
    ...TRANSCRIBE,
    id: "voxtral-mini-2507",
    name: "Voxtral Mini Transcribe",
    releaseDate: "2025-07-15",
    // Superseded by voxtral-mini-2602 and no longer priced on
    // docs.mistral.ai/inference/pricing — no cost is recorded.
    openWeights: true,
  },
  /**
   * Live transcription: served over the realtime WebSocket API (the Python
   * SDK's `client.audio.realtime.transcribe_stream`), NOT by
   * POST /v1/audio/transcriptions. Catalogued for its metadata and rate;
   * `transcription` rejects it.
   */
  "voxtral-mini-transcribe-realtime-2602": {
    ...TRANSCRIBE,
    id: "voxtral-mini-transcribe-realtime-2602",
    name: "Voxtral Mini Transcribe Realtime",
    releaseDate: "2026-02-04",
    cost: { perAudioMinute: 0.006 },
  },
  /** Dated snapshot of the chat-capable Voxtral Small (also transcribes). */
  "voxtral-small-2507": {
    id: "voxtral-small-2507",
    name: "Voxtral Small",
    family: "voxtral",
    attachment: true,
    reasoning: false,
    toolCall: true,
    temperature: true,
    openWeights: true,
    releaseDate: "2025-07-15",
    modalities: { input: ["text", "audio"], output: ["text"] },
    limit: { context: 32_000, output: 32_000 },
    cost: { perAudioMinute: 0.004, input: 0.1, output: 0.4 },
  },
} as const satisfies Record<string, ModelInfo>;

export type MistralTranscriptionSupplementModelId = keyof typeof transcriptionSupplementModels;

/**
 * Catalog used by the `transcription` validator: the full generated mistral
 * catalog, plus audio pricing supplemented onto the `-latest` aliases the
 * transcription endpoint documents, plus the dated ids above. If the generated
 * file ever grows real audio pricing, drop these overrides — they would shadow
 * it.
 *
 * `voxtral-mini-latest` "runs Voxtral Mini Transcribe 2", so it is priced and
 * capped identically to `voxtral-mini-2602`.
 */
export const transcriptionModels: Record<string, ModelInfo> = {
  ...models,
  "voxtral-mini-latest": {
    ...models["voxtral-mini-latest"],
    cost: { perAudioMinute: 0.003 },
  },
  "voxtral-small-latest": {
    ...models["voxtral-small-latest"],
    cost: { ...models["voxtral-small-latest"].cost, perAudioMinute: 0.004, output: 0.4 },
  },
  ...transcriptionSupplementModels,
};

/**
 * Per-model audio-length caps for POST /v1/audio/transcriptions, in seconds.
 * The offline-transcription FAQ ("What's the maximum audio length?") states
 * "Transcription: ≈15 minutes for Voxtral Mini Transcribe and Voxtral Small,
 * and ≈3 hours for Voxtral Mini Transcribe 2". They are approximate by the
 * docs' own wording, so they are enforced as documented limits, not as exact
 * server behaviour.
 */
export const TRANSCRIPTION_MAX_AUDIO_SECONDS: Readonly<Record<string, number>> = {
  "voxtral-mini-latest": 3 * 60 * 60,
  "voxtral-mini-2602": 3 * 60 * 60,
  "voxtral-mini-2507": 15 * 60,
  "voxtral-small-latest": 15 * 60,
  "voxtral-small-2507": 15 * 60,
};

/**
 * Model ids POST /v1/audio/transcriptions accepts. The endpoint docs name
 * `voxtral-mini-latest` ("via audio/transcriptions"), the OpenAPI examples add
 * `voxtral-mini-2507`, and the max-audio-length FAQ covers the Voxtral Small
 * transcription path too.
 */
export const TRANSCRIPTION_MODEL_IDS: readonly string[] = Object.keys(
  TRANSCRIPTION_MAX_AUDIO_SECONDS,
);

/** Realtime (WebSocket) ids that POST /v1/audio/transcriptions cannot serve. */
export const REALTIME_MODEL_IDS: readonly string[] = ["voxtral-mini-transcribe-realtime-2602"];
