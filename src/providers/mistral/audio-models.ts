// Hand-maintained supplement — models.dev's mistral snapshot
// (src/catalog/mistral.gen.ts) carries the `voxtral-*-latest` aliases and
// `voxtral-small-2507`, with no audio pricing, and none of the transcribe-only
// dated ids. Refresh from
//   https://docs.mistral.ai/models/model-cards/voxtral-mini-transcribe-26-02           (voxtral-mini-2602)
//   https://docs.mistral.ai/models/model-cards/voxtral-small-25-07                     (voxtral-small-2507)
//   https://docs.mistral.ai/models/model-cards/voxtral-mini-transcribe-realtime-26-02  (realtime)
//   https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0                         (Voxtral Mini Transcribe 3)
//   https://docs.mistral.ai/models/voxtral-small-transcribe-3-0                        (Voxtral Small Transcribe 3)
//   https://docs.mistral.ai/models/voxtral-mini-transcribe-realtime-3-0                (Voxtral Realtime 3)
//   https://docs.mistral.ai/inference/pricing                                          (rates)
//   https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription          (endpoint + per-model audio caps)
// Verified 2026-08-13; the Voxtral 3 rows and the realtime alias 2026-11-12.
//
// Pricing: the docs render EUR by default with a USD toggle; the USD figures
// below are the ones the pages carry alongside each EUR price
// (voxtral-mini-2602 $0.003/min = €0.0026/min, realtime $0.006/min =
// €0.0053/min, voxtral-small-2507 $0.004/min = €0.0035/min audio plus
// $0.10/$0.40 per 1M tokens).
//
// `limit.context: 0` for the transcribe-only models — they are not
// token-windowed and the pipeline skips context checks. The real per-request
// bound is the audio length, which `ModelLimit` cannot express; it lives in
// {@link TRANSCRIPTION_MAX_AUDIO_SECONDS} and is enforced by ./transcription.
// voxtral-small keeps its generated 32k context (it is also a chat model).
// The Voxtral 3 cards say "Context 32k" while the limits page gives "Context
// window, shared by the audio and context_bias 65,536 tokens"
// (https://docs.mistral.ai/studio/audio/specs-and-limits/limits, 2026-11-12) —
// the two disagree, so those rows stay at 0 too.

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

/**
 * The Voxtral 3 generation: "October 20, 2026 Public Preview"
 * (https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0, 2026-11-12),
 * recorded as `status: "beta"`.
 */
const VOXTRAL_3 = { ...TRANSCRIBE, releaseDate: "2026-10-20", status: "beta" } as const;

const VOXTRAL_MINI_TRANSCRIBE_3 = {
  ...VOXTRAL_3,
  name: "Voxtral Mini Transcribe 3",
  cost: { perAudioMinute: 0.0035 },
} as const;

const VOXTRAL_SMALL_TRANSCRIBE_3 = {
  ...VOXTRAL_3,
  name: "Voxtral Small Transcribe 3",
  cost: { perAudioMinute: 0.004 },
} as const;

const VOXTRAL_MINI_TRANSCRIBE_REALTIME_3 = {
  ...VOXTRAL_3,
  name: "Voxtral Mini Transcribe Realtime 3",
  cost: { perAudioMinute: 0.008 },
} as const;

/** Transcription ids the generated catalog lacks. */
export const transcriptionSupplementModels = {
  "voxtral-mini-2602": {
    ...TRANSCRIBE,
    id: "voxtral-mini-2602",
    name: "Voxtral Mini Transcribe 2",
    releaseDate: "2026-02-04",
    cost: { perAudioMinute: 0.003 },
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
  /**
   * `"names":["voxtral-mini-transcribe-realtime-2602","voxtral-mini-realtime-latest"]`
   * (https://docs.mistral.ai/models/voxtral-mini-transcribe-realtime-26-02,
   * page source, 2026-11-12): the realtime model above, under its alias.
   */
  "voxtral-mini-realtime-latest": {
    ...TRANSCRIBE,
    id: "voxtral-mini-realtime-latest",
    name: "Voxtral Mini Transcribe Realtime",
    releaseDate: "2026-02-04",
    cost: { perAudioMinute: 0.006 },
  },
  /**
   * Voxtral Mini Transcribe 3 — "voxtral-mini-transcribe-3-0 +2 … Price i USD
   * EUR $0.0035 /Min" (https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0,
   * 2026-11-12); pricing page: "Voxtral Mini Transcribe 3 ↗ $0.0035 /Min
   * $0.00035 /Min". Alias array
   * `["voxtral-mini-transcribe-3-0","voxtral-mini-transcribe-3","voxtral-mini-transcribe-latest"]`.
   */
  "voxtral-mini-transcribe-3-0": { ...VOXTRAL_MINI_TRANSCRIBE_3, id: "voxtral-mini-transcribe-3-0" },
  "voxtral-mini-transcribe-3": { ...VOXTRAL_MINI_TRANSCRIBE_3, id: "voxtral-mini-transcribe-3" },
  "voxtral-mini-transcribe-latest": {
    ...VOXTRAL_MINI_TRANSCRIBE_3,
    id: "voxtral-mini-transcribe-latest",
  },
  /**
   * Voxtral Small Transcribe 3 — "voxtral-small-transcribe-3-0 +2 … Price i
   * USD EUR $0.004 /Min"
   * (https://docs.mistral.ai/models/voxtral-small-transcribe-3-0, 2026-11-12);
   * pricing page: "Voxtral Small Transcribe 3 ↗ $0.004 /Min $0.0004 /Min".
   * Alias array
   * `["voxtral-small-transcribe-3-0","voxtral-small-transcribe-3","voxtral-small-transcribe-latest"]`.
   */
  "voxtral-small-transcribe-3-0": {
    ...VOXTRAL_SMALL_TRANSCRIBE_3,
    id: "voxtral-small-transcribe-3-0",
  },
  "voxtral-small-transcribe-3": { ...VOXTRAL_SMALL_TRANSCRIBE_3, id: "voxtral-small-transcribe-3" },
  "voxtral-small-transcribe-latest": {
    ...VOXTRAL_SMALL_TRANSCRIBE_3,
    id: "voxtral-small-transcribe-latest",
  },
  /**
   * Voxtral Mini Transcribe Realtime 3 — "voxtral-mini-transcribe-realtime-3-0
   * +2 … Context i -- Price i USD EUR $0.008 /Min"
   * (https://docs.mistral.ai/models/voxtral-mini-transcribe-realtime-3-0,
   * 2026-11-12); pricing page: "Voxtral Mini Transcribe Realtime 3 ↗ $0.008
   * /Min $0.0008 /Min". A realtime model like the 2602 one above, so `stt`
   * rejects it by name.
   */
  "voxtral-mini-transcribe-realtime-3-0": {
    ...VOXTRAL_MINI_TRANSCRIBE_REALTIME_3,
    id: "voxtral-mini-transcribe-realtime-3-0",
  },
  "voxtral-mini-transcribe-realtime-3": {
    ...VOXTRAL_MINI_TRANSCRIBE_REALTIME_3,
    id: "voxtral-mini-transcribe-realtime-3",
  },
  "voxtral-mini-transcribe-realtime-latest": {
    ...VOXTRAL_MINI_TRANSCRIBE_REALTIME_3,
    id: "voxtral-mini-transcribe-realtime-latest",
  },
} as const satisfies Record<string, ModelInfo>;

export type MistralTranscriptionSupplementModelId = keyof typeof transcriptionSupplementModels;

/**
 * Catalog used by the `transcription` validator: the full generated mistral
 * catalog, plus audio pricing supplemented onto the generated Voxtral rows the
 * transcription endpoint documents, plus the ids above. If the generated file
 * ever grows real audio pricing, drop these overrides — they would shadow it.
 *
 * `voxtral-mini-latest` "runs Voxtral Mini Transcribe 2", so it is priced and
 * capped identically to `voxtral-mini-2602`. The two Voxtral Small ids are one
 * model (`"names":["voxtral-small-2507","voxtral-small-latest"]`), priced
 * "Voxtral Small ↗ $0.004 /Min $0.0004 /Min $0.4 /M Tokens" (pricing page,
 * 2026-11-12); their token rates are the generated ones.
 */
export const transcriptionModels: Record<string, ModelInfo> = {
  ...models,
  "voxtral-mini-latest": {
    ...models["voxtral-mini-latest"],
    cost: { perAudioMinute: 0.003 },
  },
  "voxtral-small-latest": {
    ...models["voxtral-small-latest"],
    cost: { ...models["voxtral-small-latest"].cost, perAudioMinute: 0.004 },
  },
  "voxtral-small-2507": {
    ...models["voxtral-small-2507"],
    cost: { ...models["voxtral-small-2507"].cost, perAudioMinute: 0.004 },
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
  "voxtral-small-latest": 15 * 60,
  "voxtral-small-2507": 15 * 60,
};

/**
 * The Voxtral 3 transcription ids: "model Required. voxtral-mini-transcribe-3
 * or voxtral-small-transcribe-3 ."
 * (https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files,
 * 2026-11-12), plus each card's dated id and `-latest` alias. They document no
 * audio-length cap — only the 65,536-token window the audio shares with
 * `context_bias` — so they are absent from
 * {@link TRANSCRIPTION_MAX_AUDIO_SECONDS}, and `./stt` applies their own rules
 * (segment timestamps only, diarization needs them, no fixed `context_bias`
 * count).
 */
export const VOXTRAL_3_TRANSCRIPTION_MODEL_IDS = [
  "voxtral-mini-transcribe-3-0",
  "voxtral-mini-transcribe-3",
  "voxtral-mini-transcribe-latest",
  "voxtral-small-transcribe-3-0",
  "voxtral-small-transcribe-3",
  "voxtral-small-transcribe-latest",
] as const;

/**
 * Model ids POST /v1/audio/transcriptions accepts. The endpoint docs name
 * `voxtral-mini-latest` ("via audio/transcriptions"), the max-audio-length FAQ
 * covers Voxtral Mini Transcribe 2 and the Voxtral Small transcription path
 * too, and the Voxtral 3 ids join them.
 */
export const TRANSCRIPTION_MODEL_IDS: readonly string[] = [
  ...Object.keys(TRANSCRIPTION_MAX_AUDIO_SECONDS),
  ...VOXTRAL_3_TRANSCRIPTION_MODEL_IDS,
];

/**
 * Realtime (WebSocket) ids that POST /v1/audio/transcriptions cannot serve.
 * The Voxtral 3 realtime guide connects to
 * `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3`
 * (https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-in-realtime,
 * 2026-11-12).
 */
export const REALTIME_MODEL_IDS: readonly string[] = [
  "voxtral-mini-transcribe-realtime-2602",
  "voxtral-mini-realtime-latest",
  "voxtral-mini-transcribe-realtime-3-0",
  "voxtral-mini-transcribe-realtime-3",
  "voxtral-mini-transcribe-realtime-latest",
];
