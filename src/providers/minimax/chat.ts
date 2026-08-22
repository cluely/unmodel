/**
 * `minimax.chat` — MiniMax (minimax.io) chat over the OpenAI-compatible
 * dialect: POST https://api.minimax.io/v1/chat/completions. Params mirror the
 * wire format exactly; validation runs against the generated minimax catalog.
 * This is the international platform (the China platform is the separate
 * minimax-cn catalog).
 *
 * A dedicated LEAF, not part of ../minimax's barrel body, for the same reason
 * anthropic, google and openai have one: `src/chat/providers.ts` imports the
 * chat validator directly from here, so the ready `unmodel/chat` entry never
 * walks the provider barrel — which re-exports the speech, video and
 * voice-creation validators that a chat bundle must not pay for (pinned by
 * `test/bundle-budget.test.ts`'s chat-graph enumeration).
 */

import { createOpenAICompatible } from "../openai-compatible";
import { models } from "../../catalog/minimax.gen";
import type { MinimaxTextModelId } from "../../catalog/minimax.gen";
import { availability } from "../../catalog/availability/minimax.gen";

export const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<MinimaxTextModelId, typeof availability, "minimax">({
    id: "minimax",
    // NOT provider.api: the models.dev snapshot records MiniMax's
    // Anthropic-compatible route (https://api.minimax.io/anthropic/v1). The
    // OpenAI-compatible base is https://api.minimax.io/v1, per
    // https://platform.minimax.io/docs/api-reference/text-openai-api
    baseUrl: "https://api.minimax.io/v1",
    catalog: models,
    availability,
  });
