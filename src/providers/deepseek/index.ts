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
//
// DeepSeek documents more than the shared dialect — top-level `thinking`,
// `user_id`, `safety_check` and `title`, a flat `file` part, images in system
// and tool messages — so this module composes the dialect's pieces around its
// own wire leaf (./wire.ts), the way openai/chat.ts does, rather than calling
// `createOpenAICompatible`. Where DeepSeek's parts differ, its checks and its
// `.toSdk("ai-sdk")` encoder are its own; everything else is the dialect's.
//
// Known gap: a same-dialect `.toApi(provider)` hop forwards the body as
// written, so DeepSeek-only parts reach the target host unchanged.

import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS } from "../../core/request";
import type { FamilyRule } from "../../core/constraint-types";
import type { ModelInfo } from "../../core/catalog-types";
import type { ResponseReport } from "../../core/report";
import type { Issue } from "../../core/issues";
import type { ChatIR } from "../../core/translate/ir";
import type { Warn } from "../../core/translate/warnings";
import type { OpenAICompatibleChat } from "../openai-compatible";
import {
  chatCompletionsChecks,
  createChatEstimate,
  createChatFinalize,
  createInlineImagesCheck,
  estimateChatTokens,
  type ChatConstraintSpec,
  type ChatImageRef,
} from "../openai-compatible/chat-completions";
import {
  createCheckChat,
  type ChatCompletionLike,
  type ChatFinishReason as DialectChatFinishReason,
} from "../openai-compatible/check";
import { encodeOpenAIChat } from "../openai-compatible/interop";
import type {
  ChatCompletionsBodyBase,
  ChatMessage as DialectChatMessage,
  ChatTextPart,
  ChatUserContentPart as DialectChatUserContentPart,
} from "../openai-compatible/wire";
import { models, provider } from "../../catalog/deepseek.gen";
import type { DeepseekTextModelId } from "../../catalog/deepseek.gen";
import { availability } from "../../catalog/availability/deepseek.gen";
import { chatSchema, type ChatCompletionsBody, type ChatMessage, type ChatUserContentPart } from "./wire";

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

const ENDPOINT = "deepseek.chat";

const CHAT_SPEC: ChatConstraintSpec = { familyRules: chatFamilyRules };

/**
 * POST target for chat: {baseUrl}/chat/completions. DeepSeek's documented base
 * URL has no version segment (an alias with /v1 also exists for OpenAI SDK
 * compatibility): https://api-docs.deepseek.com/
 */
export const CHAT_COMPLETIONS_URL = `${provider.api}/chat/completions`;

const validator = createValidator<ChatCompletionsBodyBase, unknown>({
  endpoint: ENDPOINT,
  schema: chatSchema,
  modelId: (params) => params.model,
  catalog: models,
  ...CHAT_SPEC,
  checks: [
    ...chatCompletionsChecks(CHAT_SPEC, {
      inputModalities: onDeepseekBody(checkInputModalities),
      inlineImages: createInlineImagesCheck(CHAT_SPEC, onDeepseekBody(imagesOf)),
    }),
    onDeepseekBody(checkFileParts),
    onDeepseekBody(checkForcedToolChoice),
    onDeepseekBody(checkStreamOptions),
    onDeepseekBody(checkSamplingInThinkingMode),
    onDeepseekBody(checkResponseFormat),
  ],
  estimate: createChatEstimate(CHAT_SPEC),
  promptPath: ["messages"],
  finalize: createChatFinalize({
    endpoint: ENDPOINT,
    provider: "deepseek",
    request: { url: CHAT_COMPLETIONS_URL, method: "POST", headers: JSON_HEADERS },
    availability,
    encode: onDeepseekBody(encodeDeepseekChat),
  }),
});

/**
 * Validates params for POST https://api.deepseek.com/chat/completions. The
 * result's enumerable properties are the exact fetch body; `.toSdk("openai")`
 * returns it unchanged, `.request` carries url/method/static headers, and
 * `.toApi(provider)` retargets to any provider serving the same model.
 */
export const chat = validator as unknown as OpenAICompatibleChat<
  DeepseekTextModelId,
  typeof availability,
  "deepseek",
  ChatCompletionsBody
>;

const checkDialectChat = createCheckChat(models, "deepseek");

/** DeepSeek's `finish_reason` values: the dialect's, plus its two interruptions. */
export type ChatFinishReason = DialectChatFinishReason | "insufficient_system_resource" | "aborted";

/**
 * Post-generation report: the dialect's truncation, content-filter and refusal
 * warnings, usage and catalog-priced cost, plus a warning for each choice
 * DeepSeek interrupted. Never throws. API reference, `finish_reason`:
 * "insufficient_system_resource if the request is interrupted due to
 * insufficient resource of the inference system, or aborted if the generation
 * was interrupted."
 */
export function checkChat(res: ChatCompletionLike): ResponseReport<ChatFinishReason> {
  const report = checkDialectChat(res);
  const interrupted: Issue[] = [];
  (res.choices ?? []).forEach((choice, index) => {
    const finishReason = choice.finish_reason;
    if (finishReason !== "insufficient_system_resource" && finishReason !== "aborted") return;
    interrupted.push({
      severity: "warning",
      code: "unsupported_capability",
      path: ["choices", index, "finish_reason"],
      message: INTERRUPTION_MESSAGES[finishReason],
      meta: { kind: "interrupted", finishReason },
      ...(res.model !== undefined && { model: res.model }),
    });
  });
  return { ...report, warnings: [...report.warnings, ...interrupted] };
}

const INTERRUPTION_MESSAGES = {
  insufficient_system_resource:
    "DeepSeek interrupted the generation: its inference system ran out of resources (finish_reason insufficient_system_resource), so the completion is incomplete — retry the request.",
  aborted:
    "DeepSeek interrupted the generation (finish_reason aborted), so the completion is incomplete.",
} as const satisfies Record<"insufficient_system_resource" | "aborted", string>;

export { estimateChatTokens, models, provider };
export type {
  DeepseekModelId,
  DeepseekTextModelId,
  DeepseekImageModelId,
  DeepseekAudioModelId,
  DeepseekVideoModelId,
} from "../../catalog/deepseek.gen";
export type { ChatCompletionsBody } from "./wire";

/**
 * The shared pipeline is typed on the dialect's body. DeepSeek's own checks and
 * encoder read DeepSeek's — `thinking`, its content parts — and every body that
 * reaches them has passed DeepSeek's schema (./wire.ts) first, so this one seam
 * hands them the type that schema admitted.
 */
function onDeepseekBody<Rest extends unknown[], Result>(
  piece: (params: ChatCompletionsBody, ...rest: Rest) => Result,
): (params: ChatCompletionsBodyBase, ...rest: Rest) => Result {
  return piece as unknown as (params: ChatCompletionsBodyBase, ...rest: Rest) => Result;
}

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
function isThinking(params: ChatCompletionsBody): boolean {
  if (params.thinking != null) return params.thinking.type !== "disabled";
  return params.reasoning_effort !== "none";
}

/**
 * API reference, `tool_choice`: "required and named tool choices are not
 * supported in thinking mode; the API returns a 400 error. Disable thinking
 * mode first to use them."
 */
function checkForcedToolChoice(
  params: ChatCompletionsBody,
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
  params: ChatCompletionsBody,
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
  params: ChatCompletionsBody,
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

/**
 * API reference, `response_format.type`: "Possible values: text, json_object"
 * and "Must be one of text or json_object." A warning rather than an error:
 * the documented enum is the only evidence, and no live request has shown the
 * 400. A `structuredOutput: false` catalog row is left to the dialect's check,
 * which already refuses `json_schema` there.
 */
function checkResponseFormat(
  params: ChatCompletionsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.response_format?.type !== "json_schema" || info?.structuredOutput === false) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["response_format"],
    model: params.model,
    message:
      'DeepSeek documents `response_format.type` as `text` or `json_object` only, so `json_schema` is likely refused. Use JSON Output — `response_format: { type: "json_object" }`, which guarantees valid JSON but no schema — or, for schema-enforced output, strict function tools: `strict: true` on every function, sent to the https://api.deepseek.com/beta base URL (https://api-docs.deepseek.com/guides/tool_calls).',
    meta: { source: CHAT_API_REFERENCE },
  });
}

// ---------------------------------------------------------------------------
// Content parts — DeepSeek's differ from the dialect's: images ride in user,
// system and tool messages, and its `file` part is flat and carries an image.
// ---------------------------------------------------------------------------

/**
 * Which models take image parts. Fills the dialect's modality slot, which
 * reads user messages only and takes a `file` part for a PDF. A `file` part
 * with `file_data` is an image ("A base64-encoded data URL of the image"); one
 * with `file_id` is not checked, because the id may name an uploaded image or
 * a document the Files API parsed ("Reference the returned file_id in a user
 * message", https://api-docs.deepseek.com/guides/document_parsing, checked
 * 2026-11-13) and the request does not say which.
 */
function checkInputModalities(
  params: ChatCompletionsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.modalities.input.includes("image")) return;
  forEachContentPart(params.messages, (part, path) => {
    if (part.type !== "image_url" && (part.type !== "file" || part.file_data === undefined)) return;
    ctx.report({
      code: "unsupported_capability",
      path,
      model: params.model,
      message: `"${params.model}" does not accept image input; remove this ${part.type} content part.`,
      meta: { modality: "image", partType: part.type },
    });
  });
}

/**
 * Where DeepSeek's image limits apply: `image_url` parts and `file_data`
 * parts, in every role that takes them. `file_id` parts are left out — "images
 * referenced via Files API file_id may be up to 64 MiB and are not subject to
 * the 32 MiB per-image check" (https://api-docs.deepseek.com/guides/vision,
 * checked 2026-11-13) — and may name a document besides.
 */
function imagesOf(params: ChatCompletionsBody): ChatImageRef[] {
  const images: ChatImageRef[] = [];
  forEachContentPart(params.messages, (part, path) => {
    if (part.type === "image_url") images.push({ path, url: part.image_url.url });
    if (part.type === "file" && part.file_data !== undefined) images.push({ path, url: part.file_data });
  });
  return images;
}

/**
 * API reference, the `file` part: "Exactly one of file_id and file_data is
 * required: passing neither returns a 400 error ("file must have a file_id or
 * file_data"); passing both returns a 400 error ("file cannot have both
 * file_id and file_data")." The dialect's nested `file: {…}` object is
 * neither, and the most likely way to send one, so its message says where the
 * fields go — and that only an image rides inline: "A document that needs
 * parsing can be referenced only by file_id. Passing the file content or a
 * file URL in the request is not supported."
 * (https://api-docs.deepseek.com/guides/document_parsing, checked 2026-11-13).
 */
function checkFileParts(
  params: ChatCompletionsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  forEachContentPart(params.messages, (part, path) => {
    if (part.type !== "file") return;
    const hasId = part.file_id !== undefined;
    if (hasId !== (part.file_data !== undefined)) return;
    ctx.report({
      code: "invalid_shape",
      path,
      model: params.model,
      message: hasId
        ? 'A DeepSeek `file` part takes `file_id` or `file_data`, never both ("file cannot have both file_id and file_data"); remove one.'
        : `A DeepSeek \`file\` part carries \`file_id\` or \`file_data\` on the part itself ("file must have a file_id or file_data")${"file" in part ? ", not in OpenAI's nested `file: {…}` object" : ""}. \`file_data\` takes a base64 data URL of an image; a document (PDF, Word, …) is uploaded to DeepSeek's Files API and referenced by \`file_id\`.`,
      meta: { source: CHAT_API_REFERENCE },
    });
  });
}

/** Visits each content part of the roles that carry DeepSeek's parts. */
function forEachContentPart(
  messages: readonly ChatMessage[],
  visit: (part: ChatUserContentPart, path: Array<string | number>) => void,
): void {
  messages.forEach((message, messageIndex) => {
    if (message.role !== "user" && message.role !== "system" && message.role !== "tool") return;
    if (typeof message.content === "string") return;
    message.content.forEach((part, partIndex) => {
      visit(part, ["messages", messageIndex, "content", partIndex]);
    });
  });
}

/**
 * `.toSdk("ai-sdk")` reads the body through the openai-chat codec, which knows
 * the dialect's parts only, so DeepSeek's are mapped onto it first: the flat
 * `file` part becomes the dialect's nested one, `detail: "original"` becomes
 * `"high"` (the vision guide: high "Keeps the original image. (Provided for
 * compatibility; equivalent to original.)"), and a non-text part in a system
 * or tool message — the dialect carries text only there — is dropped with a
 * `dropped_content` warning.
 */
function encodeDeepseekChat(body: ChatCompletionsBody, warn: Warn): ChatIR {
  const messages = body.messages.map((message, index) => toDialectMessage(message, index, warn));
  return encodeOpenAIChat({ ...body, messages }, warn);
}

function toDialectMessage(message: ChatMessage, index: number, warn: Warn): DialectChatMessage {
  if (message.role !== "user" && message.role !== "system" && message.role !== "tool") return message;
  const content = message.content;
  if (typeof content === "string") return { ...message, content };
  if (message.role === "user") return { ...message, content: content.map(toDialectPart) };
  return { ...message, content: textPartsOf(content, index, message.role, warn) };
}

function toDialectPart(part: ChatUserContentPart): DialectChatUserContentPart {
  switch (part.type) {
    case "text":
      return part;
    case "image_url": {
      const { detail, ...image } = part.image_url;
      return {
        ...part,
        image_url: { ...image, ...(detail !== undefined && { detail: detail === "original" ? "high" : detail }) },
      };
    }
    case "file": {
      const { file_id, file_data, filename, ...rest } = part;
      return {
        ...rest,
        file: {
          ...(file_id !== undefined && { file_id }),
          ...(file_data !== undefined && { file_data }),
          ...(filename !== undefined && { filename }),
        },
      };
    }
  }
}

function textPartsOf(
  content: readonly ChatUserContentPart[],
  index: number,
  role: "system" | "tool",
  warn: Warn,
): ChatTextPart[] {
  const text: ChatTextPart[] = [];
  content.forEach((part, partIndex) => {
    if (part.type === "text") {
      text.push(part);
      return;
    }
    warn({
      code: "dropped_content",
      path: ["messages", index, "content", partIndex],
      message: `this ${part.type} part of a ${role} message was dropped: DeepSeek takes images there, but the openai-chat codec carries only a ${role} message's text.`,
    });
  });
  return text;
}

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
