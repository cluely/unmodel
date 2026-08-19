// Hand-maintained — Cartesia is not in models.dev; refresh from
// https://docs.cartesia.ai/api-reference/tts/bytes,
// https://docs.cartesia.ai/api-reference/stt/transcribe,
// https://docs.cartesia.ai/build-with-cartesia/models/tts, and
// https://docs.cartesia.ai/pricing (last checked 2026-08-13).
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
// page — the older-models page is behind the docs login, so no id, status or
// pricing can be sourced for them. Likewise `ink-2-turn-detection-end_turn`:
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
  // notice" — docs.cartesia.ai/build-with-cartesia/models/tts.
  "sonic-preview": {
    id: "sonic-preview",
    name: "Sonic Preview",
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
} as const satisfies Record<string, ModelInfo>;

export type CartesiaModelId = keyof typeof models;
/** TTS (sonic-*) model ids. */
export type CartesiaTtsModelId = Extract<CartesiaModelId, `sonic${string}`>;

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
