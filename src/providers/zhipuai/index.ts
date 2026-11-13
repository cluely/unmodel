// unmodel/zhipuai — Zhipu AI (GLM model family) chat over the OpenAI-compatible
// dialect: POST https://open.bigmodel.cn/api/paas/v4/chat/completions. Params
// mirror the wire format exactly; validation runs against `chatModels` (the
// generated zhipuai catalog plus the doc corrections models.dev lacks).
//
// Zhipu-only params (do_sample, thinking, …) are not part of the shared
// dialect schema and surface as unknown-param warnings rather than errors.

import { createOpenAICompatible } from "../openai-compatible";
import type { ChatCompletionsBodyBase } from "../openai-compatible";
import type { ModelInfo } from "../../core/catalog-types";
import type { PipelineContext } from "../../core/pipeline";
import { models, provider } from "../../catalog/zhipuai.gen";
import type { ZhipuaiTextModelId } from "../../catalog/zhipuai.gen";
import { availability } from "../../catalog/availability/zhipuai.gen";
// In a leaf so the retarget engine can run them against a `.toApi("zhipuai")`
// from another provider without importing this barrel. See ./constraints.ts.
import { chatFamilyRules, isGlm53AlwaysThinking } from "./constraints";

// The GLM vision models' documented input. models.dev lists text, image and
// video, and drops the file input each model page's 输入模态 card states
// ("视频、图像、文本、文件"). The chat API reference says the same of the
// whole vision family: "视觉模型支持纯文本和多模态内容（文本、图片、视频、文件）。"
// (https://docs.bigmodel.cn/api-reference/模型-api/对话补全, checked
// 2026-11-13). A `{type: "file"}` part is the dialect's `pdf` modality, so
// without it that part is refused as `unsupported_capability` although the API
// accepts it.
const VISION_WITH_FILE_INPUT = {
  input: ["text", "image", "video", "pdf"],
  output: ["text"],
} as const;

/**
 * The catalog `zhipuai.chat` validates against: the generated rows, with file
 * input restored on the three vision models below. `models` stays the
 * generated table, untouched; this is the one to read for what `zhipuai.chat`
 * accepts.
 */
const chatModels = {
  ...models,
  // https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash (checked
  // 2026-11-13): 输入模态 "视频、图像、文本、文件".
  "glm-4.6v-flash": { ...models["glm-4.6v-flash"], modalities: VISION_WITH_FILE_INPUT },
  // https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v (checked
  // 2026-11-13): 输入模态 "视频、图像、文本、文件".
  "glm-4.6v": { ...models["glm-4.6v"], modalities: VISION_WITH_FILE_INPUT },
  // https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.5v (checked
  // 2026-11-13): 输入模态 "视频、图像、文本、文件". The API reference's
  // vision `model` enum does not list glm-4.5v, but its own page documents
  // it, and widening an input list can refuse nothing.
  "glm-4.5v": { ...models["glm-4.5v"], modalities: VISION_WITH_FILE_INPUT },
} as const satisfies Record<string, ModelInfo>;

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<ZhipuaiTextModelId, typeof availability, "zhipuai">({
    id: "zhipuai",
    // Zhipu's OpenAI-compatible v4 endpoint (https://open.bigmodel.cn/dev/api).
    baseUrl: provider.api,
    catalog: chatModels,
    availability,
    familyRules: chatFamilyRules,
    extraChecks: [checkThinkingAlwaysOn],
  });

export { models, provider, chatModels };
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

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * GLM-5.3 always thinks. The thinking guide (the `source` below):
 * "GLM-5.3 GLM-5.3-FLASH 不再支持关闭思考（API 请求中 thinking.type 传 disabled
 * 将会报错），请确保开启思考。" The parameter page
 * (https://docs.bigmodel.cn/cn/guide/start/concept-param, checked 2026-11-12)
 * extends it to GLM-5.3-FLASHX: "`GLM-5.3` `GLM-5.3-FLASH` `GLM-5.3-FLASHX`
 * 强制需开启。" `thinking` is a nested Zhipu-only object, so this lives here
 * rather than in the enum table.
 */
function checkThinkingAlwaysOn(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!isGlm53AlwaysThinking(params.model)) return;
  const thinking = (params as { thinking?: unknown }).thinking;
  if (typeof thinking !== "object" || thinking === null) return;
  if ((thinking as { type?: unknown }).type !== "disabled") return;
  ctx.report({
    code: "unsupported_param",
    path: ["thinking", "type"],
    model: params.model,
    message: `thinking cannot be turned off on "${params.model}"; it accepts only \`thinking: {type: "enabled"}\`, and \`reasoning_effort: "low"\` is its lightest level.`,
    meta: { source: "https://docs.bigmodel.cn/cn/guide/capabilities/thinking (checked 2026-11-12)" },
  });
}
