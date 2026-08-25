/**
 * `alibaba.chat` — Alibaba Model Studio (Qwen model family) chat over the
 * OpenAI-compatible dialect: POST
 * https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions.
 * Params mirror the wire format exactly; validation runs against the
 * generated alibaba catalog. This is DashScope's international "compatible
 * mode" endpoint (the China endpoint is the separate alibaba-cn catalog).
 *
 * DashScope-only params (enable_thinking, enable_search, …) are not part of
 * the shared dialect schema and surface as unknown-param warnings rather than
 * errors.
 *
 * A dedicated LEAF, not part of ../alibaba's barrel body, for the same reason
 * anthropic, google, openai and minimax have one: `src/chat/providers.ts`
 * imports the chat validator directly from here, so the ready `unmodel/chat`
 * entry never walks the provider barrel — which re-exports the video and TTS
 * validators that a chat bundle must not pay for (pinned by
 * `test/bundle-budget.test.ts`'s chat-graph enumeration).
 */

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/alibaba.gen";
import type { AlibabaTextModelId } from "../../catalog/alibaba.gen";
import { availability } from "../../catalog/availability/alibaba.gen";

export const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<AlibabaTextModelId, typeof availability, "alibaba">({
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
