/**
 * unmodel/upstage — Upstage's OpenAI-compatible Chat Completions endpoint
 * (the Solar model family: solar-pro4/pro3/pro2/mini), validated against the
 * generated models.dev catalog.
 *
 * The current API reference (https://console.upstage.ai/api/docs/for-agents/raw,
 * checked 2026-08-13) documents POST https://api.upstage.ai/v1/chat/completions
 * as "OpenAI SDK Compatible". The generated catalog's `api` field still says
 * /v1/solar — that is the legacy prefix; the docs use the plain /v1 base.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/upstage.gen";
import type { UpstageTextModelId } from "../../catalog/upstage.gen";
import { availability } from "../../catalog/availability/upstage.gen";
// In a leaf so the retarget engine can run them against a `.toApi("upstage")`
// from another provider without importing this barrel. See ./constraints.ts.
import { chatFamilyRules } from "./constraints";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<UpstageTextModelId, typeof availability>({
    id: provider.id,
    // Documented OpenAI-compatible base URL (see module JSDoc).
    baseUrl: "https://api.upstage.ai/v1",
    catalog: models,
    availability,
    familyRules: chatFamilyRules,
  });

/** POST https://api.upstage.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  UpstageModelId,
  UpstageTextModelId,
  UpstageImageModelId,
  UpstageAudioModelId,
  UpstageVideoModelId,
} from "../../catalog/upstage.gen";
