/**
 * unmodel/sarvam — Sarvam AI's OpenAI-compatible Chat Completions endpoint
 * (the Sarvam model family for Indian languages, flagship sarvam-105b),
 * validated against the generated models.dev catalog.
 *
 * Per the docs (https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview,
 * checked 2026-08-13) the API "accepts `Authorization: Bearer <key>` for
 * OpenAI-compatible tooling" at POST https://api.sarvam.ai/v1/chat/completions.
 * Behavioral note (not a validation rule): reasoning is enabled by default via
 * `reasoning_effort`, and reasoning tokens bill as completion tokens. A newer
 * /v2/chat/completions endpoint also exists. This module targets v1, whose
 * docs list sarvam-105b and sarvam-105b-conversations; the generated catalog
 * also carries sarvam-30b, which appears in NEITHER endpoint's current docs —
 * requests for it validate here but may not be served by /v1.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/sarvam.gen";
import type { SarvamTextModelId } from "../../catalog/sarvam.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<SarvamTextModelId>({
  id: provider.id,
  // Documented OpenAI-compatible base URL (https://docs.sarvam.ai/api/
  // api-guides-tutorials/chat-completion/overview); matches the generated
  // catalog's `api` field.
  baseUrl: "https://api.sarvam.ai/v1",
  catalog: models,
});

/** POST https://api.sarvam.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  SarvamModelId,
  SarvamTextModelId,
  SarvamImageModelId,
  SarvamAudioModelId,
  SarvamVideoModelId,
} from "../../catalog/sarvam.gen";
