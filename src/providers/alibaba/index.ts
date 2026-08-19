// unmodel/alibaba — Alibaba Model Studio (Qwen model family) chat over the
// OpenAI-compatible dialect: POST
// https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions.
// Params mirror the wire format exactly; validation runs against the generated
// alibaba catalog. This is DashScope's international "compatible mode"
// endpoint (the China endpoint is the separate alibaba-cn catalog).
//
// DashScope-only params (enable_thinking, enable_search, …) are not part of
// the shared dialect schema and surface as unknown-param warnings rather than
// errors.

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/alibaba.gen";
import type { AlibabaTextModelId } from "../../catalog/alibaba.gen";
import { availability } from "../../catalog/availability/alibaba.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<AlibabaTextModelId, typeof availability>({
    id: "alibaba",
    // Legacy international compatible-mode domain (the models.dev value;
    // still functional). Alibaba's doc page now recommends workspace/
    // region-specific domains like {WorkspaceId}.ap-southeast-1.maas.aliyuncs.com
    // — override via raw fetch if your workspace requires one.
    // https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
    baseUrl: provider.api,
    catalog: models,
    availability,
  });

export { models, provider };
export type {
  AlibabaModelId,
  AlibabaTextModelId,
  AlibabaImageModelId,
  AlibabaAudioModelId,
  AlibabaVideoModelId,
} from "../../catalog/alibaba.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };
