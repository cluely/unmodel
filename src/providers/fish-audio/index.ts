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

// No response checker: POST /v1/tts streams raw audio bytes, not JSON.

export { models, provider, TTS_MODEL_IDS, S2_MODEL_IDS } from "./models";
export type { FishAudioModelId, FishAudioTtsModelId } from "./models";
