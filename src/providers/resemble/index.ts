export {
  tts,
  ttsStream,
  SYNTHESIZE_URL,
  SYNTHESIZE_STREAM_URL,
  API_BASE_URL,
  OUTPUT_FORMATS,
  SAMPLE_RATES,
  PRECISIONS,
} from "./tts";
export type {
  SynthesizeBody,
  SynthesizeStreamBody,
  ResembleOutputFormat,
  ResemblePrecision,
  ResembleSampleRate,
} from "./tts";

// Only the synchronous route has a checker — /stream returns a WAV stream.
export { checkTts } from "./check";
export type { ResembleSynthesisLike, ResembleAudioTimestamps } from "./check";

export {
  models,
  provider,
  RESEMBLE_MAX_CHARACTERS,
  TTS_MODEL_IDS,
  STS_MODEL_IDS,
} from "./models";
export type { ResembleModelId, ResembleTtsModelId, ResembleStsModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
