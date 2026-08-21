/**
 * unmodel/meta — Meta's Model API Chat Completions endpoint (the Muse Spark
 * model family for agentic and coding workflows), validated against the
 * generated models.dev catalog. The docs describe the endpoint as "drop-in
 * compatible with the OpenAI SDK" (https://dev.meta.ai/docs, checked
 * 2026-08-13).
 *
 * Note: this is Meta's current developer API. The earlier "Llama API" public
 * preview (api.llama.com) was retired; its former docs host now redirects to
 * the Model API documentation.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/meta.gen";
import type { MetaTextModelId } from "../../catalog/meta.gen";
import { availability } from "../../catalog/availability/meta.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  MetaTextModelId,
  typeof availability,
  "meta"
>({
  id: provider.id,
  // Documented OpenAI-compatible base URL (https://dev.meta.ai/docs,
  // checked 2026-08-13); matches the generated catalog's `api` field.
  baseUrl: "https://api.meta.ai/v1",
  catalog: models,
  availability,
});

/** POST https://api.meta.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  MetaModelId,
  MetaTextModelId,
  MetaImageModelId,
  MetaAudioModelId,
  MetaVideoModelId,
} from "../../catalog/meta.gen";
