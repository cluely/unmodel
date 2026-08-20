// unmodel/mistral — Mistral (La Plateforme) chat over the OpenAI-compatible
// dialect: POST https://api.mistral.ai/v1/chat/completions. Params mirror the
// wire format exactly; validation runs against the generated mistral catalog.
//
// Mistral-only params (safe_prompt, random_seed, …) are not part of the shared
// dialect schema and surface as unknown-param warnings rather than errors.
//
// Speech to text lives in ./transcription (POST /v1/audio/transcriptions), on
// the merged audio catalog in ./audio-models.

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/mistral.gen";
import type { MistralTextModelId } from "../../catalog/mistral.gen";
import { availability } from "../../catalog/availability/mistral.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<MistralTextModelId, typeof availability>({
    id: "mistral",
    // The models.dev snapshot carries no `api` value for Mistral; this is the
    // documented base URL (https://docs.mistral.ai/api/).
    baseUrl: "https://api.mistral.ai/v1",
    catalog: models,
    availability,
  });

export { models, provider };
export type {
  MistralModelId,
  MistralTextModelId,
  MistralImageModelId,
  MistralAudioModelId,
  MistralVideoModelId,
} from "../../catalog/mistral.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };

export {
  transcribe,
  toFormData,
  AUDIO_TRANSCRIPTIONS_URL,
  FILES_URL,
  MAX_CONTEXT_BIAS_TERMS,
  MAX_FILE_URL_LENGTH,
} from "./transcribe";
export type { TranscriptionBody, MistralTimestampGranularity } from "./transcribe";

export { checkTranscription } from "./transcription-check";
export type { TranscriptionResponseLike } from "./transcription-check";

export {
  transcriptionModels,
  transcriptionSupplementModels,
  TRANSCRIPTION_MODEL_IDS,
  TRANSCRIPTION_MAX_AUDIO_SECONDS,
  REALTIME_MODEL_IDS,
} from "./audio-models";
export type { MistralTranscriptionSupplementModelId } from "./audio-models";
