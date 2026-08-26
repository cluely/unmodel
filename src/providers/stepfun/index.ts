/**
 * unmodel/stepfun — StepFun's (阶跃星辰) OpenAI-compatible Chat Completions
 * endpoint ("step-*" models), validated against the generated models.dev
 * catalog, plus the speech endpoint `stepfun.tts`
 * (POST https://api.stepfun.ai/v1/audio/speech, `stepaudio-2.5-tts`). Chat is
 * the first-party api.stepfun.com service — models.dev tracks the Hugging
 * Face org separately as "stepfun-ai".
 */
import { chat, chatUrl, checkChat, estimateChatTokens, models, provider } from "./chat";

/** POST https://api.stepfun.com/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  StepfunModelId,
  StepfunTextModelId,
  StepfunImageModelId,
  StepfunAudioModelId,
  StepfunVideoModelId,
} from "../../catalog/stepfun.gen";

export {
  tts,
  AUDIO_SPEECH_URL,
  STEP_PLAN_AUDIO_SPEECH_URL,
  REALTIME_AUDIO_WS_URL,
  MAX_INSTRUCTION_CHARACTERS,
  SPEECH_MAX_INPUT_CHARACTERS,
  RESPONSE_FORMATS,
  SAMPLE_RATES,
  SYSTEM_VOICES,
} from "./tts";
export type {
  TtsBody,
  StepfunResponseFormat,
  StepfunSampleRate,
  StepfunPronunciationRule,
  StepfunTtsModelId,
} from "./tts";
export { speechModels } from "./audio-models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
