// Hand-maintained — Speechmatics is not in models.dev; refresh from
//   https://docs.speechmatics.com/speech-to-text/models.md   (model ids, per-model feature support)
//   https://www.speechmatics.com/pricing.md                  ("Speech-to-text list rates (USD per hour)"
//                                                             and the add-on table)
// (last checked 2026-11-12).
//
// Read the markdown list-rate table, not the HTML /pricing page: the HTML
// renders every rate with the 33% model-training and 25% annual-commitment
// discounts already applied (Enhanced shows "$0.38 / hr"). Pay-as-you-go pays
// the list rate — "Add a card and go. You pay the listed hourly rate with no
// discounts." — in credits of one US dollar each ("One credit is worth one US
// dollar", https://docs.speechmatics.com/administration/billing.md).
//
// The catalogued ids are the values of `transcription_config.model`
// (previously `operating_point`): `enhanced`, `standard`, `melia-1`,
// `oak-1`. The SAME ids are used by the Realtime WebSocket API, which
// unmodel does not validate, so the per-minute rates on the rows are the
// BATCH rates; realtime bills all four at its own list rates, exported below
// as constants. Linden 1 has no row: it runs only on the Agent STT socket
// (`/v2/agent`) — "The Agent STT API has its own models, which are not
// available on Batch or Realtime" (models.md).
//
// Bolt-ons are billed on top of the transcription rate and are NOT folded
// into estimates: Translation $0.65/hr, Summaries $0.12/hr, Chapters
// $0.40/hr, Sentiment $0.12/hr, Topics $0.20/hr — all pre-recorded, on
// Enhanced and Standard only (pricing.md add-on table, e.g.
// "| Translation | Pre-recorded | 0.65 | Enhanced, Standard |").

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
 * Each rate below is one row of the "Speech-to-text list rates (USD per
 * hour)" table at https://www.speechmatics.com/pricing.md (2026-11-12),
 * quoted beside it.
 */
// "| Pre-recorded | Melia 1 | 0.24 | — |"
const MELIA_USD_PER_MINUTE = 0.24 / 60;
// "| Pre-recorded | Oak 1 | 0.3 | — |"
const OAK_USD_PER_MINUTE = 0.3 / 60;
// "| Pre-recorded | Standard | 0.45 | — |"
const STANDARD_USD_PER_MINUTE = 0.45 / 60;
// "| Pre-recorded | Enhanced | 0.75 | — |"
const ENHANCED_USD_PER_MINUTE = 0.75 / 60;

// Realtime rates, catalogued as constants only (unmodel validates batch).

/** Realtime Standard: "| Real-time | Standard | 0.45 | — |". */
export const REALTIME_STANDARD_USD_PER_MINUTE = 0.45 / 60;
/** Realtime Enhanced: "| Real-time | Enhanced | 0.8 | — |". */
export const REALTIME_ENHANCED_USD_PER_MINUTE = 0.8 / 60;
/** Realtime Melia 1: "| Real-time | Melia 1 | 0.4 | — |". */
export const REALTIME_MELIA_USD_PER_MINUTE = 0.4 / 60;
/** Realtime Oak 1: "| Real-time | Oak 1 | 0.46 | — |". */
export const REALTIME_OAK_USD_PER_MINUTE = 0.46 / 60;

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
  // https://docs.speechmatics.com/speech-to-text/models.md (2026-11-12):
  // "| Batch     | `enhanced`, `standard`, `melia-1`, `oak-1` |" — and "Oak 1
  // is a standalone model for healthcare audio. It is separate from the
  // Enhanced Medical model". Rate: OAK_USD_PER_MINUTE.
  "oak-1": {
    id: "oak-1",
    name: "Speechmatics Oak 1",
    family: "oak",
    ...STT,
    cost: { perAudioMinute: OAK_USD_PER_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

export type SpeechmaticsModelId = keyof typeof models;

/** Runtime allow-list of documented `transcription_config.model` values. */
export const MODEL_IDS: readonly string[] = Object.keys(models);

/**
 * Batch SaaS endpoint hostnames, keyed by region
 * (https://docs.speechmatics.com/get-started/authentication#supported-endpoints).
 * EU2/US2 are enterprise failover endpoints. Melia 1 and Oak 1 run on EU1,
 * US1 and AU1 only ({@link MELIA_REGIONS}).
 */
export const BATCH_HOSTS = {
  eu1: "eu1.asr.api.speechmatics.com",
  eu2: "eu2.asr.api.speechmatics.com",
  us1: "us1.asr.api.speechmatics.com",
  us2: "us2.asr.api.speechmatics.com",
  au1: "au1.asr.api.speechmatics.com",
} as const;

export type SpeechmaticsRegion = keyof typeof BATCH_HOSTS;

/**
 * Batch regions Melia 1 and Oak 1 are available in: "The Melia 1 and Oak 1
 * models are available on the EU1, US1, and AU1 endpoints only"
 * (https://docs.speechmatics.com/get-started/authentication.md, 2026-11-12).
 */
export const MELIA_REGIONS: readonly SpeechmaticsRegion[] = ["eu1", "us1", "au1"];
