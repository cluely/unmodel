// unmodel/deepseek — DeepSeek chat over the OpenAI-compatible dialect:
// POST https://api.deepseek.com/chat/completions. Params mirror the wire
// format exactly; validation runs against the generated deepseek catalog.

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/deepseek.gen";
import type { DeepseekTextModelId } from "../../catalog/deepseek.gen";
import { availability } from "../../catalog/availability/deepseek.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<DeepseekTextModelId, typeof availability, "deepseek">({
    id: "deepseek",
    // DeepSeek's documented base URL has no version segment — the chat route
    // is https://api.deepseek.com/chat/completions (an alias with /v1 also
    // exists for OpenAI SDK compatibility): https://api-docs.deepseek.com/
    baseUrl: provider.api,
    catalog: models,
    availability,
  });

export { models, provider };
export type {
  DeepseekModelId,
  DeepseekTextModelId,
  DeepseekImageModelId,
  DeepseekAudioModelId,
  DeepseekVideoModelId,
} from "../../catalog/deepseek.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };
