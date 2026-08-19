export {
  speech,
  speechStream,
  SYNTHESIZE_URL,
  SYNTHESIZE_STREAM_URL,
  API_BASE_URL,
  OUTPUT_FORMATS,
  SAMPLE_RATES,
  PRECISIONS,
} from "./speech";
export type {
  SynthesizeBody,
  SynthesizeStreamBody,
  ResembleOutputFormat,
  ResemblePrecision,
  ResembleSampleRate,
} from "./speech";

// Only the synchronous route has a checker — /stream returns a WAV stream.
export { checkSpeech } from "./check";
export type { ResembleSynthesisLike, ResembleAudioTimestamps } from "./check";

export {
  models,
  provider,
  RESEMBLE_MAX_CHARACTERS,
  TTS_MODEL_IDS,
  STS_MODEL_IDS,
} from "./models";
export type { ResembleModelId, ResembleTtsModelId, ResembleStsModelId } from "./models";
