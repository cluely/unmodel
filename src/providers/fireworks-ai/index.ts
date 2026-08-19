/**
 * unmodel/fireworks-ai — Fireworks AI's OpenAI-compatible chat completions
 * API, validated against the models.dev `fireworks-ai` catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/fireworks-ai.gen";
import type { FireworksAiTextModelId } from "../../catalog/fireworks-ai.gen";
import { availability } from "../../catalog/availability/fireworks-ai.gen";

// `provider.api` is "https://api.fireworks.ai/inference/v1/" — same base, but
// the factory requires no trailing slash, so it is restated here without one
// (https://fireworks.ai/docs/tools-sdks/openai-compatibility, checked 2026-08-13).
const FIREWORKS_AI_BASE_URL = "https://api.fireworks.ai/inference/v1";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<FireworksAiTextModelId, typeof availability>({
    id: "fireworks-ai",
    baseUrl: FIREWORKS_AI_BASE_URL,
    catalog: models,
    availability,
  });

/** POST target for fireworks-ai.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  FireworksAiModelId,
  FireworksAiTextModelId,
  FireworksAiImageModelId,
  FireworksAiAudioModelId,
  FireworksAiVideoModelId,
} from "../../catalog/fireworks-ai.gen";
