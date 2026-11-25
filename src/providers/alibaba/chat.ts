/**
 * `alibaba.chat` — Alibaba Model Studio (Qwen model family) chat over the
 * OpenAI-compatible dialect: POST
 * https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions.
 * Params mirror the wire format exactly; validation runs against the
 * generated alibaba catalog. This is DashScope's international "compatible
 * mode" endpoint (the China endpoint is the separate alibaba-cn catalog).
 *
 * The Alibaba schema extends user turns with the documented video parts.
 *
 * A dedicated LEAF, not part of ../alibaba's barrel body, for the same reason
 * anthropic, google, openai and minimax have one: `src/chat/providers.ts`
 * imports the chat validator directly from here, so the ready `unmodel/chat`
 * entry never walks the provider barrel — which re-exports the video and TTS
 * validators that a chat bundle must not pay for (pinned by
 * `test/bundle-budget.test.ts`'s chat-graph enumeration). The per-model rule
 * tables below stay in this leaf for the same reason.
 */

import { z } from "zod";
import { createOpenAICompatible } from "../openai-compatible";
import { targetValidationFor } from "../../retarget/target-constraints";
import type { TargetEndpoint } from "../../core/translate/endpoints";
import type { TargetValidation } from "../../core/translate/retarget";
import {
  audioPartSchema,
  createChatCompletionsSchema,
  createMessagesSchema,
  createVideoUrlMessagesSchema,
  messagesSchema,
  filePartSchema,
  imagePartSchema,
  textPartSchema,
  type ChatCompletionsBodyBase,
  type ChatMessage,
  type ChatUserContentPart,
  type ChatUserMessage,
} from "../openai-compatible/wire";
import type { StandardSchemaV1 } from "../../core/standard-schema";
import { models, provider } from "../../catalog/alibaba.gen";
import type { AlibabaTextModelId } from "../../catalog/alibaba.gen";
import { availability } from "../../catalog/availability/alibaba.gen";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import type { PipelineContext } from "../../core/pipeline";

/** Video content accepted by Alibaba's OpenAI-compatible chat reference. */
export type AlibabaVideoPart = ({
  type: "video_url";
  video_url: { url: string };
} | {
  type: "video";
  video: string[];
}) & {
  fps?: number;
  min_pixels?: number;
  max_pixels?: number;
  total_pixels?: number;
};

export interface AlibabaChatUserMessage extends Omit<ChatUserMessage, "content"> {
  content: string | Array<ChatUserContentPart | AlibabaVideoPart>;
}

export interface AlibabaChatBody<ModelId extends string = AlibabaTextModelId>
  extends Omit<ChatCompletionsBodyBase<ModelId>, "messages"> {
  messages: Array<Exclude<ChatMessage, ChatUserMessage> | AlibabaChatUserMessage>;
  enable_thinking?: boolean | null;
  thinking_budget?: number | null;
  preserve_thinking?: boolean | null;
}

const videoOptions = {
  fps: z.number().min(0.1).max(10).optional(),
  min_pixels: z.number().int().optional(),
  max_pixels: z.number().int().optional(),
  total_pixels: z.number().int().optional(),
};
const userContentSchema = z.union([
  z.string(),
  z.array(z.discriminatedUnion("type", [
    textPartSchema,
    imagePartSchema,
    audioPartSchema,
    filePartSchema,
    z.looseObject({
      type: z.literal("video_url"),
      video_url: z.looseObject({ url: z.string() }),
      ...videoOptions,
    }),
    z.looseObject({
      type: z.literal("video"),
      video: z.array(z.string()),
      ...videoOptions,
    }),
  ])),
]);

const chatSchema: StandardSchemaV1 = createChatCompletionsSchema({
  messages: createMessagesSchema(userContentSchema),
  enable_thinking: z.boolean().nullable().optional(),
  thinking_budget: z.number().nullable().optional(),
  preserve_thinking: z.boolean().nullable().optional(),
});

/** The Chat Completions reference: per-model `reasoning_effort` ladders and tool-call notes. */
const CHAT_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions";
/** The Qwen-Omni page: Qwen3.8-Omni-Flash's thinking and structured-output notes. */
const OMNI_DOCS = "https://www.alibabacloud.com/help/en/model-studio/qwen-omni";

/**
 * The Qwen3.8 `reasoning_effort` ladder (checked 2026-11-12). CHAT_DOCS, for
 * "qwen3.8-max, qwen3.8-max-0902, qwen3.8-flash, qwen3.8-2.4t-a95b,
 * qwen3.8-27b": "Valid values: xhigh (default) … medium … low … OpenAI
 * standard value mapping: max is mapped to xhigh, high is mapped to xhigh,
 * minimal is mapped to low, and none is mapped to enable_thinking=False.
 * Setting values other than the above valid values and mapped values will
 * cause an error." OMNI_DOCS, for qwen3.8-omni-flash: "The top-level Chat
 * Completions request field reasoning_effort accepts none, minimal, low,
 * medium, high, xhigh, and max."
 */
const QWEN_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The ids both pages say reject `reasoning_effort` beside `thinking_budget`
 * (checked 2026-11-12). CHAT_DOCS: "For the … qwen3.8-max, qwen3.8-max-0902,
 * qwen3.8-flash, qwen3.8-2.4t-a95b, qwen3.8-27b, reasoning_effort and
 * thinking_budget cannot be set at the same time. Setting both will cause an
 * error." OMNI_DOCS, for qwen3.8-omni-flash: "Do not set reasoning_effort and
 * thinking_budget together: the request returns an error."
 */
const QWEN38_MODEL_IDS = [
  "qwen3.8-max",
  "qwen3.8-max-0902",
  "qwen3.8-flash",
  "qwen3.8-2.4t-a95b",
  "qwen3.8-27b",
  "qwen3.8-omni-flash",
] as const;

const QWEN38_MODEL_ID_SET: ReadonlySet<string> = new Set(QWEN38_MODEL_IDS);

/** Per-model rules the catalog cannot express. Every row cites its page (checked 2026-11-12). */
const chatConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  ...Object.fromEntries(
    QWEN38_MODEL_IDS.map((id) => [id, { enums: { reasoning_effort: QWEN_REASONING_EFFORTS } }]),
  ),
  // The Chat Completions reference maps minimal, medium and max and accepts none.
  "qwen4-max": { enums: { reasoning_effort: QWEN_REASONING_EFFORTS } },
  "kimi-k3": {
    // CHAT_DOCS, the kimi-k3 group: "Default value: max Valid values: max
    // (default): deep reasoning high: enhanced reasoning low: light
    // reasoning" — no mapped values for this group, so anything else falls
    // under "Setting values other than the above valid values and mapped
    // values will cause an error."
    //
    // top_p: https://www.alibabacloud.com/help/en/model-studio/kimi-api
    // (checked 2026-11-12), the Default parameters row "| kimi-k3 | true
    // (can be disabled; keeping it enabled is recommended) | 1.0 | 0.95 |
    // 0.0 | - | - |". The pin exists because the catalog's
    // `temperature: false` would otherwise let the dialect's fixed-sampling
    // check accept top_p 1 only, refusing the documented default 0.95.
    // 1 stays accepted: Alibaba calls sampling "fixed" only for
    // kimi-k3.1-pro, and refusing 1 would rest only on Moonshot's rule for
    // its own host ("Fixed at `0.95`" … "passing any other value returns an
    // error", https://platform.kimi.ai/docs/api/models-overview.md). If that
    // rule is accepted as binding on Alibaba-hosted kimi-k3, narrow this to
    // [0.95] and record the decision. temperature stays with the catalog
    // check (1 only); nothing on Alibaba's pages refuses presence_penalty.
    enums: { reasoning_effort: ["max", "high", "low"], top_p: [0.95, 1] },
    deny: {
      parallel_tool_calls: {
        ignored: true,
        reason:
          "kimi-k3 does not support using this parameter to control whether tool calls are " +
          "parallel; the model may still return multiple tool_calls in one turn",
        source: CHAT_DOCS,
      },
    },
  },
  "kimi-k3.1-pro": {
    // https://www.alibabacloud.com/help/en/model-studio/kimi-api (checked
    // 2026-11-12): "The sampling parameters for kimi-k3.1-pro are fixed at
    // `temperature=1.0`, `top_p=0.95`, and `presence_penalty=0.0`. Passing a
    // non-default value for any of these parameters returns an error." and
    // "The following reasoning effort levels apply only to kimi-k3.1-pro,
    // with `max` as the default: max … high … medium … low". The id has no
    // models.dev row yet, so it validates with an unknown_model warning and
    // these enums are its only gate.
    enums: {
      temperature: [1],
      top_p: [0.95],
      presence_penalty: [0],
      reasoning_effort: ["max", "high", "medium", "low"],
    },
  },
};

const VIDEO_DOCS = "https://docs.modelstudio.console.alibabacloud.com/en/model-studio/vision";

const standardTargetShape = z.looseObject({ messages: messagesSchema });
const openRouterTargetShape = z.looseObject({ messages: createVideoUrlMessagesSchema() });

function alibabaTargetValidation(endpoint: TargetEndpoint): TargetValidation | undefined {
  const constraints = targetValidationFor(endpoint);
  if (endpoint.provider === "alibaba" || endpoint.dialect !== "openai-chat") return constraints;
  return {
    ...constraints,
    schema: endpoint.provider === "openrouter" ? openRouterTargetShape : standardTargetShape,
  };
}

export const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<
    AlibabaTextModelId,
    typeof availability,
    "alibaba",
    Record<string, ModelInfo>,
    AlibabaChatBody
  >({
    id: "alibaba",
    // Legacy international compatible-mode domain (the models.dev value;
    // still functional). Alibaba's doc page now recommends workspace/
    // region-specific domains like {WorkspaceId}.ap-southeast-1.maas.aliyuncs.com
    // — override via raw fetch if your workspace requires one.
    // https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
    baseUrl: provider.api,
    catalog: models,
    schema: chatSchema,
    availability,
    constraints: chatConstraints,
    extraChecks: [checkThinkingBudgetPairing, checkOmniJsonSchema, checkVideoParts],
    unpricedVideo: VIDEO_DOCS,
    targetValidation: alibabaTargetValidation,
  });

function checkVideoParts(
  params: AlibabaChatBody<string>,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "qwen4-max") return;
  params.messages.forEach((message, messageIndex) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      if (part.type !== "video" && part.type !== "video_url") return;
      const path = ["messages", messageIndex, "content", partIndex];
      function invalid(field: string, message: string): void {
        ctx.report({ code: "invalid_shape", path: [...path, field], model: params.model,
          message, meta: { source: CHAT_DOCS } });
      }

      if (part.type === "video") {
        const inlineFrames = part.video.filter((frame) => frame.startsWith("data:")).length;
        if (inlineFrames > 250) invalid("video", "Qwen4-Max accepts up to 250 inline video frames.");
        if ((inlineFrames === 0 && part.video.length < 4) || part.video.length > 8_000) {
          invalid("video", "Qwen4-Max needs 4 to 8,000 video frames when supplied as public URLs.");
        }
      }
      if (part.min_pixels !== undefined && part.min_pixels < 4_096) {
        invalid("min_pixels", "Qwen4-Max requires at least 4096 for min_pixels on video.");
      }
      if (part.max_pixels !== undefined &&
          (part.max_pixels > 2_048_000 || part.max_pixels < (part.min_pixels ?? 0))) {
        invalid("max_pixels", "Qwen4-Max requires max_pixels to be at most 2048000 and at least min_pixels on video.");
      }
      if (part.total_pixels !== undefined && part.total_pixels > 268_435_456) {
        invalid("total_pixels", "Qwen4-Max allows at most 268435456 for total_pixels on video.");
      }
    });
  });
}

/** `reasoning_effort` + the DashScope `thinking_budget` extension is a 400 on Qwen3.8 and Qwen4-Max. */
function checkThinkingBudgetPairing(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "qwen4-max" && !QWEN38_MODEL_ID_SET.has(params.model)) return;
  const thinkingBudget = (params as { thinking_budget?: unknown }).thinking_budget;
  if (thinkingBudget == null) return;
  if (params.model === "qwen4-max" &&
      (typeof thinkingBudget !== "number" || !Number.isInteger(thinkingBudget) ||
        thinkingBudget < 1 || thinkingBudget > 262_144)) {
    ctx.report({
      code: "invalid_shape",
      path: ["thinking_budget"],
      model: params.model,
      message: "Qwen4-Max thinking_budget must be an integer from 1 to 262144.",
      meta: { source: CHAT_DOCS },
    });
  }
  if (params.reasoning_effort == null) return;
  ctx.report({
    code: "unsupported_param",
    path: ["thinking_budget"],
    model: params.model,
    message: `"${params.model}" rejects \`reasoning_effort\` and \`thinking_budget\` together; send one — \`reasoning_effort\` picks a thinking level, \`thinking_budget\` caps the thinking tokens.`,
    meta: {
      conflicting: ["reasoning_effort", "thinking_budget"],
      source: params.model === "qwen3.8-omni-flash" ? OMNI_DOCS : CHAT_DOCS,
    },
  });
}

/**
 * OMNI_DOCS (checked 2026-11-12): "Qwen3.8-Omni-Flash does not support JSON
 * Schema mode. JSON Mode guarantees JSON syntax only; define field
 * constraints in the prompt and validate them on the client." A warning, not
 * an error: the structured-output page documents a silent fall-back to
 * `json_object` for multimodal inputs and states no rejection, so the request
 * may well be served — without the schema.
 */
function checkOmniJsonSchema(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "qwen3.8-omni-flash" || params.response_format?.type !== "json_schema") {
    return;
  }
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["response_format"],
    model: params.model,
    message:
      '"qwen3.8-omni-flash" does not support JSON Schema mode; it offers JSON Mode ' +
      '(`response_format: { type: "json_object" }`), which guarantees JSON syntax only — the ' +
      "schema's field constraints are not enforced, so validate the output on the client.",
    meta: { source: OMNI_DOCS },
  });
}
