// Hand-maintained — ElevenLabs is not in models.dev; refresh from
//   https://elevenlabs.io/docs/models            (model ids, per-request character limits, deprecations)
//   https://elevenlabs.io/pricing/api            (usage-based API rates, billed in USD)
//   https://elevenlabs.io/docs/api-reference/speech-to-text/convert (batch STT model ids)
// Verified 2026-08-24.
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
// including ids no unmodel endpoint can reach today (realtime STT, sound
// effects, speech-to-speech). Each carries a comment naming the API that
// serves it; the text-to-speech, speech-to-text and voice-design validators
// gate on the modality groups below so a music/realtime id is rejected
// instead of silently accepted. Models whose USD rate is not published on
// elevenlabs.io/pricing/api omit `cost` rather than guess. One id (`ivc`) is
// SYNTHETIC — POST /v1/voices/add has no model field, and the id names the
// documented mode so the voice-clone validator has a catalog address.
//
// …with one documented exception to "every model id on /docs/models": the two
// DUBBING ids are real, selectable model ids that page does not list at all.
// `dubbing_v1` and `dubbing_v2` exist only as the `model_id` enum of
// POST /v1/dubbing/project, and their rates only on elevenlabs.io/pricing/api.
// Their block below carries the provenance sentence, the same way `ivc` does
// for its synthetic id. The rule the note encodes is unchanged: an id joins
// this catalog when ElevenLabs documents it somewhere a reader can check, and
// the comment says where.

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
/**
 * Dubbing v2: "Price per minute" $2.20 (elevenlabs.io/pricing/api).
 * Per minute of SOURCE media, per language target.
 */
export const DUBBING_V2_PER_AUDIO_MINUTE = 2.2;
/**
 * Dubbing v1: "Price per minute (without watermark)" $0.50. The $0.33
 * "with watermark" rate is deliberately NOT this number — see the dubbing
 * block below for why it is unreachable on the project surface.
 */
export const DUBBING_V1_PER_AUDIO_MINUTE = 0.5;
/**
 * Voice changer (speech-to-speech): $0.12 per minute of processed audio.
 *
 * https://elevenlabs.io/pricing/api, verified 2026-08-31, FAQ verbatim:
 * "Voice Changer and Voice Isolator $0.12 per minute. Sound Effects $0.12 per
 * minute." The page's own `voice_changer` card states the same number under
 * "Price per minute". The unit is a minute of INPUT audio, and
 * https://elevenlabs.io/docs/capabilities/voice-changer states the conversion
 * the character limits on these rows are quoted in: "Billing: 1,000 characters
 * per minute of processed audio".
 */
export const VOICE_CHANGER_PER_AUDIO_MINUTE = 0.12;
/**
 * Sound effects: $0.12 per minute of generated audio — same page, same
 * verified date, same sentence ("Sound Effects $0.12 per minute"), and the
 * page's `sound_effects` card carries it under "Price per minute" too. Here the
 * minute is OUTPUT, the way Eleven Music's is.
 */
export const SOUND_EFFECTS_PER_AUDIO_MINUTE = 0.12;

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
  // Legacy row the docs/models page still lists; kept for catalog
  // completeness per the COVERAGE note. No class rate is published for the
  // v1 generation on elevenlabs.io/pricing/api, so `cost` is omitted.
  eleven_multilingual_v1: {
    id: "eleven_multilingual_v1",
    name: "Eleven Multilingual v1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * WebSocket-only TTS. "Our most expressive, realtime speech synthesis model
 * (~280ms)" — elevenlabs.io/docs/models (2026-08-24). Served over the
 * realtime Text to Dialogue WebSocket, which unmodel does not validate;
 * listed for catalog completeness, and the unary text-to-speech validator
 * rejects it because POST /v1/text-to-speech/{voice_id} cannot serve it.
 * elevenlabs.io/pricing/api publishes no separate USD rate, so `cost` is
 * omitted.
 */
const realtimeTtsModels = {
  eleven_v3_conversational: {
    id: "eleven_v3_conversational",
    name: "Eleven v3 Conversational",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
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
 * `stt` validator rejects these ids because
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
 * which unmodel does not validate. elevenlabs.io/pricing/api prices the route
 * as "Voice Changer", per minute of processed audio — see
 * VOICE_CHANGER_PER_AUDIO_MINUTE for the quote and the character conversion.
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
    cost: { perAudioMinute: VOICE_CHANGER_PER_AUDIO_MINUTE },
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
    cost: { perAudioMinute: VOICE_CHANGER_PER_AUDIO_MINUTE },
  },
  // Legacy row the docs/models page still lists (English-only voice changer).
  eleven_english_sts_v1: {
    id: "eleven_english_sts_v1",
    name: "Eleven English Speech to Speech v1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perAudioMinute: VOICE_CHANGER_PER_AUDIO_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Text-to-voice (voice design) models — POST /v1/text-to-voice/design,
 * validated by ./voice-design (saving a preview is POST /v1/text-to-voice,
 * ./voice-design-save). No separate USD rate is published, so `cost` is
 * omitted.
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
 * Dubbing — POST /v1/dubbing/project, validated by ./dubbing (the language
 * targets that actually spend the rate are ./dubbing-language).
 *
 * PROVENANCE, because these two are the exception to the COVERAGE note above:
 * `dubbing_v1` and `dubbing_v2` are NOT listed on elevenlabs.io/docs/models.
 * They come from the `model_id` enum of the dubbing project-create body
 * (https://elevenlabs.io/docs/api-reference/dubbing/project/create, the only
 * place either id is selectable) and their rates from the API pricing table
 * (https://elevenlabs.io/pricing/api). Both verified 2026-08-26.
 *
 * The rates are per minute of SOURCE media, and they are spent once per
 * language target: the help centre's formula is model × duration × number of
 * languages, which is what `checkDubbingProject` computes. Note the direction
 * on `perAudioMinute` — for Scribe it means a minute of transcribed input, for
 * Music a minute of generated output, and here a minute of the source media
 * being dubbed.
 *
 * `dubbing_v1` carries the NO-WATERMARK rate ($0.50/min), not the $0.33
 * watermarked one, and that is a fact about the surface rather than a choice:
 * "Dubbing v2 does not include a watermark toggle… The legacy v1 dubbing flow
 * and Dubbing Studio were the only places where the watermark discount
 * existed" (elevenlabs.io/docs/overview/capabilities/dubbing). The project
 * route has no `watermark` field, so on this surface the discounted rate is
 * unreachable and a conditional cost would be a caveat pretending to be a
 * catalog entry.
 */
const dubbingModels = {
  dubbing_v2: {
    id: "dubbing_v2",
    name: "Dubbing v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Audio or video in, a dubbed audio track out: the v2 project surface's
    // only output field is `outputs.lossless_audio`, a signed URL for an
    // AUDIO track. A dubbed video comes from the legacy route or a Studio
    // render, neither of which unmodel serves.
    modalities: { input: ["audio", "video"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perAudioMinute: DUBBING_V2_PER_AUDIO_MINUTE },
  },
  dubbing_v1: {
    id: "dubbing_v1",
    name: "Dubbing v1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio", "video"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perAudioMinute: DUBBING_V1_PER_AUDIO_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Instant Voice Cloning — POST /v1/voices/add, validated by ./voice-clone.
 * The wire has no model field: `ivc` is a synthetic id naming the documented
 * mode (Instant Voice Cloning), which also reserves `pvc` for the separate
 * four-step Professional Voice Cloning flow (POST /v1/voices/pvc + samples /
 * verification / train), which unmodel does not validate. No USD rate is
 * published — cloning is bundled into subscription voice slots — so `cost`
 * is omitted.
 */
const voiceCloneModels = {
  ivc: {
    id: "ivc",
    name: "Instant Voice Cloning",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Music (POST /v1/music — validated by ./music) and sound-effects
 * (POST /v1/sound-generation — validated by ./sound-effects) models. The music
 * ids carry the $0.15-per-generated-minute rate; the sound-effects id carries
 * the $0.12 one — see SOUND_EFFECTS_PER_AUDIO_MINUTE for the quote.
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
    cost: { perAudioMinute: SOUND_EFFECTS_PER_AUDIO_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...ttsModels,
  ...realtimeTtsModels,
  ...sttModels,
  ...realtimeSttModels,
  ...speechToSpeechModels,
  ...textToVoiceModels,
  ...voiceCloneModels,
  ...dubbingModels,
  ...generativeAudioModels,
} as const satisfies Record<string, ModelInfo>;

/** Model ids POST /v1/music accepts. */
const musicModels = {
  music_v2: generativeAudioModels.music_v2,
  music_v1: generativeAudioModels.music_v1,
} as const satisfies Record<string, ModelInfo>;

/**
 * Model ids POST /v1/sound-generation accepts — the `SFXModelId` enum on
 * https://api.elevenlabs.io/openapi.json, which has exactly one member and
 * declares it the default.
 *
 * Disjoint from {@link musicModels} on purpose and by the API's own design:
 * `elevenlabs.music` refuses this id naming `/v1/music`'s two, and
 * `elevenlabs.sfx` refuses those two naming this one.
 */
const soundEffectsModels = {
  eleven_text_to_sound_v2: generativeAudioModels.eleven_text_to_sound_v2,
} as const satisfies Record<string, ModelInfo>;

/** Model ids POST /v1/text-to-speech/{voice_id} accepts. */
export type ElevenlabsTtsModelId = keyof typeof ttsModels;
/** Model ids POST /v1/music accepts. */
export type ElevenlabsMusicModelId = keyof typeof musicModels;
/** Model ids POST /v1/sound-generation accepts. */
export type ElevenlabsSfxModelId = keyof typeof soundEffectsModels;
/** Model ids batch POST /v1/speech-to-text accepts. */
export type ElevenlabsSttModelId = keyof typeof sttModels;
/** Model ids POST /v1/text-to-voice/design accepts. */
export type ElevenlabsVoiceDesignModelId = keyof typeof textToVoiceModels;
/** The synthetic id addressing POST /v1/voices/add (no model field on the wire). */
export type ElevenlabsVoiceCloneModelId = keyof typeof voiceCloneModels;
/** Model ids POST /v1/dubbing/project accepts as `model_id`. */
export type ElevenlabsDubbingModelId = keyof typeof dubbingModels;
/** WebSocket-only STT ids — not accepted by the batch endpoint. */
export type ElevenlabsRealtimeSttModelId = keyof typeof realtimeSttModels;
/** WebSocket-only TTS ids (Text to Dialogue realtime) — not accepted by POST /v1/text-to-speech. */
export type ElevenlabsRealtimeTtsModelId = keyof typeof realtimeTtsModels;
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
/** Runtime allow-list backing the sound-effects endpoint's model gate. */
export const SFX_MODEL_IDS: readonly string[] = Object.keys(soundEffectsModels);
/** Runtime allow-list backing the voice-design endpoint's model gate. */
export const VOICE_DESIGN_MODEL_IDS: readonly string[] = Object.keys(textToVoiceModels);
/**
 * Runtime allow-list backing the dubbing endpoint's model gate — and the
 * inverse gate everywhere else: `model_id: "dubbing_v2"` resolves in the
 * catalog, so without this group the tts/stt/music/voice-design validators
 * would accept a dubbing id unremarked.
 */
export const DUBBING_MODEL_IDS: readonly string[] = Object.keys(dubbingModels);
