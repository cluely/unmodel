/**
 * unmodel/inception — Inception Labs' OpenAI-compatible Chat Completions
 * endpoint (the Mercury diffusion-LLM family: mercury-2, mercury-edit-2),
 * validated against the generated models.dev catalog.
 *
 * The docs (https://docs.inceptionlabs.ai/get-started/get-started, checked
 * 2026-08-13) describe an "OpenAI-compatible REST API" and recommend defaults
 * (`temperature: 0.75`, `reasoning_effort: "medium"`, `max_tokens: 8192`) but
 * document no unsupported params, so no constraint table ships here.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/inception.gen";
import type { InceptionTextModelId } from "../../catalog/inception.gen";
import { availability } from "../../catalog/availability/inception.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<InceptionTextModelId, typeof availability, "inception">({
    id: provider.id,
    // Documented base URL is https://api.inceptionlabs.ai/v1
    // (https://docs.inceptionlabs.ai/get-started/get-started); the generated
    // catalog's `api` field carries a trailing slash the factory must not see.
    baseUrl: "https://api.inceptionlabs.ai/v1",
    catalog: models,
    availability,
  });

/** POST https://api.inceptionlabs.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  InceptionModelId,
  InceptionTextModelId,
  InceptionImageModelId,
  InceptionAudioModelId,
  InceptionVideoModelId,
} from "../../catalog/inception.gen";
