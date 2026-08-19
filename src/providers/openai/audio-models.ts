// Hand-maintained — models.dev tracks none of OpenAI's audio ids (the
// generated `OpenaiAudioModelId` union holds only the realtime model), so the
// /v1/audio/speech and /v1/audio/transcriptions model lists live here.
// Refresh from
//   https://developers.openai.com/api/docs/api-reference/audio/createSpeech        (speech model ids, 4096-char input cap)
//   https://developers.openai.com/api/docs/api-reference/audio/createTranscription (transcription model ids)
//   https://developers.openai.com/api/docs/guides/text-to-speech                   (per-model voice support)
//   https://developers.openai.com/api/docs/guides/speech-to-text                   (per-model format/streaming support)
//   https://developers.openai.com/api/docs/pricing                                 (rates)
// Verified 2026-08-13.
//
// Pricing, copied verbatim from the pricing page:
// - tts-1            "$15.00 / 1M characters"  → ModelCost.perMillionCharacters
// - tts-1-hd         "$30.00 / 1M characters"  → ModelCost.perMillionCharacters
// - gpt-4o-mini-tts  text input "$0.60/1M" tokens, audio output "$12.00/1M"
//   tokens — token-billed, NOT character-billed, so it carries
//   cost.input/outputAudio and no perMillionCharacters (a character estimate
//   would be a guess about tokenization).
// - transcription models are billed per minute of audio:
//   gpt-transcribe "$0.0045 / minute", gpt-4o-transcribe "$0.006 / minute",
//   gpt-4o-mini-transcribe "$0.003 / minute",
//   gpt-4o-transcribe-diarize "$0.006 / minute", Whisper "$0.006 / minute".
// Dated snapshots bill at their family's rate (the pricing page lists
// families, not snapshots).

import type { ModelInfo } from "../../core/catalog-types";

/**
 * "The text to generate audio for. The maximum length is 4096 characters."
 * — https://developers.openai.com/api/docs/api-reference/audio/createSpeech
 * The cap is documented on the endpoint, not per model, so every speech model
 * carries it.
 */
export const SPEECH_MAX_INPUT_CHARACTERS = 4096;

const SPEECH_BASE = {
  family: "tts",
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  // Speech is not context-window bound; `characters` carries the real cap.
  limit: { context: 0, characters: SPEECH_MAX_INPUT_CHARACTERS },
} as const;

/**
 * The four ids POST /v1/audio/speech documents (`SpeechModel` in the
 * OpenAPI-generated openai@7.4.0 types, and the createSpeech reference's
 * allowed values).
 */
export const speechModels = {
  "tts-1": {
    ...SPEECH_BASE,
    id: "tts-1",
    name: "TTS-1",
    releaseDate: "2023-11-06",
    cost: { perMillionCharacters: 15 },
  },
  "tts-1-hd": {
    ...SPEECH_BASE,
    id: "tts-1-hd",
    name: "TTS-1 HD",
    releaseDate: "2023-11-06",
    cost: { perMillionCharacters: 30 },
  },
  "gpt-4o-mini-tts": {
    ...SPEECH_BASE,
    id: "gpt-4o-mini-tts",
    name: "GPT-4o mini TTS",
    family: "gpt-4o",
    cost: { input: 0.6, outputAudio: 12 },
  },
  "gpt-4o-mini-tts-2025-12-15": {
    ...SPEECH_BASE,
    id: "gpt-4o-mini-tts-2025-12-15",
    name: "GPT-4o mini TTS (2025-12-15)",
    family: "gpt-4o",
    releaseDate: "2025-12-15",
    cost: { input: 0.6, outputAudio: 12 },
  },
} as const satisfies Record<string, ModelInfo>;

export type OpenaiSpeechModelId = keyof typeof speechModels;

const TRANSCRIPTION_BASE = {
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // Billed per minute of audio, not per token.
  limit: { context: 0 },
} as const;

/**
 * The six ids POST /v1/audio/transcriptions documents ("The options are
 * `gpt-transcribe`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`,
 * `gpt-4o-mini-transcribe-2025-12-15`, `whisper-1` (which is powered by our
 * open source Whisper V2 model), and `gpt-4o-transcribe-diarize`").
 */
export const transcriptionModels = {
  "gpt-transcribe": {
    ...TRANSCRIPTION_BASE,
    id: "gpt-transcribe",
    name: "GPT Transcribe",
    family: "gpt-transcribe",
    cost: { perAudioMinute: 0.0045 },
  },
  "gpt-4o-transcribe": {
    ...TRANSCRIPTION_BASE,
    id: "gpt-4o-transcribe",
    name: "GPT-4o Transcribe",
    family: "gpt-4o",
    cost: { perAudioMinute: 0.006 },
  },
  "gpt-4o-mini-transcribe": {
    ...TRANSCRIPTION_BASE,
    id: "gpt-4o-mini-transcribe",
    name: "GPT-4o mini Transcribe",
    family: "gpt-4o",
    cost: { perAudioMinute: 0.003 },
  },
  "gpt-4o-mini-transcribe-2025-12-15": {
    ...TRANSCRIPTION_BASE,
    id: "gpt-4o-mini-transcribe-2025-12-15",
    name: "GPT-4o mini Transcribe (2025-12-15)",
    family: "gpt-4o",
    releaseDate: "2025-12-15",
    cost: { perAudioMinute: 0.003 },
  },
  "gpt-4o-transcribe-diarize": {
    ...TRANSCRIPTION_BASE,
    id: "gpt-4o-transcribe-diarize",
    name: "GPT-4o Transcribe Diarize",
    family: "gpt-4o",
    cost: { perAudioMinute: 0.006 },
  },
  "whisper-1": {
    ...TRANSCRIPTION_BASE,
    id: "whisper-1",
    name: "Whisper (large-v2)",
    family: "whisper",
    // "whisper-1 (which is powered by our open source Whisper V2 model)".
    openWeights: true,
    releaseDate: "2023-03-01",
    cost: { perAudioMinute: 0.006 },
  },
} as const satisfies Record<string, ModelInfo>;

export type OpenaiTranscriptionModelId = keyof typeof transcriptionModels;

/** Every hand-catalogued audio model (speech + transcription). */
export const audioModels = {
  ...speechModels,
  ...transcriptionModels,
} as const satisfies Record<string, ModelInfo>;

export type OpenaiAudioHandModelId = keyof typeof audioModels;
