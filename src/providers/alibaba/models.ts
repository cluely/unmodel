// Hand-maintained — models.dev's alibaba snapshot carries only the text and
// omni chat models (src/catalog/alibaba.gen.ts; its AlibabaVideoModelId union
// is `never` and AlibabaAudioModelId names only the qwen-omni chat ids), so
// the DashScope video-synthesis and Qwen-TTS ids live here. Refresh from
//   https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference   (wan3.0-video)
//   https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference           (wan t2v ids + protocols)
//   https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference  (wan2.7 i2v)
//   https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference
//   https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference
//   https://www.alibabacloud.com/help/en/model-studio/happyhorse-reference-to-video-api-reference
//   https://www.alibabacloud.com/help/en/model-studio/happyhorse-video-edit-api-reference
//   https://www.alibabacloud.com/help/en/model-studio/qwen-tts        (TTS endpoint + intl model list)
//   https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api    (TTS request/response reference)
//   https://www.alibabacloud.com/help/en/model-studio/realtime-tts-user-guide (WebSocket-only TTS ids)
//   https://www.alibabacloud.com/help/en/model-studio/model-pricing   (USD list prices, Singapore tables)
// (last checked 2026-08-24). This is the INTERNATIONAL platform; the China
// (Beijing) deployment publishes different prices and extra ids.
//
// MODEL IDS: two of the video ids below — `wan2.7-t2v-2026-04-25` and
// `wan2.7-i2v` — appear (as International, with USD rates) only on the
// pricing page; the API references' own model lists name `wan2.7-t2v`,
// `wan2.7-t2v-2026-06-12` and `wan2.7-i2v-2026-04-25`. They are kept because
// Alibaba bills them as callable international ids. The Beijing-only
// `qwen-tts` / `qwen-tts-latest` / `qwen-tts-2025-*` TTS ids are NOT
// catalogued: the international (Singapore) deployment does not serve them
// (the qwen-tts doc page lists them under "China (Beijing)" only), and their
// billing is per token where everything here is per character.
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - Video is quoted in USD per second of OUTPUT video, split by resolution
//   tier (Singapore tables of the pricing page). `ModelCost` has only one
//   `perVideoSecond`, so each entry carries the rate of its DEFAULT
//   resolution (1080P for every model whose default is 1080P/1920*1080;
//   wan2.1's default size is 1280*720 → the 720P rate), and ./video prices
//   the exact request from the full per-tier table in
//   VIDEO_PRICE_PER_SECOND_USD. Reading `cost.perVideoSecond` alone therefore
//   gives the default-configuration rate, not every configuration's rate.
// - `wan3.0-video` has NO row in the international pricing tables (searched
//   the whole Singapore section 2026-08-24), so it carries no `cost` rather
//   than quoting fal-side marketing numbers Alibaba does not publish.
// - `happyhorse-1.0-video-edit` bills input AND output video duration
//   ("both input and output videos are billed by video duration"); its
//   `perVideoSecond` is the output rate, and ./video produces no estimate for
//   it because the request does not carry either duration.
// - TTS is quoted per 10,000 input characters (output audio is free):
//   qwen3-tts-flash $0.10/10K → $10 per 1M characters ($0.10 / 10_000 ×
//   1_000_000); qwen3-tts-instruct-flash $0.115/10K → $11.50/M;
//   qwen3-tts-flash-realtime $0.13/10K → $13/M; qwen3-tts-instruct-flash-
//   realtime $0.143/10K → $14.30/M; qwen-audio-3.0-tts-flash $0.15/10K →
//   $15/M; qwen-audio-3.0-tts-plus $0.20/10K → $20/M.
//
// `limit.context: 0` — none of these are token-context models (HAND_CATALOGS.md).
// The Qwen3-TTS `text` cap ("600 characters") rides on `limit.characters`.

import type { ModelInfo } from "../../core/catalog-types";

/** "600 characters" — the Qwen3-TTS-Flash / -Instruct-Flash `input.text` cap. */
export const TTS_MAX_CHARACTERS = 600;

/** $0.10 per 10K characters → USD per 1M characters. */
export const TTS_FLASH_PER_MILLION_CHARACTERS = 10;
/** $0.115 per 10K characters → USD per 1M characters. */
export const TTS_INSTRUCT_PER_MILLION_CHARACTERS = 11.5;

/** Shared shape of every video catalog entry. */
const VIDEO = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  limit: { context: 0 },
} as const;

const T2V_MODALITIES = { input: ["text"], output: ["video"] } as const;
const I2V_MODALITIES = { input: ["text", "image"], output: ["video"] } as const;
const V2V_MODALITIES = { input: ["text", "image", "video"], output: ["video"] } as const;

/**
 * Models POST /api/v1/services/aigc/video-generation/video-synthesis accepts
 * on the international platform. Each documents its own protocol (wan3 media
 * array / wan2.7 resolution+ratio / legacy `size` / happyhorse); ./video
 * encodes the differences in VIDEO_MODEL_RULES.
 */
export const videoModels = {
  // Wan 3.0 all-in-one (t2v / i2v / r2v / v2v through one `media` array).
  // No row in the international pricing tables → no `cost`.
  "wan3.0-video": {
    id: "wan3.0-video",
    name: "Wan 3.0 Video",
    family: "wan3.0",
    ...VIDEO,
    modalities: { input: ["text", "image", "video", "audio"], output: ["video"] },
  },
  // Wan 2.7 text-to-video ("new protocol": resolution + ratio).
  // $0.10/s at 720P, $0.15/s at 1080P (default) → default-config rate 0.15.
  "wan2.7-t2v": {
    id: "wan2.7-t2v",
    name: "Wan 2.7 T2V",
    family: "wan2.7",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  "wan2.7-t2v-2026-06-12": {
    id: "wan2.7-t2v-2026-06-12",
    name: "Wan 2.7 T2V (2026-06-12)",
    family: "wan2.7",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // Pricing-page id (International, $0.10/$0.15 per second); the t2v API
  // reference's model list names only the two ids above.
  "wan2.7-t2v-2026-04-25": {
    id: "wan2.7-t2v-2026-04-25",
    name: "Wan 2.7 T2V (2026-04-25)",
    family: "wan2.7",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // Wan 2.7 image-to-video (media array: first_frame / last_frame /
  // driving_audio / first_clip). $0.10/s 720P, $0.15/s 1080P (default).
  "wan2.7-i2v-2026-04-25": {
    id: "wan2.7-i2v-2026-04-25",
    name: "Wan 2.7 I2V (2026-04-25)",
    family: "wan2.7",
    ...VIDEO,
    modalities: V2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // Pricing-page id (International); the i2v API reference documents only the
  // dated snapshot above.
  "wan2.7-i2v": {
    id: "wan2.7-i2v",
    name: "Wan 2.7 I2V",
    family: "wan2.7",
    ...VIDEO,
    modalities: V2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // Legacy protocol (`size` strings). $0.10/s 720P, $0.15/s 1080P (default
  // size 1920*1080).
  "wan2.6-t2v": {
    id: "wan2.6-t2v",
    name: "Wan 2.6 T2V",
    family: "wan2.6",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // US (Virginia) region variant; same international list prices.
  "wan2.6-t2v-us": {
    id: "wan2.6-t2v-us",
    name: "Wan 2.6 T2V (US)",
    family: "wan2.6",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // $0.05/s 480P, $0.10/s 720P, $0.15/s 1080P (default size 1920*1080).
  "wan2.5-t2v-preview": {
    id: "wan2.5-t2v-preview",
    name: "Wan 2.5 T2V Preview",
    family: "wan2.5",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.15 },
  },
  // $0.02/s 480P, $0.10/s 1080P (default size 1920*1080).
  "wan2.2-t2v-plus": {
    id: "wan2.2-t2v-plus",
    name: "Wan 2.2 T2V Plus",
    family: "wan2.2",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.1 },
  },
  // $0.036/s at both 480P and 720P (default size 1280*720).
  "wan2.1-t2v-turbo": {
    id: "wan2.1-t2v-turbo",
    name: "Wan 2.1 T2V Turbo",
    family: "wan2.1",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.036 },
  },
  // $0.10/s 720P (the only tier; default size 1280*720).
  "wan2.1-t2v-plus": {
    id: "wan2.1-t2v-plus",
    name: "Wan 2.1 T2V Plus",
    family: "wan2.1",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.1 },
  },
  // HappyHorse. $0.14/s 720P; 1080P (default) is $0.18/s on the 1.1
  // generation and $0.24/s on the 1.0 generation.
  "happyhorse-1.1-t2v": {
    id: "happyhorse-1.1-t2v",
    name: "HappyHorse 1.1 T2V",
    family: "happyhorse-1.1",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.18 },
  },
  "happyhorse-1.0-t2v": {
    id: "happyhorse-1.0-t2v",
    name: "HappyHorse 1.0 T2V",
    family: "happyhorse-1.0",
    ...VIDEO,
    modalities: T2V_MODALITIES,
    cost: { perVideoSecond: 0.24 },
  },
  "happyhorse-1.1-i2v": {
    id: "happyhorse-1.1-i2v",
    name: "HappyHorse 1.1 I2V",
    family: "happyhorse-1.1",
    ...VIDEO,
    modalities: I2V_MODALITIES,
    cost: { perVideoSecond: 0.18 },
  },
  "happyhorse-1.0-i2v": {
    id: "happyhorse-1.0-i2v",
    name: "HappyHorse 1.0 I2V",
    family: "happyhorse-1.0",
    ...VIDEO,
    modalities: I2V_MODALITIES,
    cost: { perVideoSecond: 0.24 },
  },
  "happyhorse-1.1-r2v": {
    id: "happyhorse-1.1-r2v",
    name: "HappyHorse 1.1 R2V",
    family: "happyhorse-1.1",
    ...VIDEO,
    modalities: I2V_MODALITIES,
    cost: { perVideoSecond: 0.18 },
  },
  "happyhorse-1.0-r2v": {
    id: "happyhorse-1.0-r2v",
    name: "HappyHorse 1.0 R2V",
    family: "happyhorse-1.0",
    ...VIDEO,
    modalities: I2V_MODALITIES,
    cost: { perVideoSecond: 0.24 },
  },
  // Bills input + output duration; the request carries neither, so ./video
  // produces no estimate for it (the rate here is the output rate at 1080P).
  "happyhorse-1.0-video-edit": {
    id: "happyhorse-1.0-video-edit",
    name: "HappyHorse 1.0 Video Edit",
    family: "happyhorse-1.0",
    ...VIDEO,
    modalities: V2V_MODALITIES,
    cost: { perVideoSecond: 0.24 },
  },
} as const satisfies Record<string, ModelInfo>;

/** Shared shape of every TTS catalog entry. */
const TTS = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  limit: { context: 0, characters: TTS_MAX_CHARACTERS },
} as const;

/**
 * Model ids POST /api/v1/services/aigc/multimodal-generation/generation
 * accepts on the international platform (the unary HTTP TTS route).
 */
export const ttsModels = {
  "qwen3-tts-flash": {
    id: "qwen3-tts-flash",
    name: "Qwen3 TTS Flash",
    family: "qwen3-tts",
    ...TTS,
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
  "qwen3-tts-flash-2025-11-27": {
    id: "qwen3-tts-flash-2025-11-27",
    name: "Qwen3 TTS Flash (2025-11-27)",
    family: "qwen3-tts",
    ...TTS,
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
  "qwen3-tts-flash-2025-09-18": {
    id: "qwen3-tts-flash-2025-09-18",
    name: "Qwen3 TTS Flash (2025-09-18)",
    family: "qwen3-tts",
    ...TTS,
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
  "qwen3-tts-instruct-flash": {
    id: "qwen3-tts-instruct-flash",
    name: "Qwen3 TTS Instruct Flash",
    family: "qwen3-tts-instruct",
    ...TTS,
    cost: { perMillionCharacters: TTS_INSTRUCT_PER_MILLION_CHARACTERS },
  },
  "qwen3-tts-instruct-flash-2026-01-26": {
    id: "qwen3-tts-instruct-flash-2026-01-26",
    name: "Qwen3 TTS Instruct Flash (2026-01-26)",
    family: "qwen3-tts-instruct",
    ...TTS,
    cost: { perMillionCharacters: TTS_INSTRUCT_PER_MILLION_CHARACTERS },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Realtime speech synthesis ids — WebSocket ONLY
 * (wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime on the legacy intl
 * domain; workspace-scoped hosts expose wss://{WorkspaceId}.{region}
 * .maas.aliyuncs.com/api-ws/v1/inference). Listed for catalog completeness,
 * and the unary text-to-speech validator rejects them because
 * POST /api/v1/services/aigc/multimodal-generation/generation cannot serve
 * them. unmodel does not build a WebSocket validator for this route.
 * Character caps are not documented per frame, so no `limit.characters`.
 */
export const realtimeTtsModels = {
  "qwen-audio-3.0-tts-plus": {
    id: "qwen-audio-3.0-tts-plus",
    name: "Qwen Audio 3.0 TTS Plus (realtime)",
    family: "qwen-audio-3.0-tts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    // $0.20 per 10K characters → $20 per 1M characters.
    cost: { perMillionCharacters: 20 },
  },
  "qwen-audio-3.0-tts-flash": {
    id: "qwen-audio-3.0-tts-flash",
    name: "Qwen Audio 3.0 TTS Flash (realtime)",
    family: "qwen-audio-3.0-tts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    // $0.15 per 10K characters → $15 per 1M characters.
    cost: { perMillionCharacters: 15 },
  },
  "qwen3-tts-flash-realtime": {
    id: "qwen3-tts-flash-realtime",
    name: "Qwen3 TTS Flash Realtime",
    family: "qwen3-tts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    // $0.13 per 10K characters → $13 per 1M characters.
    cost: { perMillionCharacters: 13 },
  },
  "qwen3-tts-instruct-flash-realtime": {
    id: "qwen3-tts-instruct-flash-realtime",
    name: "Qwen3 TTS Instruct Flash Realtime",
    family: "qwen3-tts-instruct",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    // $0.143 per 10K characters → $14.30 per 1M characters.
    cost: { perMillionCharacters: 14.3 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * The hand-maintained Alibaba media catalog (video + speech). The provider's
 * TEXT catalog is generated — `src/catalog/alibaba.gen.ts` — and stays the
 * `models` export of ./index; this one is exported there as `mediaModels`.
 */
export const models = {
  ...videoModels,
  ...ttsModels,
  ...realtimeTtsModels,
} as const satisfies Record<string, ModelInfo>;

// ---------------------------------------------------------------------------
// TTS wire enums — declared in this import-free leaf (smallest-ai precedent)
// so `unmodel/alibaba/values` and the `tts-params` table can read them without
// pulling the validator, its zod schema or the compile helpers.
// ---------------------------------------------------------------------------

/**
 * `input.language_type` — English words, not BCP-47 tags; default "Auto".
 * From https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api
 * (2026-08-24).
 */
export const LANGUAGE_TYPES = [
  "Auto",
  "Chinese",
  "English",
  "German",
  "Italian",
  "Portuguese",
  "Spanish",
  "Japanese",
  "Korean",
  "French",
  "Russian",
] as const;
export type AlibabaLanguageType = (typeof LANGUAGE_TYPES)[number];

/**
 * The `voice` values, verbatim from
 * https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-list
 * (transcribed 2026-08-24) — including multi-word names ("Eldric Sage",
 * "Ono Anna", "Radio Gol") and the dialect voices, whose wire value is the
 * bare name (the page titles them "Shanghai - Jada" etc.; the parameter is
 * "Jada").
 */
export const QWEN3_TTS_FLASH_VOICES = [
  "Cherry",
  "Serena",
  "Ethan",
  "Chelsie",
  "Momo",
  "Vivian",
  "Moon",
  "Maia",
  "Kai",
  "Nofish",
  "Bella",
  "Jennifer",
  "Ryan",
  "Katerina",
  "Aiden",
  "Eldric Sage",
  "Mia",
  "Mochi",
  "Bellona",
  "Vincent",
  "Bunny",
  "Neil",
  "Elias",
  "Arthur",
  "Nini",
  "Seren",
  "Pip",
  "Stella",
  "Bodega",
  "Sonrisa",
  "Alek",
  "Dolce",
  "Sohee",
  "Ono Anna",
  "Lenn",
  "Emilien",
  "Andre",
  "Radio Gol",
  "Jada",
  "Dylan",
  "Li",
  "Marcus",
  "Roy",
  "Peter",
  "Sunny",
  "Eric",
  "Rocky",
  "Kiki",
] as const;

/** The 2025-09-18 snapshot serves 17 of the 48. */
export const QWEN3_TTS_FLASH_2025_09_18_VOICES = [
  "Cherry",
  "Ethan",
  "Nofish",
  "Jennifer",
  "Ryan",
  "Katerina",
  "Elias",
  "Jada",
  "Dylan",
  "Li",
  "Marcus",
  "Roy",
  "Peter",
  "Sunny",
  "Eric",
  "Rocky",
  "Kiki",
] as const;

export const QWEN3_TTS_INSTRUCT_FLASH_VOICES = [
  "Cherry",
  "Serena",
  "Ethan",
  "Chelsie",
  "Momo",
  "Vivian",
  "Moon",
  "Maia",
  "Kai",
  "Nofish",
  "Bella",
  "Eldric Sage",
  "Mia",
  "Mochi",
  "Bellona",
  "Vincent",
  "Bunny",
  "Neil",
  "Elias",
  "Arthur",
  "Nini",
  "Seren",
  "Pip",
  "Stella",
] as const;

/** Runtime lookup backing the TTS validator's checkVoice. */
export const VOICES_BY_MODEL: Readonly<Partial<Record<string, readonly string[]>>> = {
  "qwen3-tts-flash": QWEN3_TTS_FLASH_VOICES,
  "qwen3-tts-flash-2025-11-27": QWEN3_TTS_FLASH_VOICES,
  "qwen3-tts-flash-2025-09-18": QWEN3_TTS_FLASH_2025_09_18_VOICES,
  "qwen3-tts-instruct-flash": QWEN3_TTS_INSTRUCT_FLASH_VOICES,
  "qwen3-tts-instruct-flash-2026-01-26": QWEN3_TTS_INSTRUCT_FLASH_VOICES,
};

/** The Instruct-Flash ids (`input.instructions` / `optimize_instructions`). */
export const INSTRUCT_TTS_MODEL_ID_SET: ReadonlySet<string> = new Set([
  "qwen3-tts-instruct-flash",
  "qwen3-tts-instruct-flash-2026-01-26",
]);

export type AlibabaVideoGenerationModelId = keyof typeof videoModels;
export type AlibabaTtsGenerationModelId = keyof typeof ttsModels;
/** WebSocket-only TTS ids — not accepted by the unary HTTP endpoint. */
export type AlibabaRealtimeTtsModelId = keyof typeof realtimeTtsModels;
export type AlibabaMediaModelId = keyof typeof models;

/** Runtime allow-list backing the video endpoint's model gate. */
export const VIDEO_MODEL_IDS: readonly string[] = Object.keys(videoModels);
/** Runtime allow-list backing the unary TTS endpoint's model gate. */
export const TTS_MODEL_IDS: readonly string[] = Object.keys(ttsModels);
/**
 * Runtime list backing the realtime rejection message — the inverse of
 * {@link TTS_MODEL_IDS}: these ids are WebSocket-only.
 */
export const REALTIME_TTS_MODEL_IDS: readonly string[] = Object.keys(realtimeTtsModels);
