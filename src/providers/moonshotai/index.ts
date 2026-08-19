// unmodel/moonshotai — Moonshot AI (Kimi is the model family) chat over the
// OpenAI-compatible dialect: POST https://api.moonshot.ai/v1/chat/completions.
// Params mirror the wire format exactly; validation runs against the generated
// moonshotai catalog. This is the international platform.moonshot.ai endpoint
// (the China endpoint is the separate moonshotai-cn catalog).

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/moonshotai.gen";
import type { MoonshotaiTextModelId } from "../../catalog/moonshotai.gen";
import { availability } from "../../catalog/availability/moonshotai.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<MoonshotaiTextModelId, typeof availability>({
    id: "moonshotai",
    // https://platform.moonshot.ai/docs/api/chat
    baseUrl: provider.api,
    catalog: models,
    availability,
  });

export { models, provider };
export type {
  MoonshotaiModelId,
  MoonshotaiTextModelId,
  MoonshotaiImageModelId,
  MoonshotaiAudioModelId,
  MoonshotaiVideoModelId,
} from "../../catalog/moonshotai.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };
