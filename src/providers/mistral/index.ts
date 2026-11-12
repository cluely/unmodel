// unmodel/mistral — Mistral (La Plateforme) chat over the OpenAI-compatible
// dialect: POST https://api.mistral.ai/v1/chat/completions. Params mirror the
// wire format exactly; validation runs against ./chat-models (the generated
// mistral catalog plus the vendor aliases and doc corrections models.dev
// lacks) and the per-model `reasoning_effort` ladders in ./constraints.
//
// Mistral-only params (safe_prompt, random_seed, …) are not part of the shared
// dialect schema and surface as unknown-param warnings rather than errors.
//
// Speech to text lives in ./transcription (POST /v1/audio/transcriptions), on
// the merged audio catalog in ./audio-models.

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/mistral.gen";
import { availability } from "../../catalog/availability/mistral.gen";
import { chatModels, type MistralChatModelId } from "./chat-models";
// In a leaf so the retarget engine can reach them without importing this
// barrel. See ./constraints.ts.
import { chatFamilyRules } from "./constraints";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<MistralChatModelId, typeof availability, "mistral">({
    id: "mistral",
    // The models.dev snapshot carries no `api` value for Mistral; this is the
    // documented base URL (https://docs.mistral.ai/api/).
    baseUrl: "https://api.mistral.ai/v1",
    catalog: chatModels,
    availability,
    familyRules: chatFamilyRules,
  });

export { models, provider };
export { chatModels };
export type { MistralChatModelId } from "./chat-models";
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
  stt,
  toFormData,
  AUDIO_TRANSCRIPTIONS_URL,
  FILES_URL,
  MAX_CONTEXT_BIAS_TERMS,
  MAX_FILE_URL_LENGTH,
  MAX_SPEAKER_REFERENCES,
} from "./stt";
export type { TranscriptionBody, MistralTimestampGranularity } from "./stt";

export { checkTranscription } from "./transcription-check";
export type { TranscriptionResponseLike } from "./transcription-check";

export {
  transcriptionModels,
  transcriptionSupplementModels,
  TRANSCRIPTION_MODEL_IDS,
  TRANSCRIPTION_MAX_AUDIO_SECONDS,
  VOXTRAL_3_TRANSCRIPTION_MODEL_IDS,
  REALTIME_MODEL_IDS,
} from "./audio-models";
export type { MistralTranscriptionSupplementModelId } from "./audio-models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
