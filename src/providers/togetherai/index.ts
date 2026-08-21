/**
 * unmodel/togetherai — Together AI's OpenAI-compatible chat completions API,
 * validated against the models.dev `togetherai` catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/togetherai.gen";
import type { TogetheraiTextModelId } from "../../catalog/togetherai.gen";
import { availability } from "../../catalog/availability/togetherai.gen";

// The catalog has no `provider.api`; the documented OpenAI-compatible base is
// https://api.together.ai/v1 (https://docs.together.ai/docs/openai-api-compatibility,
// checked 2026-08-13).
const TOGETHERAI_BASE_URL = "https://api.together.ai/v1";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<TogetheraiTextModelId, typeof availability, "togetherai">({
    id: "togetherai",
    baseUrl: TOGETHERAI_BASE_URL,
    catalog: models,
    availability,
  });

/** POST target for togetherai.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  TogetheraiModelId,
  TogetheraiTextModelId,
  TogetheraiImageModelId,
  TogetheraiAudioModelId,
  TogetheraiVideoModelId,
} from "../../catalog/togetherai.gen";
