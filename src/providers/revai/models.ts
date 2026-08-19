// Hand-maintained — Rev AI is not in models.dev; refresh from
//   https://docs.rev.ai/api/asynchronous/transcribers  (transcriber options)
//   https://docs.rev.ai/api/asynchronous/reference     (the `transcriber` enum)
//   https://www.rev.ai/pricing                         (per-hour / per-minute rates)
// (last checked 2026-08-13).
//
// Rev AI has no "model id" field: the model is selected with the `transcriber`
// option on POST /speechtotext/v1/jobs, so the catalog is keyed by the four
// documented `transcriber` values. Third-party leaderboards report Rev AI's
// batch model under the id `machine`, which is exactly this enum value.
//
// The streaming API reuses the same `transcriber` values over a WebSocket,
// which unmodel does not validate.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "revai",
  name: "Rev AI",
  // The docs' curl examples read the key from $REV_ACCESS_TOKEN.
  env: ["REVAI_API_KEY", "REV_ACCESS_TOKEN"],
  doc: "https://docs.rev.ai",
} as const satisfies ProviderInfo;

/**
 * Unit conversions (rev.ai/pricing, pay-as-you-go, checked 2026-08-13;
 * `ModelCost.perAudioMinute` is USD per MINUTE):
 * - "Reverb Transcription $0.20 per hour" (English) ÷ 60 = $0.003333…/min.
 *   Non-English audio bills at "Reverb Foreign Language Transcription
 *   $0.30 per hour" — see {@link FOREIGN_LANGUAGE_USD_PER_MINUTE}; the
 *   catalog carries the English rate because the language lives in the
 *   request, not in the transcriber id.
 * - "Reverb turbo transcription $0.10 per hour" ÷ 60 = $0.001666…/min.
 * - "Whisper Fusion Transcription $0.005 per minute" — already per minute.
 * - "Human Transcription $1.99 per minute" — already per minute; the Rush
 *   (+$1.25/min) and Verbatim (+$0.50/min) add-ons are NOT folded in.
 * Every product is "Rounded up to the nearest second, 15 second minimum".
 */
const MACHINE_USD_PER_MINUTE = 0.2 / 60;
const LOW_COST_USD_PER_MINUTE = 0.1 / 60;
const FUSION_USD_PER_MINUTE = 0.005;
const HUMAN_USD_PER_MINUTE = 1.99;

/** "Reverb Foreign Language Transcription $0.30 per hour" ÷ 60. */
export const FOREIGN_LANGUAGE_USD_PER_MINUTE = 0.3 / 60;

/** Human add-ons, in USD per minute, billed on top of the base rate. */
export const HUMAN_RUSH_USD_PER_MINUTE = 1.25;
export const HUMAN_VERBATIM_USD_PER_MINUTE = 0.5;

/** "15 second minimum" billing floor, in seconds. */
export const MINIMUM_BILLED_SECONDS = 15;

/** Shared shape of every Rev AI transcriber catalog entry. */
const STT = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // limit.context 0: STT is not token-windowed; the pipeline skips context
  // checks. The 17-hour media cap is enforced in ./jobs.
  limit: { context: 0 },
} as const;

export const models = {
  machine: {
    id: "machine",
    name: "Rev AI Reverb (machine)",
    family: "reverb",
    ...STT,
    cost: { perAudioMinute: MACHINE_USD_PER_MINUTE },
  },
  low_cost: {
    id: "low_cost",
    name: "Rev AI Reverb Turbo (low_cost)",
    family: "reverb",
    ...STT,
    cost: { perAudioMinute: LOW_COST_USD_PER_MINUTE },
  },
  fusion: {
    id: "fusion",
    name: "Rev AI Whisper Fusion",
    family: "whisper",
    ...STT,
    cost: { perAudioMinute: FUSION_USD_PER_MINUTE },
  },
  human: {
    id: "human",
    name: "Rev AI Human Transcription",
    family: "human",
    ...STT,
    cost: { perAudioMinute: HUMAN_USD_PER_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

export type RevaiTranscriber = keyof typeof models;

/** Runtime allow-list of documented `transcriber` values. */
export const TRANSCRIBERS: readonly string[] = Object.keys(models);

/** "the default and routes to our standard (Reverb) model". */
export const DEFAULT_TRANSCRIBER = "machine";
