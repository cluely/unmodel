// Hand-maintained — Cartesia is not in models.dev; refresh from
// https://docs.cartesia.ai/api-reference/tts/bytes,
// https://docs.cartesia.ai/api-reference/stt/transcribe,
// https://docs.cartesia.ai/build-with-cartesia/tts-models/{latest,preview,older-models},
// and https://docs.cartesia.ai/pricing (last checked 2026-08-24).
//
// PRICING: Cartesia bills in credits, not USD — standard TTS is ~1 credit per
// character (Pro Voice Clone ~1.5), batch STT with ink-whisper is 1 credit per
// 2 seconds of audio, and realtime ink-2 is 3 credits per second
// (docs.cartesia.ai/pricing). The USD value of a credit depends on the plan
// (Free $0/20K, Pro $5/100K, Startup $49/1.25M, Scale $299/8M credits —
// cartesia.ai/pricing) and no pay-as-you-go USD rate is published, so there is
// no defensible USD-per-character/-minute conversion; `cost` is deliberately
// omitted rather than guessed. Cost estimation therefore returns no `costUSD`
// for Cartesia models.
//
// NOT LISTED (deliberate): `sonic-english` and `sonic-multilingual` appear on
// third-party leaderboards but are absent from every reachable Cartesia doc
// page — including the now-public older-models page, which enumerates only
// dated sonic-3/sonic-2/sonic-turbo/sonic snapshots — so no id, status or
// pricing can be sourced for them. Also not listed: snapshots the
// older-models page marks "Sunsetted" (sonic-2-2025-03-07,
// sonic-turbo-2025-03-07, sonic-2024-12-12, sonic-2024-10-19 and the bare
// `sonic` alias) — those ids no longer work at all, so carrying them would
// only manufacture dead catalog rows. Likewise `ink-2-turn-detection-end_turn`:
// the realtime STT reference enumerates only `ink-2` and `ink-whisper` for
// its `model` query param. Guessing an id would be worse than omitting it.
//
// NO VOICE CHANGER (deliberate, and the reason is a date). Cartesia's
// speech-to-speech routes are SUNSET: docs.cartesia.ai/llms-full.txt, from
// https://docs.cartesia.ai/build-with-cartesia/deprecations, carries them in
// the "Breaking API changes" table — "These endpoints are being sunset.
// Requests after an endpoint's sunset date return an error." —
// `POST /voice-changer/bytes` and `POST /voice-changer/sse`, replacement "—",
// sunset date **August 20, 2026** (fetched 2026-08-31). Both are also gone from
// the api-reference index (109 reference stubs, neither among them). So
// `cartesia.sts` does not exist and Cartesia is not a witness for
// `unmodel/sts`, even though `@cartesia/cartesia-js` 4.1.0 (published
// 2026-08-26, six days after the sunset) still ships an undeprecated
// `VoiceChanger` resource. The SDK is the weaker source here: the docs state
// the sunset outright, and typing a route that answers an error is the reverse
// of what this library is for. Revisit if the reference page returns.
//
// LIMITS: Cartesia documents no per-request transcript character cap for
// POST /tts/bytes, so `limit.characters` is omitted (the pipeline skips the
// character-limit check when it is absent). `limit.context: 0` disables
// token-window checks — these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "cartesia",
  name: "Cartesia",
  env: ["CARTESIA_API_KEY"],
  doc: "https://docs.cartesia.ai",
} as const satisfies ProviderInfo;

export const models = {
  // ---------------------------------------------------------------------
  // TTS — the tts/bytes model_id enum for Cartesia-Version 2026-03-01 is
  // sonic-3.5 | sonic-3 | sonic-preview | sonic-latest
  // (docs.cartesia.ai/api-reference/tts/bytes).
  // ---------------------------------------------------------------------
  // "Sonic 3.6 is an update to Sonic 3.5 — generally available from August 27
  // on `sonic-3.6`." (https://docs.cartesia.ai/changelog/2026, 2026-11-12).
  // Off the 2026-03-01 `model_id` enum above, so it validates with the
  // off-enum warning; its `language` / `locale` list is the per-model one in
  // CARTESIA_TTS_LANGUAGES_BY_MODEL. Credits only, like every row here.
  "sonic-3.6": {
    id: "sonic-3.6",
    name: "Sonic 3.6 (latest stable snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // "`sonic-3.6-2026-08-27` | August 27, 2026 | en, de, es, … mr, pa, or, ur |
  // Stable" and "A dated snapshot never changes once released." —
  // https://docs.cartesia.ai/build-with-cartesia/tts-models/latest (2026-11-12).
  "sonic-3.6-2026-08-27": {
    id: "sonic-3.6-2026-08-27",
    name: "Sonic 3.6 (2026-08-27 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-08-27",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-3.5": {
    id: "sonic-3.5",
    name: "Sonic 3.5 (latest stable snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-3.5-2026-05-04": {
    id: "sonic-3.5-2026-05-04",
    name: "Sonic 3.5 (2026-05-04 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-05-04",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-3": {
    id: "sonic-3",
    name: "Sonic 3",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // Alias that always resolves to the latest sonic model on Cartesia's side.
  // The older-models page (checked 2026-08-24) now files it under "Deprecated
  // Aliases" ("sonic-latest → use sonic-preview"), yet it is still in the
  // tts/bytes model_id enum — comment only, no status flip, until the two
  // pages agree.
  "sonic-latest": {
    id: "sonic-latest",
    name: "Sonic (latest alias)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // "For testing upcoming changes to our APIs, use `sonic-preview`. It is a
  // beta model, not intended for production usage, and can change without
  // notice." — https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
  // (2026-11-12). The page names no model behind it; Sonic 3.6 itself is GA on
  // `sonic-3.6` above.
  "sonic-preview": {
    id: "sonic-preview",
    name: "Sonic Preview (beta alias)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "beta",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // Deprecated aliases: "The following model aliases are now deprecated.
  // Please use the recommended model names instead:" — "| `sonic-3-latest` |
  // `sonic-preview` |" and "| `sonic-3-preview` | `sonic-3` |"
  // (https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models,
  // 2026-11-12). Filed as deprecated, not "Sunsetted", and given no end date;
  // off the `model_id` enum, so they validate with both warnings.
  "sonic-3-latest": {
    id: "sonic-3-latest",
    name: "Sonic 3 (latest alias, deprecated — use sonic-preview)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-3-preview": {
    id: "sonic-3-preview",
    name: "Sonic 3 (preview alias, deprecated — use sonic-3)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // sonic-2 / sonic-turbo are listed under "older models" on the models page
  // and are absent from the Cartesia-Version 2026-03-01 tts/bytes model_id
  // enum — marked deprecated so callers get a warning.
  "sonic-2": {
    id: "sonic-2",
    name: "Sonic 2",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-turbo": {
    id: "sonic-turbo",
    name: "Sonic Turbo",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // Dated snapshots from the older-models page (2026-08-24). Only the ids the
  // page still lists as working are here; the page's sunset lines — "sonic-2
  // and all sonic-2-* snapshots will stop working after October 20, 2026",
  // ditto sonic-turbo-* — mean every deprecated row below dies on 2026-10-20.
  "sonic-3-2026-01-12": {
    id: "sonic-3-2026-01-12",
    name: "Sonic 3 (2026-01-12 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-01-12",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-3-2025-10-27": {
    id: "sonic-3-2025-10-27",
    name: "Sonic 3 (2025-10-27 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-10-27",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-2-2025-06-11": {
    id: "sonic-2-2025-06-11",
    name: "Sonic 2 (2025-06-11 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-06-11",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-2-2025-05-08": {
    id: "sonic-2-2025-05-08",
    name: "Sonic 2 (2025-05-08 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-05-08",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-2-2025-04-16": {
    id: "sonic-2-2025-04-16",
    name: "Sonic 2 (2025-04-16 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-04-16",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sonic-turbo-2025-06-04": {
    id: "sonic-turbo-2025-06-04",
    name: "Sonic Turbo (2025-06-04 snapshot)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-06-04",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  // ---------------------------------------------------------------------
  // STT (Ink) — batch POST /stt accepts only ink-whisper; ink-2 is
  // realtime-WebSocket-only (docs.cartesia.ai/api-reference/stt/transcribe,
  // docs.cartesia.ai/api-reference/stt/stt).
  // ---------------------------------------------------------------------
  "ink-whisper": {
    id: "ink-whisper",
    name: "Ink Whisper",
    family: "ink",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
  },
  // "`ink-whisper-2025-06-04` | June 4, 2025 |" — the one dated Ink snapshot,
  // Stable, with the same 100-code language row as `ink-whisper`
  // (https://docs.cartesia.ai/build-with-cartesia/stt/older-models,
  // 2026-11-12). Batch /stt takes it through the `ink-whisper-` prefix; on the
  // socket it is off the published enum (a warning).
  "ink-whisper-2025-06-04": {
    id: "ink-whisper-2025-06-04",
    name: "Ink Whisper (2025-06-04 snapshot)",
    family: "ink",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-06-04",
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
  },
  // Realtime-only: served over wss://api.cartesia.ai/stt/websocket, which
  // unmodel does not validate; the batch validator rejects this id.
  "ink-2": {
    id: "ink-2",
    name: "Ink 2",
    family: "ink",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
  },
  // "| `ink-preview` | September 17, 2026 | `en`, `fr`, `hi`, `ja`, `es` |
  // Preview |" (https://docs.cartesia.ai/build-with-cartesia/stt/latest,
  // 2026-11-12). Realtime-only like ink-2: only the 2026-08-14 /stt/websocket
  // `model` enum lists it ("ink-2 | ink-preview | ink-whisper"), so under the
  // 2026-03-01 pin it is off-enum (a warning), and batch /stt refuses it. No
  // rate is published for it (the STT pricing table has ink-2 and ink-whisper
  // columns only).
  "ink-preview": {
    id: "ink-preview",
    name: "Ink Preview",
    family: "ink",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "beta",
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
  },
  // Voice cloning — POST /voices/clone, validated by ./voice-clone. The wire
  // has no model field: this is a SYNTHETIC route-noun id so the validator
  // has a catalog address. Usage of the resulting voice is billed in credits
  // (Pro Voice Clone ~1.5/character — see the PRICING note above); the clone
  // call itself publishes no rate, so `cost` is omitted.
  "voice-clone": {
    id: "voice-clone",
    name: "Cartesia Voice Cloning",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export type CartesiaModelId = keyof typeof models;
/** TTS (sonic-*) model ids. */
export type CartesiaTtsModelId = Extract<CartesiaModelId, `sonic${string}`>;
/** The synthetic id addressing POST /voices/clone (no model field on the wire). */
export type CartesiaVoiceCloneModelId = Extract<CartesiaModelId, "voice-clone">;

/**
 * The `model_id` enum POST /tts/bytes publishes for Cartesia-Version
 * 2026-03-01 — "sonic-3.5", "sonic-3", "sonic-preview", "sonic-latest"
 * (https://docs.cartesia.ai/api-reference/tts/bytes). The catalog carries
 * more sonic ids than this (dated snapshots and the "older models" listed on
 * docs.cartesia.ai/build-with-cartesia/models); those are off-enum and the
 * endpoint may refuse them, so tts.ts warns rather than passing them silently.
 */
export const TTS_MODEL_IDS = [
  "sonic-3.5",
  "sonic-3",
  "sonic-preview",
  "sonic-latest",
] as const satisfies readonly CartesiaModelId[];
/** STT (ink-*) model ids. */
export type CartesiaSttModelId = Extract<CartesiaModelId, `ink${string}`>;

/**
 * The 42 language codes of Sonic 3.5 and Sonic 3 — "native support for 42
 * languages." (https://docs.cartesia.ai/build-with-cartesia/tts-models/sonic-3-5,
 * 2026-11-12) — and the list every TTS id outside
 * {@link CARTESIA_TTS_LANGUAGES_BY_MODEL} is checked against. "Supported
 * languages are model-specific." (POST /tts/bytes, Cartesia-Version 2026-03-01).
 */
export const CARTESIA_TTS_LANGUAGES = [
  "en", "fr", "de", "es", "pt", "zh", "ja", "hi", "it", "ko",
  "nl", "pl", "ru", "sv", "tr", "tl", "bg", "ro", "ar", "cs",
  "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "hu", "no",
  "vi", "bn", "th", "he", "ka", "id", "te", "gu", "kn", "ml",
  "mr", "pa",
] as const;

/**
 * Sonic 3.6's 44 base language codes: the 42 above plus Odia and Urdu —
 * "Sonic 3.6 (`sonic-3.6`) is our fastest, most natural text-to-speech model,
 * with native support for 44 languages." / "Odia and Urdu are new in Sonic
 * 3.6." (https://docs.cartesia.ai/build-with-cartesia/tts-models/latest,
 * 2026-11-12; the `sonic-3.6-2026-08-27` row ends "mr, pa, or, ur").
 */
export const CARTESIA_TTS_3_6_LANGUAGES = [...CARTESIA_TTS_LANGUAGES, "or", "ur"] as const;

/**
 * The 56 regional locale codes Sonic 3.6 takes in `language` or `locale` —
 * "You can pass any base language code from Sonic 3.6 language support, or one
 * of these regional locale codes:"
 * (https://docs.cartesia.ai/build-with-cartesia/capability-guides/advanced-capabilities,
 * transcribed in table order 2026-11-12). "Locale codes are case-sensitive."
 * and "Locale codes such as `en-GB` require Sonic 3.6 or later; passing one to
 * an earlier model returns a 400 error." (POST /tts/bytes, 2026-03-01). The
 * 2026 changelog counts "44 languages / 61 locales", but no page names the
 * other five, so this list is the 56 the table spells out.
 */
export const CARTESIA_TTS_LOCALES = [
  "en-GB", "en-US", "en-IN", "en-IE", "en-ZA", "en-NZ", "en-SG", "en-AU", "en-CA",
  "es-ES", "es-MX", "es-US", "fr-FR", "fr-CA", "nl-NL", "nl-BE", "pt-PT", "pt-BR",
  "bg-BG", "bn-IN", "cs-CZ", "da-DK", "de-DE", "el-GR", "fi-FI", "gu-IN", "he-IL",
  "hi-IN", "hr-HR", "hu-HU", "id-ID", "it-IT", "ja-JP", "ka-GE", "kn-IN", "ko-KR",
  "ml-IN", "mr-IN", "ms-MY", "no-NO", "or-IN", "pa-IN", "pl-PL", "ro-RO", "ru-RU",
  "sk-SK", "sv-SE", "ta-IN", "te-IN", "th-TH", "tl-PH", "tr-TR", "uk-UA", "ur-IN",
  "vi-VN", "zh-CN",
] as const;

const SONIC_3_6_LANGUAGE_VALUES = [...CARTESIA_TTS_3_6_LANGUAGES, ...CARTESIA_TTS_LOCALES] as const;

/**
 * The `language` / `locale` values of the TTS ids whose list is not
 * {@link CARTESIA_TTS_LANGUAGES}: the two Sonic 3.6 ids take their 44 base
 * codes plus the 56 regional locales. Every other id — including
 * `sonic-preview` and `sonic-latest`, whose backing model the docs do not
 * name — takes the 42.
 */
export const CARTESIA_TTS_LANGUAGES_BY_MODEL = {
  "sonic-3.6": SONIC_3_6_LANGUAGE_VALUES,
  "sonic-3.6-2026-08-27": SONIC_3_6_LANGUAGE_VALUES,
} as const satisfies Partial<Record<CartesiaTtsModelId, readonly string[]>>;

/**
 * The `language` enum POST /stt publishes (Cartesia-Version 2026-03-01) —
 * https://docs.cartesia.ai/api-reference/stt/transcribe, transcribed in doc
 * order. Note this is a DIFFERENT, much larger set than the 42-code TTS list:
 * batch STT is Whisper-backed and adds its long tail (cy, haw, yue, …).
 */
export const CARTESIA_STT_LANGUAGES = [
  "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr",
  "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi",
  "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no",
  "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk",
  "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk",
  "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
  "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc",
  "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo",
  "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl",
  "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
] as const;
