// Hand-maintained — Soniox is not in models.dev; refresh from
// https://soniox.com/docs/stt/models and https://soniox.com/pricing
// (last checked 2026-08-13).
//
// The realtime models (stt-rt-v5 / stt-rt-v4) serve the WebSocket API, whose
// configuration message `realtimeTranscription` validates; `transcriptions`
// (the async REST endpoint) rejects them, and vice versa.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "soniox",
  name: "Soniox",
  env: ["SONIOX_API_KEY"],
  doc: "https://soniox.com/docs",
} as const satisfies ProviderInfo;

/**
 * Unit conversion: soniox.com/pricing quotes async STT at "$0.10/hour for
 * async (file uploads)" (checked 2026-08-13). ModelCost.perAudioMinute is USD
 * per minute, so $0.10/hr ÷ 60 min/hr = $0.001666…/min.
 */
const ASYNC_USD_PER_MINUTE = 0.1 / 60;
/** "$0.12/hour for real-time (streaming)" ÷ 60 = $0.002/min (same page). */
const REALTIME_USD_PER_MINUTE = 0.12 / 60;

const asyncModels = {
  "stt-async-v5": {
    id: "stt-async-v5",
    name: "Soniox STT Async v5",
    family: "stt-async",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["text"] },
    // limit.context 0: STT is not token-windowed; the pipeline skips context
    // checks. Soniox caps a single request at 5 hours of audio — enforced in
    // transcriptions.ts via MAX_AUDIO_DURATION_SECONDS.
    limit: { context: 0 },
    cost: { perAudioMinute: ASYNC_USD_PER_MINUTE },
  },
  "stt-async-v4": {
    id: "stt-async-v4",
    name: "Soniox STT Async v4 (alias of v5)",
    family: "stt-async",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Retired 2026-06-30; the id still works but auto-routes to stt-async-v5
    // (https://soniox.com/docs/stt/models).
    status: "deprecated",
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
    cost: { perAudioMinute: ASYNC_USD_PER_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * WebSocket-only realtime models: the ids `realtimeTranscription` accepts in
 * the session configuration message. They cannot be used with
 * POST /v1/transcriptions — `transcriptions` reports `unsupported_capability`
 * for them — and their $0.12/hr rate prices a realtime session from this same
 * table.
 */
const realtimeModels = {
  "stt-rt-v5": {
    id: "stt-rt-v5",
    name: "Soniox STT Real-Time v5",
    family: "stt-rt",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["text"] },
    // Same 5-hour per-request audio cap as the async models (MODELS_DOCS).
    limit: { context: 0 },
    cost: { perAudioMinute: REALTIME_USD_PER_MINUTE },
  },
  "stt-rt-v4": {
    id: "stt-rt-v4",
    name: "Soniox STT Real-Time v4 (alias of v5)",
    family: "stt-rt",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Retired 2026-06-30; the id still works but auto-routes to stt-rt-v5
    // (https://soniox.com/docs/stt/models).
    status: "deprecated",
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
    cost: { perAudioMinute: REALTIME_USD_PER_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...asyncModels,
  ...realtimeModels,
} as const satisfies Record<string, ModelInfo>;

export type SonioxModelId = keyof typeof models;
/** Model ids POST /v1/transcriptions accepts. */
export type SonioxAsyncModelId = keyof typeof asyncModels;
/** WebSocket-only ids — rejected by the async REST endpoint. */
export type SonioxRealtimeModelId = keyof typeof realtimeModels;

/** Runtime allow-list backing the async endpoint's model gate. */
export const ASYNC_MODEL_IDS: readonly string[] = Object.keys(asyncModels);
/** Runtime allow-list backing the realtime WebSocket config's model gate. */
export const REALTIME_MODEL_IDS: readonly string[] = Object.keys(realtimeModels);
