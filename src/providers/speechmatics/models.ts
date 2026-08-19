// Hand-maintained — Speechmatics is not in models.dev; refresh from
//   https://docs.speechmatics.com/speech-to-text/models   (model ids, per-model feature support)
//   https://www.speechmatics.com/pricing                  (per-hour rates, "Last updated 31 July 2026")
// (last checked 2026-08-13).
//
// The catalogued ids are the values of `transcription_config.model`
// (previously `operating_point`): `enhanced`, `standard`, `melia-1`. The
// SAME ids are used by the Realtime WebSocket API, which unmodel does not
// validate, so the per-minute rates below are the BATCH rates. Realtime is
// billed differently on the same pricing page: Standard $0.24/hr,
// Enhanced $0.43/hr (Melia 1 is batch-only).
//
// Bolt-ons are billed on top of the transcription rate and are NOT folded
// into estimates: Translation $0.65/hr, Summaries $0.12/hr, Chapters
// $0.40/hr, Sentiment $0.12/hr, Topics $0.20/hr.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "speechmatics",
  name: "Speechmatics",
  env: ["SPEECHMATICS_API_KEY"],
  doc: "https://docs.speechmatics.com",
} as const satisfies ProviderInfo;

/**
 * Unit conversion: the pricing page quotes USD per HOUR and
 * `ModelCost.perAudioMinute` is USD per MINUTE, so every rate is `$/hr ÷ 60`.
 */
const MELIA_USD_PER_MINUTE = 0.129 / 60;
const STANDARD_USD_PER_MINUTE = 0.24 / 60;
const ENHANCED_USD_PER_MINUTE = 0.4 / 60;

/** Realtime rates, catalogued as constants only (unmodel validates batch). */
export const REALTIME_STANDARD_USD_PER_MINUTE = 0.24 / 60;
export const REALTIME_ENHANCED_USD_PER_MINUTE = 0.43 / 60;

/** Shared shape of every Speechmatics STT catalog entry. */
const STT = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // limit.context 0: STT is not token-windowed; the pipeline skips context
  // checks. Speechmatics documents no per-request audio-duration cap for
  // batch — only a 1 GB body-size cap, enforced in ./jobs.
  limit: { context: 0 },
} as const;

export const models = {
  enhanced: {
    id: "enhanced",
    name: "Speechmatics Enhanced",
    family: "speechmatics",
    ...STT,
    cost: { perAudioMinute: ENHANCED_USD_PER_MINUTE },
  },
  standard: {
    id: "standard",
    name: "Speechmatics Standard",
    family: "speechmatics",
    ...STT,
    cost: { perAudioMinute: STANDARD_USD_PER_MINUTE },
  },
  "melia-1": {
    id: "melia-1",
    name: "Speechmatics Melia 1",
    family: "melia",
    ...STT,
    cost: { perAudioMinute: MELIA_USD_PER_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

export type SpeechmaticsModelId = keyof typeof models;

/** Runtime allow-list of documented `transcription_config.model` values. */
export const MODEL_IDS: readonly string[] = Object.keys(models);

/**
 * Batch SaaS endpoint hostnames, keyed by region
 * (https://docs.speechmatics.com/get-started/authentication#supported-endpoints).
 * EU2/US2 are enterprise failover endpoints. Melia 1 runs in EU1 and US1 only.
 */
export const BATCH_HOSTS = {
  eu1: "eu1.asr.api.speechmatics.com",
  eu2: "eu2.asr.api.speechmatics.com",
  us1: "us1.asr.api.speechmatics.com",
  us2: "us2.asr.api.speechmatics.com",
  au1: "au1.asr.api.speechmatics.com",
} as const;

export type SpeechmaticsRegion = keyof typeof BATCH_HOSTS;

/** Regions Melia 1 is available in (docs: "EU and US regions only"). */
export const MELIA_REGIONS: readonly SpeechmaticsRegion[] = ["eu1", "us1"];
