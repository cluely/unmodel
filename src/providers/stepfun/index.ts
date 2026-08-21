/**
 * unmodel/stepfun — StepFun's (阶跃星辰) OpenAI-compatible Chat Completions
 * endpoint ("step-*" models), validated against the generated models.dev
 * catalog. This is the first-party api.stepfun.com service — models.dev
 * tracks the Hugging Face org separately as "stepfun-ai".
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/stepfun.gen";
import type { StepfunTextModelId } from "../../catalog/stepfun.gen";
import { availability } from "../../catalog/availability/stepfun.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<StepfunTextModelId, typeof availability, "stepfun">({
    id: provider.id,
    // Generated from models.dev: https://api.stepfun.com/v1
    baseUrl: provider.api,
    catalog: models,
    availability,
  });

/** POST https://api.stepfun.com/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  StepfunModelId,
  StepfunTextModelId,
  StepfunImageModelId,
  StepfunAudioModelId,
  StepfunVideoModelId,
} from "../../catalog/stepfun.gen";
