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
  // "a beta model, not intended for production usage, and can change without
  // notice". What the alias serves moves: "Sonic 3.6 is only available as a
  // beta release, available on `sonic-preview` today" —
  // docs.cartesia.ai/build-with-cartesia/tts-models/preview (2026-08-24).
  // There is NO `sonic-3.6` model_id; this alias is the only way to reach it.
  "sonic-preview": {
    id: "sonic-preview",
    name: "Sonic Preview (currently Sonic 3.6 beta)",
    family: "sonic",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "beta",
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

/** The 42 language codes the tts/bytes docs enumerate (2026-03-01). */
export const CARTESIA_TTS_LANGUAGES = [
  "en", "fr", "de", "es", "pt", "zh", "ja", "hi", "it", "ko",
  "nl", "pl", "ru", "sv", "tr", "tl", "bg", "ro", "ar", "cs",
  "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "hu", "no",
  "vi", "bn", "th", "he", "ka", "id", "te", "gu", "kn", "ml",
  "mr", "pa",
] as const;

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
