// unmodel/zhipuai — Zhipu AI (GLM model family) chat over the OpenAI-compatible
// dialect: POST https://open.bigmodel.cn/api/paas/v4/chat/completions. Params
// mirror the wire format exactly; validation runs against the generated
// zhipuai catalog.
//
// Zhipu-only params (do_sample, …) are not part of the shared dialect schema
// and surface as unknown-param warnings rather than errors.

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/zhipuai.gen";
import type { ZhipuaiTextModelId } from "../../catalog/zhipuai.gen";
import { availability } from "../../catalog/availability/zhipuai.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<ZhipuaiTextModelId, typeof availability>({
    id: "zhipuai",
    // Zhipu's OpenAI-compatible v4 endpoint (https://open.bigmodel.cn/dev/api).
    baseUrl: provider.api,
    catalog: models,
    availability,
  });

export { models, provider };
export type {
  ZhipuaiModelId,
  ZhipuaiTextModelId,
  ZhipuaiImageModelId,
  ZhipuaiAudioModelId,
  ZhipuaiVideoModelId,
} from "../../catalog/zhipuai.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };
