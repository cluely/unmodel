/**
 * unmodel/cerebras — Cerebras Inference's OpenAI-compatible Chat Completions
 * endpoint, validated against the generated models.dev catalog.
 *
 * No constraint table ships here: Cerebras's docs document a *combination*
 * restriction (gpt-oss-120b rejects `tools` together with `response_format`,
 * https://inference-docs.cerebras.ai/resources/openai) rather than individual
 * unsupported params, and per-param deny/enum rules cannot express that.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/cerebras.gen";
import type { CerebrasTextModelId } from "../../catalog/cerebras.gen";
import { availability } from "../../catalog/availability/cerebras.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<CerebrasTextModelId, typeof availability, "cerebras">({
    id: provider.id,
    // The generated catalog carries no `api` field for Cerebras; the
    // documented OpenAI-compatible base URL is https://api.cerebras.ai/v1
    // (https://inference-docs.cerebras.ai/resources/openai).
    baseUrl: "https://api.cerebras.ai/v1",
    catalog: models,
    availability,
  });

/** POST https://api.cerebras.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  CerebrasModelId,
  CerebrasTextModelId,
  CerebrasImageModelId,
  CerebrasAudioModelId,
  CerebrasVideoModelId,
} from "../../catalog/cerebras.gen";
