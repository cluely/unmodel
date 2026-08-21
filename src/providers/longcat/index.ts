/**
 * unmodel/longcat — Meituan's LongCat platform, OpenAI-compatible Chat
 * Completions endpoint (the LongCat model family, e.g. LongCat-2.0),
 * validated against the generated models.dev catalog.
 *
 * The platform docs (https://longcat.chat/platform/docs/, checked 2026-08-13)
 * state the API is "fully compatible with the OpenAI API specification" and
 * give the full chat path https://api.longcat.chat/openai/v1/chat/completions
 * (an Anthropic-format endpoint also exists under /anthropic; this module
 * covers only the OpenAI dialect).
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/longcat.gen";
import type { LongcatTextModelId } from "../../catalog/longcat.gen";
import { availability } from "../../catalog/availability/longcat.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<LongcatTextModelId, typeof availability, "longcat">({
    id: provider.id,
    // The generated catalog's `api` field stops at /openai; the documented
    // chat path is /openai/v1/chat/completions
    // (https://longcat.chat/platform/docs/), so the factory base includes /v1.
    baseUrl: "https://api.longcat.chat/openai/v1",
    catalog: models,
    availability,
  });

/** POST https://api.longcat.chat/openai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  LongcatModelId,
  LongcatTextModelId,
  LongcatImageModelId,
  LongcatAudioModelId,
  LongcatVideoModelId,
} from "../../catalog/longcat.gen";
