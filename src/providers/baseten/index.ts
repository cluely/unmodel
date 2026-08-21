/**
 * unmodel/baseten — Baseten Model APIs' OpenAI-compatible Chat Completions
 * endpoint, validated against the generated models.dev catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/baseten.gen";
import type { BasetenTextModelId } from "../../catalog/baseten.gen";
import { availability } from "../../catalog/availability/baseten.gen";

// `provider.api` from the generated catalog; matches the documented base
// (https://docs.baseten.co/inference/model-apis/overview): https://inference.baseten.co/v1
const BASETEN_BASE_URL = provider.api;

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  BasetenTextModelId,
  typeof availability,
  "baseten"
>({
  id: provider.id,
  baseUrl: BASETEN_BASE_URL,
  catalog: models,
  availability,
});

/** POST https://inference.baseten.co/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  BasetenModelId,
  BasetenTextModelId,
  BasetenImageModelId,
  BasetenAudioModelId,
  BasetenVideoModelId,
} from "../../catalog/baseten.gen";
