export {
  tts,
  utf8ByteLength,
  TTS_URL,
  DEFAULT_TTS_MODEL,
  MSGPACK_CONTENT_TYPE,
  TTS_FORMATS,
  TTS_LATENCIES,
  MP3_BITRATES,
  OPUS_BITRATES,
  PROSODY_SPEED_MIN,
  PROSODY_SPEED_MAX,
} from "./tts";
export type {
  TtsBody,
  FishAudioFormat,
  FishAudioLatency,
  FishAudioMp3Bitrate,
  FishAudioOpusBitrate,
  FishAudioProsodyControl,
  FishAudioReferenceAudio,
} from "./tts";

export {
  voiceClone,
  voiceCloneToFormData,
  CREATE_MODEL_URL,
  VOICE_CLONE_MODEL_ID,
  VOICE_CLONE_MAX_VOICES,
  VOICE_CLONE_MAX_TEXTS,
  VOICE_CLONE_VISIBILITIES,
} from "./voice-clone";
export type { CreateModelParams, FishAudioVisibility } from "./voice-clone";

export {
  voiceDesign,
  VOICE_DESIGN_URL,
  DEFAULT_VOICE_DESIGN_MODEL,
  VOICE_DESIGN_COST_PER_REQUEST_USD,
  VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS,
  VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS,
  VOICE_DESIGN_N_MIN,
  VOICE_DESIGN_N_MAX,
  VOICE_DESIGN_SPEED_MAX,
  VOICE_DESIGN_NUM_STEP_MIN,
  VOICE_DESIGN_NUM_STEP_MAX,
} from "./voice-design";
export type { VoiceDesignBody } from "./voice-design";

// No response checker: POST /v1/tts streams raw audio bytes, not JSON.

export {
  models,
  provider,
  TTS_MODEL_IDS,
  S2_MODEL_IDS,
  VOICE_DESIGN_MODEL_IDS,
} from "./models";
export type {
  FishAudioModelId,
  FishAudioTtsModelId,
  FishAudioVoiceDesignModelId,
  FishAudioVoiceCloneModelId,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
