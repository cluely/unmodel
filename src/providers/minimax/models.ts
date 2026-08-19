// Hand-maintained — models.dev's minimax snapshot carries only the text
// models (src/catalog/minimax.gen.ts; its MinimaxAudioModelId /
// MinimaxVideoModelId unions are `never`), so the speech and video ids live
// here. Refresh from
//   https://platform.minimax.io/docs/api-reference/speech-t2a-http   (T2A v2 model enum, text cap)
//   https://platform.minimax.io/docs/api-reference/video-generation-t2v   (video model enums)
//   https://platform.minimax.io/docs/api-reference/video-generation-i2v   (i2v-only models)
//   https://platform.minimax.io/docs/api-reference/video-generation-v2-create (MiniMax-H3)
//   https://platform.minimax.io/docs/guides/pricing-paygo           (USD list prices)
// Verified 2026-08-13. This is the INTERNATIONAL platform (api.minimax.io);
// the China platform is the separate minimax-cn catalog.
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - T2A is quoted directly per 1M characters: $100/M for the -hd tiers,
//   $60/M for the -turbo tiers → ModelCost.perMillionCharacters verbatim.
//   speech-01-hd / speech-01-turbo are ACCEPTED by the API but absent from
//   every published price table, so they carry no `cost` rather than quoting
//   a rate MiniMax does not publish.
// - Video is quoted as a FLAT price per finished video that depends on the
//   model, resolution AND duration (e.g. MiniMax-Hailuo-2.3: $0.28 for 768P
//   6s, $0.56 for 768P 10s, $0.49 for 1080P 6s). `ModelCost` has only
//   `perVideoSecond`, so each entry below carries the rate implied by the
//   DEFAULT resolution at 6s (768P for the Hailuo line: 0.28 / 6), and
//   ./video-generation prices the exact request from the full table in
//   VIDEO_PRICE_USD. Reading `cost.perVideoSecond` alone therefore gives the
//   default-configuration rate, not every configuration's rate.
// - MiniMax-H3 is genuinely billed per second of output: $0.08/s at 768P
//   (the entry's `perVideoSecond`) and $0.13/s at 2K (an override in
//   ./video-generation-v2, mirroring the Veo pattern). Input material is
//   billed separately (images beyond the first 5 at $0.04 each; reference
//   video by input duration) — see ./video-generation-v2.
// - The 01-generation video ids (T2V-01, T2V-01-Director, I2V-01,
//   I2V-01-Director, I2V-01-live, S2V-01) are documented API values with no
//   published USD rate, so they carry no `cost`.
//
// `limit.context: 0` — none of these are token-context models (HAND_CATALOGS.md).

import type { ModelInfo } from "../../core/catalog-types";

/**
 * "Must be less than 10,000 characters" — the T2A v2 `text` field. Rides on
 * `limit.characters`; ./t2a reports text ABOVE this as over_output_limit (a
 * request of exactly 10,000 characters is left alone rather than failing a
 * request on an off-by-one reading of the docs).
 */
export const T2A_MAX_CHARACTERS = 10000;

/** $100 per 1M characters — the speech-*-hd tiers. */
export const T2A_HD_PER_MILLION_CHARACTERS = 100;
/** $60 per 1M characters — the speech-*-turbo tiers. */
export const T2A_TURBO_PER_MILLION_CHARACTERS = 60;

/** Shared shape of every T2A catalog entry. */
const T2A = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  limit: { context: 0, characters: T2A_MAX_CHARACTERS },
} as const;

/** Model ids POST /v1/t2a_v2 accepts. */
export const speechModels = {
  "speech-2.8-hd": {
    id: "speech-2.8-hd",
    name: "Speech 2.8 HD",
    family: "speech-2.8",
    ...T2A,
    cost: { perMillionCharacters: T2A_HD_PER_MILLION_CHARACTERS },
  },
  "speech-2.8-turbo": {
    id: "speech-2.8-turbo",
    name: "Speech 2.8 Turbo",
    family: "speech-2.8",
    ...T2A,
    cost: { perMillionCharacters: T2A_TURBO_PER_MILLION_CHARACTERS },
  },
  "speech-2.6-hd": {
    id: "speech-2.6-hd",
    name: "Speech 2.6 HD",
    family: "speech-2.6",
    ...T2A,
    cost: { perMillionCharacters: T2A_HD_PER_MILLION_CHARACTERS },
  },
  "speech-2.6-turbo": {
    id: "speech-2.6-turbo",
    name: "Speech 2.6 Turbo",
    family: "speech-2.6",
    ...T2A,
    cost: { perMillionCharacters: T2A_TURBO_PER_MILLION_CHARACTERS },
  },
  "speech-02-hd": {
    id: "speech-02-hd",
    name: "Speech 02 HD",
    family: "speech-02",
    ...T2A,
    cost: { perMillionCharacters: T2A_HD_PER_MILLION_CHARACTERS },
  },
  "speech-02-turbo": {
    id: "speech-02-turbo",
    name: "Speech 02 Turbo",
    family: "speech-02",
    ...T2A,
    cost: { perMillionCharacters: T2A_TURBO_PER_MILLION_CHARACTERS },
  },
  // The T2A-01 generation; MiniMax exposes it as speech-01-*. Still in the
  // API's model enum, absent from every published price table (no `cost`).
  "speech-01-hd": {
    id: "speech-01-hd",
    name: "Speech 01 HD (T2A-01-HD)",
    family: "speech-01",
    ...T2A,
  },
  "speech-01-turbo": {
    id: "speech-01-turbo",
    name: "Speech 01 Turbo (T2A-01-Turbo)",
    family: "speech-01",
    ...T2A,
  },
} as const satisfies Record<string, ModelInfo>;

/** Shared shape of every video catalog entry. */
const VIDEO = {
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  limit: { context: 0 },
} as const;

/**
 * Models POST /v1/video_generation accepts. Each documents which inputs it
 * takes; ./video-generation enforces the pairing rules.
 */
export const videoModels = {
  "MiniMax-Hailuo-2.3": {
    id: "MiniMax-Hailuo-2.3",
    name: "MiniMax Hailuo 2.3",
    family: "hailuo-2.3",
    ...VIDEO,
    // Text-to-video and image-to-video (first frame).
    modalities: { input: ["text", "image"], output: ["video"] },
    // $0.28 per 768P 6s video (the default configuration) → per second.
    cost: { perVideoSecond: 0.28 / 6 },
  },
  "MiniMax-Hailuo-2.3-Fast": {
    id: "MiniMax-Hailuo-2.3-Fast",
    name: "MiniMax Hailuo 2.3 Fast",
    family: "hailuo-2.3",
    ...VIDEO,
    // Image-to-video only.
    modalities: { input: ["text", "image"], output: ["video"] },
    // $0.19 per 768P 6s video → per second.
    cost: { perVideoSecond: 0.19 / 6 },
  },
  "MiniMax-Hailuo-02": {
    id: "MiniMax-Hailuo-02",
    name: "MiniMax Hailuo 02",
    family: "hailuo-02",
    ...VIDEO,
    // Text-to-video, image-to-video, and first & last frame.
    modalities: { input: ["text", "image"], output: ["video"] },
    // $0.28 per 768P 6s video → per second.
    cost: { perVideoSecond: 0.28 / 6 },
  },
  "T2V-01-Director": {
    id: "T2V-01-Director",
    name: "T2V-01-Director",
    family: "video-01",
    ...VIDEO,
    attachment: false,
    modalities: { input: ["text"], output: ["video"] },
  },
  "T2V-01": {
    id: "T2V-01",
    name: "T2V-01",
    family: "video-01",
    ...VIDEO,
    attachment: false,
    modalities: { input: ["text"], output: ["video"] },
  },
  "I2V-01-Director": {
    id: "I2V-01-Director",
    name: "I2V-01-Director",
    family: "video-01",
    ...VIDEO,
    modalities: { input: ["text", "image"], output: ["video"] },
  },
  "I2V-01-live": {
    id: "I2V-01-live",
    name: "I2V-01-live",
    family: "video-01",
    ...VIDEO,
    modalities: { input: ["text", "image"], output: ["video"] },
  },
  "I2V-01": {
    id: "I2V-01",
    name: "I2V-01",
    family: "video-01",
    ...VIDEO,
    modalities: { input: ["text", "image"], output: ["video"] },
  },
  "S2V-01": {
    id: "S2V-01",
    name: "S2V-01",
    family: "video-01",
    ...VIDEO,
    modalities: { input: ["text", "image"], output: ["video"] },
  },
} as const satisfies Record<string, ModelInfo>;

/** Models POST /v2/video_generation accepts (the H3 multimodal route). */
export const videoV2Models = {
  "MiniMax-H3": {
    id: "MiniMax-H3",
    name: "MiniMax H3",
    family: "h3",
    ...VIDEO,
    openWeights: true,
    modalities: { input: ["text", "image", "video", "audio"], output: ["video"] },
    // $0.08 per second at 768P; 2K ($0.13/s) is an override in
    // ./video-generation-v2.
    cost: { perVideoSecond: 0.08 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * The hand-maintained MiniMax media catalog (speech + video). The provider's
 * TEXT catalog is generated — `src/catalog/minimax.gen.ts` — and is exported
 * from ./index as `models`; this one is exported there as `mediaModels`.
 */
export const models = {
  ...speechModels,
  ...videoModels,
  ...videoV2Models,
} as const satisfies Record<string, ModelInfo>;

export type MinimaxSpeechModelId = keyof typeof speechModels;
export type MinimaxVideoGenerationModelId = keyof typeof videoModels;
export type MinimaxVideoV2ModelId = keyof typeof videoV2Models;
export type MinimaxMediaModelId = keyof typeof models;

/** Runtime allow-list backing the t2a endpoint's model gate. */
export const SPEECH_MODEL_IDS: readonly string[] = Object.keys(speechModels);
/** Runtime allow-list backing the v1 video endpoint's model gate. */
export const VIDEO_MODEL_IDS: readonly string[] = Object.keys(videoModels);
