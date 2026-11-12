// unmodel/deepseek — DeepSeek chat over the OpenAI-compatible dialect:
// POST https://api.deepseek.com/chat/completions. Params mirror the wire
// format exactly; validation runs against the generated deepseek catalog.
//
// The rules below come from DeepSeek's API reference for this one endpoint,
// whose `model` enum is exactly `deepseek-flash` and `deepseek-v4-pro`; the
// legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are
// served by the same Flash model ("their requests are served by the
// DeepSeek-V4.1-Flash-1017 model", https://api-docs.deepseek.com/quick_start/pricing,
// checked 2026-11-12). Thinking mode is DeepSeek's default, so several rules
// hinge on it — see `isThinking`.

import { createOpenAICompatible, type ChatCompletionsBodyBase } from "../openai-compatible";
import type { PipelineContext } from "../../core/pipeline";
import type { FamilyRule } from "../../core/constraint-types";
import type { ModelInfo } from "../../core/catalog-types";
import { models, provider } from "../../catalog/deepseek.gen";
import type { DeepseekTextModelId } from "../../catalog/deepseek.gen";
import { availability } from "../../catalog/availability/deepseek.gen";

const CHAT_API_REFERENCE =
  "https://api-docs.deepseek.com/api/create-chat-completion (checked 2026-11-12)";

/** DeepSeek states its vision limits in MiB. */
const MIB = 1024 * 1024;

const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "DeepSeek chat completions",
    match: () => true,
    deny: {
      // API reference, both penalties: "This parameter is no longer
      // supported. It will not take effect if you pass it to the API."
      frequency_penalty: {
        reason: "DeepSeek no longer supports `frequency_penalty`; the value has no effect",
        source: CHAT_API_REFERENCE,
        ignored: true,
      },
      presence_penalty: {
        reason: "DeepSeek no longer supports `presence_penalty`; the value has no effect",
        source: CHAT_API_REFERENCE,
        ignored: true,
      },
    },
    enums: {
      // API reference: "reasoning_effort … Possible values: none, low, high,
      // max" and "For compatibility with existing software, minimal is
      // accepted and mapped to low, and medium / xhigh are accepted and mapped
      // to high." The thinking-mode guide's mapping table
      // (https://api-docs.deepseek.com/guides/thinking_mode, checked
      // 2026-11-12) also maps "ultra | max", which the reference omits; it is
      // listed so a documented value is never refused.
      reasoning_effort: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
    },
  },
  {
    family: "DeepSeek vision models",
    match: acceptsImages,
    // https://api-docs.deepseek.com/guides/vision (checked 2026-11-12), the
    // limits table: "Supported formats | JPEG, PNG, GIF, WebP",
    // "Max single image size (base64 / external URL) | 32 MiB", "Max image
    // dimension | 8192 px per side; drops to 4096 px per side when a request
    // contains 15 or more images". The 4096-px tier, the 600-image and the
    // 48 MiB body caps have no MediaRule field and are not enforced.
    media: {
      image: {
        formats: ["jpeg", "png", "gif", "webp"],
        maxBytes: 32 * MIB,
        maxWidth: 8192,
        maxHeight: 8192,
      },
    },
  },
];

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<DeepseekTextModelId, typeof availability, "deepseek">({
    id: "deepseek",
    // DeepSeek's documented base URL has no version segment — the chat route
    // is https://api.deepseek.com/chat/completions (an alias with /v1 also
    // exists for OpenAI SDK compatibility): https://api-docs.deepseek.com/
    baseUrl: provider.api,
    catalog: models,
    availability,
    familyRules: chatFamilyRules,
    extraChecks: [checkForcedToolChoice, checkStreamOptions, checkSamplingInThinkingMode],
  });

export { models, provider };
export type {
  DeepseekModelId,
  DeepseekTextModelId,
  DeepseekImageModelId,
  DeepseekAudioModelId,
  DeepseekVideoModelId,
} from "../../catalog/deepseek.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };

/** Catalog-driven, so an unknown id never picks up a vision rule. */
function acceptsImages(modelId: string): boolean {
  if (!Object.hasOwn(models, modelId)) return false;
  const info: ModelInfo = (models as Record<string, ModelInfo>)[modelId]!;
  return info.modalities.input.includes("image");
}

/**
 * Whether DeepSeek runs this request in thinking mode. API reference: "When
 * thinking is omitted or null, the mode follows reasoning_effort; if
 * reasoning_effort is also omitted, thinking is enabled. When this object is
 * provided, type is required and takes precedence over reasoning_effort",
 * and "none disables thinking mode".
 */
function isThinking(params: ChatCompletionsBodyBase): boolean {
  const thinking = (params as { thinking?: unknown }).thinking;
  if (typeof thinking === "object" && thinking !== null) {
    return (thinking as { type?: unknown }).type !== "disabled";
  }
  return params.reasoning_effort !== "none";
}

/**
 * API reference, `tool_choice`: "required and named tool choices are not
 * supported in thinking mode; the API returns a 400 error. Disable thinking
 * mode first to use them."
 */
function checkForcedToolChoice(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const choice = params.tool_choice;
  const forced =
    choice === "required" || (typeof choice === "object" && choice.type === "function");
  if (!forced || !isThinking(params)) return;
  ctx.report({
    code: "unsupported_param",
    path: ["tool_choice"],
    model: params.model,
    message: `tool_choice ${JSON.stringify(choice)} is not supported in DeepSeek's thinking mode, which is on by default; use "auto" or "none", or turn thinking off (\`reasoning_effort: "none"\` or \`thinking: {type: "disabled"}\`).`,
    meta: { source: CHAT_API_REFERENCE },
  });
}

/**
 * API reference, `stream_options`: "Must be set together with stream: true;
 * if stream is not set to true, the API returns a 400 error."
 */
function checkStreamOptions(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.stream_options == null || params.stream === true) return;
  ctx.report({
    code: "unsupported_param",
    path: ["stream_options"],
    model: params.model,
    message:
      "`stream_options` requires `stream: true` on DeepSeek; the API returns a 400 error otherwise. Set `stream: true` or remove `stream_options`.",
    meta: { source: CHAT_API_REFERENCE },
  });
}

/**
 * Sampling params the API accepts and then overrides — warnings, never
 * errors. API reference, `temperature`: "Has no effect in thinking mode."
 * `top_p`: "deepseek-flash: In thinking mode, the default is 1.0 and values
 * below 0.95 are treated as 0.95. In non-thinking mode, it is fixed at 1.0
 * and the value you pass is ignored." and "deepseek-v4-pro: In thinking mode,
 * it is fixed at 0.95 when tool calling is enabled, or 1.0 otherwise; the
 * value you pass is ignored. … In non-thinking mode, the value you pass is
 * used". The legacy Flash names follow deepseek-flash, the model serving them.
 */
function checkSamplingInThinkingMode(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const thinking = isThinking(params);
  const model = params.model;
  if (params.temperature != null && thinking) {
    reportOverridden(
      ctx,
      model,
      "temperature",
      `\`temperature\` has no effect on "${model}" in thinking mode, which is on by default; turn thinking off (\`reasoning_effort: "none"\`) for it to apply.`,
    );
  }
  const topP = params.top_p;
  if (topP == null) return;
  if (FLASH_MODEL_IDS.has(model)) {
    if (!thinking) {
      reportOverridden(
        ctx,
        model,
        "top_p",
        `\`top_p\` is fixed at 1.0 on "${model}" in non-thinking mode; the value is ignored.`,
      );
    } else if (topP < FLASH_THINKING_MIN_TOP_P) {
      reportOverridden(
        ctx,
        model,
        "top_p",
        `\`top_p\` below ${FLASH_THINKING_MIN_TOP_P} is treated as ${FLASH_THINKING_MIN_TOP_P} on "${model}" in thinking mode.`,
      );
    }
  } else if (model === "deepseek-v4-pro" && thinking) {
    reportOverridden(
      ctx,
      model,
      "top_p",
      `\`top_p\` is fixed on "${model}" in thinking mode, which is on by default; turn thinking off (\`reasoning_effort: "none"\`) for it to apply.`,
    );
  }
}

/** The ids DeepSeek serves with its Flash model (pricing page footnote above). */
const FLASH_MODEL_IDS: ReadonlySet<string> = new Set<DeepseekTextModelId>([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
]);

/** deepseek-flash's thinking-mode `top_p` floor, per the reference quoted above. */
const FLASH_THINKING_MIN_TOP_P = 0.95;

/** Reported like an `ignored` DenyRule: the API accepts the value and overrides it. */
function reportOverridden(
  ctx: PipelineContext,
  model: string,
  param: "temperature" | "top_p",
  message: string,
): void {
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: [param],
    model,
    message,
    meta: { source: CHAT_API_REFERENCE, ignored: true },
  });
}

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
