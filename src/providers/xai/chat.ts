/**
 * `xai.chat` — xAI's OpenAI-compatible Chat Completions endpoint (Grok is the
 * model family: "grok-4.6", "grok-4.20-0309-reasoning", ...), validated
 * against the generated models.dev catalog.
 *
 * A dedicated LEAF, not part of ../xai's barrel body, for the same reason
 * anthropic, google, openai, minimax and alibaba have one:
 * `src/chat/providers.ts` imports the chat validator directly from here, so
 * the ready `unmodel/chat` entry never walks the provider barrel — which
 * re-exports the Grok Imagine image and video validators that a chat bundle
 * must not pay for (pinned by `test/bundle-budget.test.ts`'s chat-graph
 * enumeration).
 */
import { createOpenAICompatible } from "../openai-compatible";
import type { FamilyRule } from "../../core/constraint-types";
import type { ModelInfo } from "../../core/catalog-types";
import { models, provider } from "../../catalog/xai.gen";
import type { XaiTextModelId } from "../../catalog/xai.gen";
import { availability } from "../../catalog/availability/xai.gen";

const XAI_API_REFERENCE = "https://docs.x.ai/docs/api-reference (checked 2026-08-13)";

/**
 * xAI's chat completions reference marks `frequency_penalty`, `presence_penalty`
 * and `stop` as not supported by reasoning models. Matching is driven by the
 * catalog's `reasoning` flag, so unknown model ids are never denied.
 */
const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "Grok reasoning models",
    match: (id) => (models as Record<string, ModelInfo>)[id]?.reasoning === true,
    deny: {
      frequency_penalty: {
        reason: "xAI documents `frequency_penalty` as not supported by reasoning models",
        source: XAI_API_REFERENCE,
      },
      presence_penalty: {
        reason: "xAI documents `presence_penalty` as not supported by reasoning models",
        source: XAI_API_REFERENCE,
      },
      stop: {
        reason: "xAI documents `stop` sequences as not supported by reasoning models",
        source: XAI_API_REFERENCE,
      },
    },
  },
];

export const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  XaiTextModelId,
  typeof availability,
  "xai"
>({
  id: provider.id,
  // The generated catalog carries no `api` field for xAI; the documented
  // base URL is https://api.x.ai/v1 (https://docs.x.ai/docs/api-reference).
  baseUrl: "https://api.x.ai/v1",
  catalog: models,
  availability,
  familyRules: chatFamilyRules,
});

export { models, provider };
