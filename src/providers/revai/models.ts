// Hand-maintained — Rev AI is not in models.dev; refresh from
//   https://docs.rev.ai/api/asynchronous/transcribers  (transcriber options)
//   https://docs.rev.ai/api/asynchronous/reference     (the `transcriber` enum)
//   https://docs.rev.ai/api/asynchronous/changelog     (deprecations — published only here)
//   https://www.rev.ai/pricing                         (per-hour / per-minute rates)
// (last checked 2026-11-12).
//
// Rev AI has no "model id" field: the model is selected with the `transcriber`
// option on POST /speechtotext/v1/jobs, so the catalog is keyed by
// `transcriber` values. Third-party leaderboards report Rev AI's batch model
// under the id `machine`, which is exactly this enum value.
//
// The reference documents two values — `TranscriberField` is "enum: - machine
// - human" (2026-11-12). `low_cost` and `fusion` keep their rows because they
// are deprecated, not removed: "This option is being sunset and will be
// removed in a future release" (changelog, 2026-07-28 and 2026-08-20).
//
// Declined (2026-11-12), so audits stop re-suggesting them:
// - `machine_v3` — appears only in Rev's SDK repos (revai-node-sdk commit
//   fbca762, "enabling support for the machine_v3 transcriber"; revai-java-sdk
//   examples/AsyncTranscribeMediaUrl.java; revai-python-sdk commit b2f59be),
//   never in the reference, either changelog or the pricing page. Catalog it
//   once Rev documents it; it validates today with an `unknown_model` warning.
// - "Whisper Large Transcription $0.005 per minute" (rev.ai/pricing) — a
//   pricing-page product with no documented `transcriber` value that selects
//   it, so there is no wire id to key a row by.
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
 * Unit conversions (https://www.rev.ai/pricing, pay-as-you-go, checked
 * 2026-11-12; `ModelCost.perAudioMinute` is USD per MINUTE):
 * - "Reverb Transcription $0.20 per hour" (English) ÷ 60 = $0.003333…/min.
 *   Non-English audio bills at "Reverb Foreign Language Transcription
 *   $0.30 per hour" — see {@link FOREIGN_LANGUAGE_USD_PER_MINUTE}; the
 *   catalog carries the English rate because the language lives in the
 *   request, not in the transcriber id.
 * - "Human Transcription $1.99 per minute" — already per minute; the Rush
 *   (+$1.25/min) and Verbatim (+$0.50/min) add-ons are NOT folded in.
 * Every product is "Rounded up to the nearest second, 15 second minimum".
 *
 * `low_cost` and `fusion` carry no cost: the page no longer lists either
 * product. The last published rates — "Reverb turbo transcription $0.10 per
 * hour" and "Whisper Fusion Transcription $0.005 per minute" — are on the
 * 2026-08-23 Wayback snapshot
 * (https://web.archive.org/web/20260823005903/https://www.rev.ai/pricing) and
 * gone from the 2026-09-20 one and from the live page on 2026-11-12. The
 * live "Whisper Large Transcription $0.005 per minute" line is a separate
 * product the 2026-08-23 page listed beside Whisper Fusion, so it is not
 * Fusion's price.
 */
const MACHINE_USD_PER_MINUTE = 0.2 / 60;
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
  // "Deprecated the `low_cost` (Reverb Turbo) transcriber option […] This
  // option is being sunset and will be removed in a future release. We
  // recommend using the default `machine` transcriber for new jobs."
  // (https://docs.rev.ai/api/asynchronous/changelog, 2026-07-28 entry,
  // checked 2026-11-12). No current price is published, so no cost.
  low_cost: {
    id: "low_cost",
    name: "Rev AI Reverb Turbo (low_cost)",
    family: "reverb",
    ...STT,
    status: "deprecated",
  },
  // "Deprecated the `fusion` transcriber option […] This option is being
  // sunset and will be removed in a future release. We recommend using the
  // default transcriber for new jobs." (https://docs.rev.ai/api/asynchronous/changelog,
  // 2026-08-20 entry, checked 2026-11-12). No current price is published, so
  // no cost.
  fusion: {
    id: "fusion",
    name: "Rev AI Whisper Fusion",
    family: "whisper",
    ...STT,
    status: "deprecated",
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

/** Runtime allow-list of cataloged `transcriber` values, deprecated ones included. */
export const TRANSCRIBERS: readonly string[] = Object.keys(models);

/** "the default and routes to our standard (Reverb) model". */
export const DEFAULT_TRANSCRIBER = "machine";
