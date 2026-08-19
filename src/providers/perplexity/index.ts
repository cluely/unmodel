/**
 * unmodel/perplexity — Perplexity's OpenAI-compatible chat completions API
 * (the sonar model family), validated against the models.dev `perplexity`
 * catalog.
 *
 * Endpoint note: this targets the long-standing OpenAI-compatible route
 * POST https://api.perplexity.ai/chat/completions that SDK integrations use
 * for sonar models. Perplexity's current docs (checked 2026-08-13) also
 * document a native POST /v1/sonar route and a /router/v1 gateway for
 * open-weight models; neither is OpenAI chat-completions shaped, so this
 * module stays on /chat/completions.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/perplexity.gen";
import type { PerplexityTextModelId } from "../../catalog/perplexity.gen";
import { availability } from "../../catalog/availability/perplexity.gen";

const PERPLEXITY_BASE_URL = "https://api.perplexity.ai";

// No deny rules shipped: logit_bias/n are absent from the documented schema
// of the NATIVE /v1/sonar route, but absence there is not proof the
// OpenAI-compatible /chat/completions route rejects them (many compat
// servers silently ignore unknown params). Encode only once a recorded 400
// fixture proves rejection. Tool calling needs no rule either — every
// catalog model is `toolCall: false`, so the built-in capability check
// already rejects `tools`.
const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<PerplexityTextModelId, typeof availability>({
    id: "perplexity",
    baseUrl: PERPLEXITY_BASE_URL,
    catalog: models,
    availability,
  });

/** POST target for perplexity.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  PerplexityModelId,
  PerplexityTextModelId,
  PerplexityImageModelId,
  PerplexityAudioModelId,
  PerplexityVideoModelId,
} from "../../catalog/perplexity.gen";
