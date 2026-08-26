export {
  tts,
  ttsStream,
  AUDIO_SPEECH_URL,
  AUDIO_STREAM_URL,
  AUDIO_STREAM_WITH_TIMESTAMPS_URL,
  DEFAULT_MODEL_ID,
  SPEECH_MAX_CHARACTERS,
  STREAM_MAX_CHARACTERS,
  AUDIO_FORMATS,
  SPEECH_OUTPUT_FORMATS,
  STREAM_OUTPUT_FORMATS,
  STREAM_ACCEPT_VALUES,
} from "./tts";
export type {
  AudioSpeechBody,
  AudioStreamParams,
  AudioStreamBody,
  AudioStreamSdkParams,
  SpeechifyAudioFormat,
  SpeechifyOutputFormat,
  SpeechifyStreamOutputFormat,
  SpeechifyStreamAccept,
  SpeechifyOptions,
} from "./tts";

export {
  voiceClone,
  voiceCloneToFormData,
  VOICES_URL,
  VOICE_CLONE_MODEL_ID,
  VOICE_CLONE_MAX_SAMPLE_BYTES,
  VOICE_CLONE_MAX_CONSENT_BYTES,
  VOICE_CLONE_GENDERS,
} from "./voice-clone";
export type { CreateVoiceParams, SpeechifyVoiceGender } from "./voice-clone";

export { voiceConsentChallenge, VOICES_CONSENT_CHALLENGES_URL } from "./voice-consent-challenge";
export type { ConsentChallengeParams } from "./voice-consent-challenge";

export { models, provider, SPEECHIFY_MODEL_IDS } from "./models";
export type {
  SpeechifyModelId,
  SpeechifyTtsModelId,
  SpeechifyVoiceCloneModelId,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
