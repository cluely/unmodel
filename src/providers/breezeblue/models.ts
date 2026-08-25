// Hand-maintained — BreezeBlue is not in models.dev; refresh from
// https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech,
// https://docs.breezeblue.ai/api-reference/models/list-models,
// https://docs.breezeblue.ai/openapi.json,
// https://docs.breezeblue.ai/concepts/pricing and
// https://breezeblue.ai/pricing (last checked 2026-08-24).
//
// MODEL IDS: `model_id` is an optional free string on the wire (1–120 chars,
// nullable; OpenAPI `TtsRequest.model_id`), and the catalog of live ids is
// runtime data behind GET /v1/models ("List TTS models available to the
// authenticated account"). Exactly ONE id appears anywhere in the docs and the
// OpenAPI bundle's code samples: `breeze-tts-2` (ten occurrences across the
// convert, stream and realtime-session samples, and the usage-metering example
// response). No other id — current, deprecated, or historical — is published,
// so this catalog has one row. The docs do not state which model serves a
// request that OMITS `model_id`; unmodel therefore does not assume a default —
// an omitted `model_id` skips model-keyed checks instead of pretending.
//
// PRICING: metering is documented on https://docs.breezeblue.ai/concepts/pricing
// — "Text to speech: per character after Unicode normalization" — and the USD
// list rates on https://breezeblue.ai/pricing are per PLAN, not per model:
//
//   Free    $0/mo   $40 / 1M characters
//   Starter $9/mo   $36 / 1M characters
//   Creator $19/mo  $32 / 1M characters
//   Pro     $99/mo  $28 / 1M characters
//
// `perMillionCharacters` encodes the FREE-plan rate — $40 / 1M characters, the
// only rate that applies with no subscription, and the ceiling of the four
// published tiers (no conversion arithmetic needed: the page already quotes
// $ per 1M characters). A paid plan pays less, so treat `costUSD` (and any
// `maxCostUSD` budget) as the list-price upper bound; unmodel cannot see your
// plan. The rate is a property of the account, not of the model — the same
// four numbers would apply to any future model id.
//
// LIMITS: no per-request character cap is published anywhere — the OpenAPI
// `TtsRequest.text` carries `minLength: 1` and NO maxLength, and the docs only
// advise "Use async jobs for long text" without a number — so
// `limit.characters` is omitted rather than invented. `limit.context: 0`
// disables token-window checks; this is not a token model.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "breezeblue",
  name: "BreezeBlue",
  env: ["BREEZE_API_KEY"],
  doc: "https://docs.breezeblue.ai",
} as const satisfies ProviderInfo;

/**
 * The Free-plan (no-subscription) USD list rate, verbatim from
 * https://breezeblue.ai/pricing ("$40 / 1M characters"). Paid tiers are lower
 * ($36 / $32 / $28) — see the PRICING note above. Shared by the catalog row
 * and the endpoint's estimator so the two cannot drift.
 */
export const TTS_COST_PER_MILLION_CHARACTERS_USD = 40;

export const models = {
  // The only model id BreezeBlue publishes (docs + OpenAPI code samples; also
  // the `model` value in the usage-metering example). Per-model language
  // support is runtime data: GET /v1/models returns each model's `languages`
  // array of ISO 639-1 codes.
  "breeze-tts-2": {
    id: "breeze-tts-2",
    name: "Breeze TTS 2",
    family: "breeze-tts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    // No published per-request character cap — see the LIMITS note.
    limit: { context: 0 },
    // Free-plan list rate; plan-dependent — see the PRICING note.
    cost: { perMillionCharacters: TTS_COST_PER_MILLION_CHARACTERS_USD },
  },
} as const satisfies Record<string, ModelInfo>;

export type BreezeblueModelId = keyof typeof models;
/** The one catalogued model serves the TTS routes. */
export type BreezeblueTtsModelId = BreezeblueModelId;

export const BREEZEBLUE_MODEL_IDS = [
  "breeze-tts-2",
] as const satisfies readonly BreezeblueModelId[];

/**
 * The 23 ISO 639-1 codes of the VOICE contract, verbatim from
 * https://docs.breezeblue.ai/concepts/multilingual ("The Voice contract
 * accepts these 23 codes").
 *
 * This is the enum for saved-voice metadata (`GET /v1/voices` filters,
 * previews, edits) — it is deliberately NOT enforced on the TTS request's
 * `language_code`, whose OpenAPI contract is only "two ASCII letters"
 * (`^[A-Za-z]{2}$`) plus the runtime rule "The selected model must list the
 * code in supported_languages" (discoverable via GET /v1/models). Encoding
 * this list as the TTS enum would refuse codes a future model serves.
 * Published here for pickers.
 */
export const VOICE_LANGUAGE_CODES = [
  "ar",
  "cs",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
] as const;

export type BreezeblueVoiceLanguageCode = (typeof VOICE_LANGUAGE_CODES)[number];
