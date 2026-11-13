/**
 * unmodel/upstage — Upstage's OpenAI-compatible Chat Completions endpoint
 * (the Solar model family: solar-pro4 and solar-mini4, plus their dated
 * snapshots), validated against the generated models.dev catalog.
 *
 * solar-pro3, solar-pro2 and solar-mini (all versions) ended service on
 * 2026-10-30 (KST): "Support ended for `solar-pro3` and all of its versions"
 * (https://console.upstage.ai/docs/resources/changelog, checked 2026-11-12),
 * and Upstage now answers them with 400 `invalid_request_body`, "a model that
 * is invalid or no longer supported" (https://console.upstage.ai/docs/resources/error-codes,
 * checked 2026-11-12). models.dev still carries their rows with no status, so
 * they validate and price until upstream marks them deprecated.
 *
 * The API reference (https://console.upstage.ai/api/chat, checked 2026-11-12)
 * documents `curl --location 'https://api.upstage.ai/v1/chat/completions'` and
 * an OpenAI SDK client on `base_url="https://api.upstage.ai/v1"`. The
 * generated catalog's `api` field still says /v1/solar — that is the legacy
 * prefix; the docs use the plain /v1 base.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/upstage.gen";
import type { UpstageTextModelId } from "../../catalog/upstage.gen";
import { availability } from "../../catalog/availability/upstage.gen";
// In a leaf so the retarget engine can run them against a `.toApi("upstage")`
// from another provider without importing this barrel. See ./constraints.ts.
import { chatFamilyRules } from "./constraints";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<UpstageTextModelId, typeof availability, "upstage">({
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

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
