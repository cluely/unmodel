/**
 * unmodel/nebius — Nebius Token Factory's OpenAI-compatible chat completions
 * API, validated against the models.dev `nebius` catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/nebius.gen";
import type { NebiusTextModelId } from "../../catalog/nebius.gen";
import { availability } from "../../catalog/availability/nebius.gen";

// `provider.api` from the generated catalog; matches the documented base
// https://api.tokenfactory.nebius.com/v1 (https://docs.tokenfactory.nebius.com/,
// checked 2026-08-13).
const NEBIUS_BASE_URL = provider.api;

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  NebiusTextModelId,
  typeof availability,
  "nebius"
>({
  id: "nebius",
  baseUrl: NEBIUS_BASE_URL,
  catalog: models,
  availability,
});

/** POST target for nebius.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  NebiusModelId,
  NebiusTextModelId,
  NebiusImageModelId,
  NebiusAudioModelId,
  NebiusVideoModelId,
} from "../../catalog/nebius.gen";
