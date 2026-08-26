/**
 * unmodel/novita-ai — Novita AI's OpenAI-compatible chat completions API,
 * validated against the models.dev `novita-ai` catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/novita-ai.gen";
import type { NovitaAiTextModelId } from "../../catalog/novita-ai.gen";
import { availability } from "../../catalog/availability/novita-ai.gen";

// `provider.api` is "https://api.novita.ai/openai" (no /v1), but Novita's API
// reference curl examples POST to https://api.novita.ai/openai/v1/chat/completions,
// so the /v1 base is hardcoded here
// (https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion,
// checked 2026-08-13).
const NOVITA_AI_BASE_URL = "https://api.novita.ai/openai/v1";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<NovitaAiTextModelId, typeof availability, "novita-ai">({
    id: "novita-ai",
    baseUrl: NOVITA_AI_BASE_URL,
    catalog: models,
    availability,
  });

/** POST target for novita-ai.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  NovitaAiModelId,
  NovitaAiTextModelId,
  NovitaAiImageModelId,
  NovitaAiAudioModelId,
  NovitaAiVideoModelId,
} from "../../catalog/novita-ai.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
