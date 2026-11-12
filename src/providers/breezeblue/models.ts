// Hand-maintained — BreezeBlue is not in models.dev; refresh from
// https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech,
// https://docs.breezeblue.ai/api-reference/models/list-models,
// https://docs.breezeblue.ai/concepts/multilingual,
// https://docs.breezeblue.ai/guides/text-to-speech,
// https://docs.breezeblue.ai/openapi.json,
// https://docs.breezeblue.ai/concepts/pricing and
// https://breezeblue.ai/pricing (last checked 2026-08-24; model ids and
// languages re-checked 2026-11-12).
//
// MODEL IDS: `model_id` is an optional free string on the wire (1–120 chars,
// nullable; OpenAPI `TtsRequest.model_id` — "Selected automatically when
// omitted"), and the catalog of live ids is runtime data behind GET /v1/models
// ("List TTS models available to the authenticated account"). Two ids are
// published:
//
// - `breeze-tts-2` — the id of every plain convert, stream and
//   realtime-session sample in the OpenAPI bundle;
// - `breeze-tts-2-multilingual` — https://docs.breezeblue.ai/concepts/multilingual:
//   "Breeze TTS 2 Multilingual (`breeze-tts-2-multilingual`) supports all 51
//   codes accepted by the Voice contract. Use this model ID for multilingual
//   generation."
//
// plus one documented alias of the second, `breeze-tts-2-preview` (row below).
//
// An OMITTED `model_id` is routed by language — https://docs.breezeblue.ai/guides/text-to-speech:
// "When `model_id` is omitted, explicit `language_code: en` or `zh` selects
// `breeze-tts-2`; other or omitted languages select
// `breeze-tts-2-multilingual`." The validator resolves an omitted or null
// `model_id` the same way, so model-keyed checks run against the model that
// will actually serve the request (see `routedModelId` in ./tts.ts). The same
// page: "An explicit model is never switched automatically: an incompatible
// language returns an error."
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
  // The id of every plain convert/stream/realtime sample in the OpenAPI bundle
  // (also the `model` value in the usage-metering example), and the model an
  // omitted `model_id` routes to for `language_code` "en" or "zh". Per-model
  // language support is runtime data: GET /v1/models returns each model's
  // `languages` array of ISO 639-1 codes.
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
  // https://docs.breezeblue.ai/concepts/multilingual (2026-11-12): "Breeze TTS
  // 2 Multilingual (`breeze-tts-2-multilingual`) supports all 51 codes
  // accepted by the Voice contract" — VOICE_LANGUAGE_CODES below. Also the
  // model an omitted `model_id` routes to for every language but en/zh. No
  // dated announcement or changelog entry exists, so no `releaseDate`.
  // Hosted only — BreezeBlue on
  // https://huggingface.co/BreezeBlue/Breeze-TTS-2/discussions/6 (2026-11-12):
  // "Multilingual models will be updated on our platform."
  "breeze-tts-2-multilingual": {
    id: "breeze-tts-2-multilingual",
    name: "Breeze TTS 2 Multilingual",
    family: "breeze-tts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    // The same endpoint and `TtsRequest` as breeze-tts-2 — see the LIMITS note.
    limit: { context: 0 },
    // The account's rate, not a per-model one — see the PRICING note.
    cost: { perMillionCharacters: TTS_COST_PER_MILLION_CHARACTERS_USD },
  },
  // A documented compatibility ALIAS of the multilingual model, not a model of
  // its own — https://docs.breezeblue.ai/concepts/multilingual (2026-11-12):
  // "The Developer API accepts `breeze-tts-2-preview` as a compatibility alias
  // for `breeze-tts-2-multilingual`. This applies to synchronous,
  // asynchronous, streaming, and realtime TTS, as well as voice previews. …
  // `GET /v1/models` lists the formal model only." Catalogued so the id
  // validates and prices without `unknown_model`; kept out of
  // BREEZEBLUE_MODEL_IDS and the unified ref union, which name the formal id.
  "breeze-tts-2-preview": {
    id: "breeze-tts-2-preview",
    name: "Breeze TTS 2 Preview (multilingual alias)",
    family: "breeze-tts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perMillionCharacters: TTS_COST_PER_MILLION_CHARACTERS_USD },
  },
} as const satisfies Record<string, ModelInfo>;

export type BreezeblueModelId = keyof typeof models;
/** Every catalogued id (the alias included) serves the TTS routes. */
export type BreezeblueTtsModelId = BreezeblueModelId;

/** The two published model ids — the alias `breeze-tts-2-preview` is not one. */
export const BREEZEBLUE_MODEL_IDS = [
  "breeze-tts-2",
  "breeze-tts-2-multilingual",
] as const satisfies readonly BreezeblueModelId[];

/**
 * The 51 ISO 639-1 codes of the VOICE contract, verbatim (and in order) from
 * the language table on https://docs.breezeblue.ai/concepts/multilingual
 * (checked 2026-11-12: "Find all 51 supported language codes and the accent
 * rules for multilingual voice and text-to-speech workflows."). The runtime
 * source of the same list is GET /v1/voice-metadata/options.
 *
 * One list, two documented uses:
 *
 * - the enum for saved-voice metadata (`GET /v1/voices` filters, previews,
 *   edits);
 * - the synthesis languages of `breeze-tts-2-multilingual`, which "supports
 *   all 51 codes accepted by the Voice contract" — its unified row completes
 *   `language` from this array by reference.
 *
 * It is deliberately NOT enforced on the TTS request's `language_code`, whose
 * OpenAPI contract is only "two ASCII letters" (`^[A-Za-z]{2}$`) plus the
 * runtime rule "The selected model must list the code in supported_languages"
 * (discoverable via GET /v1/models); `breeze-tts-2` publishes no list of its
 * own, and a gate here would refuse codes a future model serves. Published
 * for pickers.
 */
export const VOICE_LANGUAGE_CODES = [
  "af",
  "ar",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fr",
  "gl",
  "he",
  "hi",
  "hu",
  "id",
  "is",
  "it",
  "ja",
  "kn",
  "ko",
  "lt",
  "mr",
  "ms",
  "ne",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sq",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh",
] as const;

export type BreezeblueVoiceLanguageCode = (typeof VOICE_LANGUAGE_CODES)[number];
