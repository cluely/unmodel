/**
 * `stepfun.chat` — StepFun's (阶跃星辰) OpenAI-compatible Chat Completions
 * endpoint ("step-*" models), validated against the generated models.dev
 * catalog. This is the first-party api.stepfun.com service — models.dev
 * tracks the Hugging Face org separately as "stepfun-ai".
 *
 * A dedicated LEAF, not part of ../stepfun's barrel body, for the same reason
 * anthropic, google, openai, minimax and alibaba have one:
 * `src/chat/providers.ts` imports the chat validator directly from here, so
 * the ready `unmodel/chat` entry never walks the provider barrel — which
 * re-exports the speech validator that a chat bundle must not pay for (pinned
 * by `test/bundle-budget.test.ts`'s chat-graph enumeration).
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/stepfun.gen";
import type { StepfunTextModelId } from "../../catalog/stepfun.gen";
import { availability } from "../../catalog/availability/stepfun.gen";

export const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<StepfunTextModelId, typeof availability, "stepfun">({
    id: provider.id,
    // Generated from models.dev: https://api.stepfun.com/v1
    baseUrl: provider.api,
    catalog: models,
    availability,
  });

export { models, provider };
