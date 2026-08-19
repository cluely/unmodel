// Hand-maintained — ElevenLabs is not in models.dev; refresh from
//   https://elevenlabs.io/docs/models            (model ids, per-request character limits, deprecations)
//   https://elevenlabs.io/pricing/api            (usage-based API rates, billed in USD)
//   https://elevenlabs.io/docs/api-reference/speech-to-text/convert (batch STT model ids)
// Verified 2026-08-13.
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - TTS Multilingual v2 / v3 class: $0.10 per 1,000 characters
//   → 0.10 × 1,000 = $100 per 1M characters (ModelCost.perMillionCharacters).
// - TTS Flash / Turbo class: $0.05 per 1,000 characters
//   → 0.05 × 1,000 = $50 per 1M characters.
// - STT Scribe (batch): $0.22 per hour of transcribed audio
//   → 0.22 / 60 ≈ $0.003667 per minute (ModelCost.perAudioMinute).
//   The pricing page does not differentiate scribe_v1 from scribe_v2, so both
//   carry the same rate.
// - STT Scribe v2 Realtime: $0.39 per hour → 0.39 / 60 = $0.0065 per minute.
//   elevenlabs.io/pricing/api prices it separately from batch Scribe.
// - Eleven Music: $0.15 per minute of GENERATED audio (elevenlabs.io/pricing/api,
//   "Music" row). It rides on ModelCost.perAudioMinute — the only per-minute
//   audio unit the catalog has — but note the direction: for Scribe that field
//   means a minute of transcribed INPUT, for Music a minute of generated
//   OUTPUT. ./music computes the estimate from the requested track length.
//
// COVERAGE: this catalog lists every model id on elevenlabs.io/docs/models,
// including ids no unmodel endpoint can reach today (realtime STT, music,
// sound effects, speech-to-speech, text-to-voice). Each carries a comment
// naming the API that serves it; the text-to-speech and speech-to-text
// validators gate on the modality groups below so a music/realtime id is
// rejected instead of silently accepted. Models whose USD rate is not
// published on elevenlabs.io/pricing/api omit `cost` rather than guess.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "elevenlabs",
  name: "ElevenLabs",
  env: ["ELEVENLABS_API_KEY"],
  doc: "https://elevenlabs.io/docs/models",
} as const satisfies ProviderInfo;

/** $0.10 per 1k characters → USD per 1M characters. */
const TTS_STANDARD_PER_MILLION_CHARACTERS = 100;
/** $0.05 per 1k characters → USD per 1M characters. */
const TTS_FLASH_PER_MILLION_CHARACTERS = 50;
/** $0.22 per hour → USD per minute of transcribed audio. */
const SCRIBE_PER_AUDIO_MINUTE = 0.22 / 60;
/** $0.39 per hour → USD per minute (realtime Scribe). */
const SCRIBE_REALTIME_PER_AUDIO_MINUTE = 0.39 / 60;
/** Eleven Music: $0.15 per minute of generated audio. */
export const MUSIC_PER_AUDIO_MINUTE = 0.15;

const ttsModels = {
  eleven_v3: {
    id: "eleven_v3",
    name: "Eleven v3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    // 5,000 characters per request — https://elevenlabs.io/docs/models
    limit: { context: 0, characters: 5000 },
    cost: { perMillionCharacters: TTS_STANDARD_PER_MILLION_CHARACTERS },
  },
  eleven_multilingual_v2: {
    id: "eleven_multilingual_v2",
    name: "Eleven Multilingual v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    // 10,000 characters per request — https://elevenlabs.io/docs/models
    limit: { context: 0, characters: 10000 },
    cost: { perMillionCharacters: TTS_STANDARD_PER_MILLION_CHARACTERS },
  },
  eleven_flash_v2_5: {
    id: "eleven_flash_v2_5",
    name: "Eleven Flash v2.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    // 40,000 characters per request — https://elevenlabs.io/docs/models
    limit: { context: 0, characters: 40000 },
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
  eleven_flash_v2: {
    id: "eleven_flash_v2",
    name: "Eleven Flash v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    // 30,000 characters per request — https://elevenlabs.io/docs/models
    limit: { context: 0, characters: 30000 },
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
  eleven_turbo_v2_5: {
    id: "eleven_turbo_v2_5",
    name: "Eleven Turbo v2.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Deprecated in favour of eleven_flash_v2_5, to which the docs state it
    // is functionally equivalent (same limits) — https://elevenlabs.io/docs/models
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 40000 },
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
  eleven_turbo_v2: {
    id: "eleven_turbo_v2",
    name: "Eleven Turbo v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Deprecated in favour of eleven_flash_v2 (functionally equivalent).
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 30000 },
    cost: { perMillionCharacters: TTS_FLASH_PER_MILLION_CHARACTERS },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Batch Scribe models accepted by POST /v1/speech-to-text.
 */
const sttModels = {
  scribe_v2: {
    id: "scribe_v2",
    name: "Scribe v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
    cost: { perAudioMinute: SCRIBE_PER_AUDIO_MINUTE },
  },
  scribe_v1: {
    id: "scribe_v1",
    name: "Scribe v1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Deprecated in favour of scribe_v2 — https://elevenlabs.io/docs/models
    status: "deprecated",
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
    cost: { perAudioMinute: SCRIBE_PER_AUDIO_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * WebSocket-only STT. Listed for catalog completeness and pricing; the batch
 * `speechToText` validator rejects these ids because
 * POST /v1/speech-to-text cannot serve them.
 */
const realtimeSttModels = {
  scribe_v2_realtime: {
    id: "scribe_v2_realtime",
    name: "Scribe v2 Realtime",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["text"] },
    limit: { context: 0 },
    cost: { perAudioMinute: SCRIBE_REALTIME_PER_AUDIO_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Speech-to-speech (voice changer) models — POST /v1/speech-to-speech/{voice_id},
 * which unmodel does not validate. elevenlabs.io/pricing/api publishes no
 * separate USD rate for them, so `cost` is omitted.
 */
const speechToSpeechModels = {
  eleven_multilingual_sts_v2: {
    id: "eleven_multilingual_sts_v2",
    name: "Eleven Multilingual Speech to Speech v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    // 10,000 characters per request — https://elevenlabs.io/docs/models
    limit: { context: 0, characters: 10000 },
  },
  eleven_english_sts_v2: {
    id: "eleven_english_sts_v2",
    name: "Eleven English Speech to Speech v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0, characters: 10000 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Text-to-voice (voice design) models — POST /v1/text-to-voice, which unmodel
 * does not validate. No separate USD rate is published.
 */
const textToVoiceModels = {
  eleven_ttv_v3: {
    id: "eleven_ttv_v3",
    name: "Eleven v3 Text to Voice",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  eleven_multilingual_ttv_v2: {
    id: "eleven_multilingual_ttv_v2",
    name: "Eleven Multilingual Text to Voice v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Music (POST /v1/music — validated by ./music) and sound-effects
 * (POST /v1/sound-generation — not validated by unmodel) models. The music
 * ids carry the $0.15-per-generated-minute rate; sound effects publish no USD
 * rate on elevenlabs.io/pricing/api, so that entry omits `cost`.
 */
const generativeAudioModels = {
  music_v2: {
    id: "music_v2",
    name: "Eleven Music v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perAudioMinute: MUSIC_PER_AUDIO_MINUTE },
  },
  music_v1: {
    id: "music_v1",
    name: "Eleven Music v1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perAudioMinute: MUSIC_PER_AUDIO_MINUTE },
  },
  eleven_text_to_sound_v2: {
    id: "eleven_text_to_sound_v2",
    name: "Eleven Text to Sound v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...ttsModels,
  ...sttModels,
  ...realtimeSttModels,
  ...speechToSpeechModels,
  ...textToVoiceModels,
  ...generativeAudioModels,
} as const satisfies Record<string, ModelInfo>;

/** Model ids POST /v1/music accepts. */
const musicModels = {
  music_v2: generativeAudioModels.music_v2,
  music_v1: generativeAudioModels.music_v1,
} as const satisfies Record<string, ModelInfo>;

/** Model ids POST /v1/text-to-speech/{voice_id} accepts. */
export type ElevenlabsTtsModelId = keyof typeof ttsModels;
/** Model ids POST /v1/music accepts. */
export type ElevenlabsMusicModelId = keyof typeof musicModels;
/** Model ids batch POST /v1/speech-to-text accepts. */
export type ElevenlabsSttModelId = keyof typeof sttModels;
/** WebSocket-only STT ids — not accepted by the batch endpoint. */
export type ElevenlabsRealtimeSttModelId = keyof typeof realtimeSttModels;
export type ElevenlabsModelId = keyof typeof models;

/** Runtime allow-list backing the text-to-speech endpoint's model gate. */
export const TTS_MODEL_IDS: readonly string[] = Object.keys(ttsModels);
/** Runtime allow-list backing the batch speech-to-text endpoint's model gate. */
export const STT_MODEL_IDS: readonly string[] = Object.keys(sttModels);
/**
 * Runtime allow-list backing the realtime speech-to-text socket's model gate —
 * the inverse of {@link STT_MODEL_IDS}: these ids are WebSocket-only, and the
 * batch ids are not accepted on the socket.
 */
export const REALTIME_STT_MODEL_IDS: readonly string[] = Object.keys(realtimeSttModels);
/** Runtime allow-list backing the music endpoint's model gate. */
export const MUSIC_MODEL_IDS: readonly string[] = Object.keys(musicModels);
