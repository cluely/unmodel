// Hand-maintained — Cartesia is not in models.dev; refresh from
// https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes and
// https://docs.cartesia.ai/2026-03-01/api-reference/stt/transcribe (the
// version the TTS and STT validators pin — the unversioned api-reference
// pages render Cartesia-Version 2026-08-14),
// https://docs.cartesia.ai/build-with-cartesia/tts-models/{latest,older-models,api-changes},
// https://docs.cartesia.ai/build-with-cartesia/stt/{latest,older-models},
// and https://docs.cartesia.ai/pricing (last checked 2026-11-12).
//
// PRICING: Cartesia bills in credits, not USD — TTS is ~1 credit per
// character, cloned voices included ("Speech from a clone costs 1 credit per
// character, unless your Enterprise plan says otherwise." / "Training a
// Professional Voice Clone is free." — cartesia.ai/pricing, 2026-11-12), batch
// STT with ink-whisper is 1 credit per 2 seconds of audio, realtime ink-2 is 3
// credits per second, and realtime ink-whisper is 1 credit per second
// ("/stt/websocket | 3 credits per second
// of audio | 1 credit per second of audio", the same on /stt/turns/websocket —
// docs.cartesia.ai/pricing, 2026-11-12). The USD value of a credit depends on
// the plan (Free $0/20K, Pro $5/100K, Startup $49/1.25M, Scale $299/8M credits
// — cartesia.ai/pricing), and so does the overage rate: "Paid plans can turn
// on overages and keep going past a zero balance, at a rate set by tier:" —
// Pro $65, Startup $45, Scale $38 per 1M credits, plus an Ink STT figure of
// "$0.39 per hour on the Scale plan" (cartesia.ai/pricing, 2026-11-12). No
// rate holds across plans, so there is no defensible USD-per-character/-minute
// conversion; `cost` is deliberately omitted rather than guessed. Cost
// estimation therefore returns no `costUSD` for Cartesia models.
//
// NOT LISTED (deliberate): `sonic-english` and `sonic-multilingual`, still
// named on third-party leaderboards, are on the "Sunsetted models" table of
// https://docs.cartesia.ai/build-with-cartesia/tts-models/api-changes —
// "| `sonic-english` | — | All | June 1, 2026 |" and
// "| `sonic-multilingual` | — | All | June 1, 2026 |" (2026-11-12) — so they
// fall under the passed-sunset rule below. Also not listed: snapshots the
// older-models page marks "Sunsetted" (sonic-2-2025-03-07,
// sonic-turbo-2025-03-07, sonic-2024-12-12, sonic-2024-10-19 and the bare
// `sonic` alias), and every id whose sunset date on
// https://docs.cartesia.ai/build-with-cartesia/tts-models/api-changes has
// passed ("Requests to sunsetted models will return an error.", 2026-11-12)
// — those ids no longer work at all, so carrying them would only manufacture
// dead catalog rows. Likewise `ink-2-turn-detection-end_turn`:
// the realtime STT reference enumerates only `ink-2` and `ink-whisper` for
// its `model` query param. Guessing an id would be worse than omitting it.
//
// NO VOICE CHANGER (deliberate, and the reason is a date). Cartesia's
// speech-to-speech routes are SUNSET:
// https://docs.cartesia.ai/build-with-cartesia/tts-models/api-changes carries
// them in its endpoint table — "These endpoints have been sunset. Requests
// after an endpoint's sunset date return an error." (2026-11-12) —
// `POST /voice-changer/bytes` and `POST /voice-changer/sse`, replacement "—",
// sunset date **August 20, 2026** (first read 2026-08-31). Both are also gone from
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
  // (https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes).
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
  // Dated snapshot from the older-models page (2026-08-24); off the `model_id`
  // enum, so it validates with a warning.
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
  // ---------------------------------------------------------------------
  // STT (Ink) — batch POST /stt accepts only ink-whisper; ink-2 is
  // realtime-WebSocket-only (docs.cartesia.ai/2026-03-01/api-reference/stt/transcribe,
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
  // Realtime-only: served over wss://api.cartesia.ai/stt/websocket (validated
  // by ./stt-websocket); the batch validator rejects this id.
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
  // has a catalog address. Usage of the resulting voice is billed at the TTS
  // rate, 1 credit per character (see the PRICING note above); the clone call
  // itself publishes no rate, so `cost` is omitted.
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
 * (https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes). The catalog
 * carries more sonic ids than this (`sonic-3.6`, the dated snapshots and the
 * deprecated aliases of https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
 * and …/older-models); those are off-enum and the endpoint may refuse them, so
 * tts.ts warns rather than passing them silently.
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
 * 2026-11-12) — and the list every cataloged TTS id outside
 * {@link CARTESIA_TTS_LANGUAGES_BY_MODEL} and {@link CARTESIA_TTS_ALIAS_LANGUAGES}
 * is checked against. "Supported languages are model-specific." (POST
 * /tts/bytes, Cartesia-Version 2026-03-01).
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
 * 2026 changelog counts "44 languages / 61 locales" and "`en-GB`, `es-MX`,
 * `hi-IN`, and 58 more" (https://docs.cartesia.ai/changelog/2026, 2026-11-12),
 * but no page names the other five, so this list is the 56 the table spells
 * out — and ./tts reports a well-formed regional code on a Sonic 3.6 base that
 * is not among them (`ar-SA`) at *warning* severity, not as an error.
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
 * The `language` / `locale` values of the TTS ids whose documented list is not
 * {@link CARTESIA_TTS_LANGUAGES}: the two Sonic 3.6 ids take their 44 base
 * codes plus the 56 regional locales. The other cataloged ids with a
 * documented list (sonic-3.5, sonic-3 and their dated snapshots) take the 42.
 * The aliases whose backing model no page names are in
 * {@link CARTESIA_TTS_ALIAS_LANGUAGES} instead.
 */
export const CARTESIA_TTS_LANGUAGES_BY_MODEL = {
  "sonic-3.6": SONIC_3_6_LANGUAGE_VALUES,
  "sonic-3.6-2026-08-27": SONIC_3_6_LANGUAGE_VALUES,
} as const satisfies Partial<Record<CartesiaTtsModelId, readonly string[]>>;

// The TTS aliases whose backing model no page names, each mapped to the
// `language` / `locale` values it takes without a warning. ./tts reports
// anything else on these ids at *warning* severity, never as an error: a beta
// or aliased model may serve values no page lists for it.
// - `sonic-preview` takes the Sonic 3.6 values. The api-changes "Stable
//   offerings" row is "| `sonic-preview` | Beta, changes without notice | See
//   [continuous updates](/build-with-cartesia/tts-models/latest#continuous-updates-recommended) |"
//   (https://docs.cartesia.ai/build-with-cartesia/tts-models/api-changes), so
//   its "Supported Languages" cell points at the Sonic 3.6 page. That page
//   lists it as "Beta model, will always be updated with upcoming changes"
//   (https://docs.cartesia.ai/build-with-cartesia/tts-models/latest). Step 3 of
//   the changelog's Sonic 3.6 "How to try it" is "Try it in the [TTS
//   Playground](https://play.cartesia.ai/text-to-speech?modelId=sonic-preview)."
//   (https://docs.cartesia.ai/changelog/2026). All read 2026-11-12.
// - `sonic-latest` and `sonic-3-latest` take the 42 every Sonic 3 model
//   shares. They are deprecated pointers at `sonic-preview` — "| `sonic-latest`
//   | `sonic-preview` |" and "| `sonic-3-latest` | `sonic-preview` |"
//   (https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models,
//   2026-11-12) — and no page lists their languages, so a Sonic 3.6 value on
//   them is a warning ("may be refused").
export const CARTESIA_TTS_ALIAS_LANGUAGES = {
  "sonic-preview": SONIC_3_6_LANGUAGE_VALUES,
  "sonic-latest": CARTESIA_TTS_LANGUAGES,
  "sonic-3-latest": CARTESIA_TTS_LANGUAGES,
} as const satisfies Partial<Record<CartesiaTtsModelId, readonly string[]>>;

/**
 * The `language` enum POST /stt publishes (Cartesia-Version 2026-03-01) —
 * https://docs.cartesia.ai/2026-03-01/api-reference/stt/transcribe, transcribed in doc
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
