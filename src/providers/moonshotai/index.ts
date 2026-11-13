// unmodel/moonshotai — Moonshot AI (Kimi is the model family) chat over the
// OpenAI-compatible dialect: POST https://api.moonshot.ai/v1/chat/completions.
// Params mirror the wire format exactly; validation runs against the generated
// moonshotai catalog. This is the international endpoint, documented at
// https://platform.kimi.ai/docs (the China endpoint is the separate
// moonshotai-cn catalog).

import { createOpenAICompatible, type ChatCompletionsBodyBase } from "../openai-compatible";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, provider } from "../../catalog/moonshotai.gen";
import type { MoonshotaiTextModelId } from "../../catalog/moonshotai.gen";
import { availability } from "../../catalog/availability/moonshotai.gen";

const MODEL_PARAMETER_REFERENCE =
  "https://platform.kimi.ai/docs/api/models-overview (checked 2026-11-12)";
const TOOL_CHOICE_GUIDE = "https://platform.kimi.ai/docs/guide/use-tool-choice (checked 2026-11-12)";
const CHAT_API_REFERENCE = "https://platform.kimi.ai/docs/api/chat (checked 2026-11-12)";
const VISION_GUIDE = "https://platform.kimi.ai/docs/guide/use-kimi-vision-model (checked 2026-11-12)";

/**
 * Sampling params Kimi fixes on every model it serves. The Model Parameter
 * Reference (MODEL_PARAMETER_REFERENCE) has one column for the K3 series and
 * one each for kimi-k2.7-code and kimi-k2.6, and all three read the same:
 *
 *   "| `top_p` | Fixed at `0.95` | Fixed at `0.95` | Fixed at `0.95` |"
 *   "| `n` | Fixed at `1` | Fixed at `1` | Fixed at `1` |"
 *   "| `presence_penalty` / `frequency_penalty` | Fixed at `0` | Fixed at `0` | Fixed at `0` |"
 *   "\"Fixed\" means the parameter cannot be modified: passing any other value
 *    returns an error, so do not pass it explicitly."
 *
 * Enums rather than deny rules: the fixed value itself is not "any other
 * value", so an explicit `top_p: 0.95` passes. `temperature` is fixed at 1.0
 * on the K3 series and kimi-k2.7-code, which the dialect's catalog-driven
 * `temperature: false` check already enforces; `top_p` needs its row because
 * its fixed value is not that check's default of 1.
 */
const FIXED_SAMPLING = {
  top_p: [0.95],
  n: [1],
  presence_penalty: [0],
  frequency_penalty: [0],
} as const satisfies EndpointConstraints["enums"];

/**
 * Per-model rows, one per id Kimi serves. "The K3 series column applies to
 * `kimi-k3`, `kimi-k3.1-pro`, and `kimi-k3.1-pro-highspeed`.
 * `kimi-k2.7-code-highspeed` has the same parameter constraints as
 * `kimi-k2.7-code`." (MODEL_PARAMETER_REFERENCE)
 */
const chatConstraints = {
  "kimi-k3.1-pro": { enums: FIXED_SAMPLING },
  "kimi-k3.1-pro-highspeed": { enums: FIXED_SAMPLING },
  "kimi-k3": { enums: FIXED_SAMPLING },
  "kimi-k2.7-code": { enums: FIXED_SAMPLING },
  "kimi-k2.7-code-highspeed": { enums: FIXED_SAMPLING },
  // "| `temperature` | Fixed at `1.0` | Fixed at `1.0` | Fixed at `1.0` with
  // thinking on and `0.6` with thinking off |" — the catalog's boolean
  // `temperature: false` cannot say 0.6, so the row lists both values. The
  // pairing of 0.6 with `thinking.type: "disabled"` is not cross-checked.
  "kimi-k2.6": { enums: { ...FIXED_SAMPLING, temperature: [1, 0.6] } },
} as const satisfies Record<MoonshotaiTextModelId, EndpointConstraints>;

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<MoonshotaiTextModelId, typeof availability, "moonshotai">({
    id: "moonshotai",
    // https://platform.kimi.ai/docs/api/chat (models.dev's `provider.doc`
    // still names platform.moonshot.ai/docs/api/chat, which 301s here).
    baseUrl: provider.api,
    catalog: models,
    availability,
    constraints: chatConstraints,
    extraChecks: [checkForcedToolChoice, checkRequiredToolChoice, checkPromptCacheBreakpoints, checkSvgImages],
  });

export { models, provider };
export type {
  MoonshotaiModelId,
  MoonshotaiTextModelId,
  MoonshotaiImageModelId,
  MoonshotaiAudioModelId,
  MoonshotaiVideoModelId,
} from "../../catalog/moonshotai.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens };

/**
 * Models whose thinking cannot be turned off. The K3 series: the Model
 * Parameter Reference's K3 column reads "| `thinking` | Not supported |", and
 * the K3.1 Pro quickstart answers how to turn thinking off with "You can't —
 * K3.1 Pro always thinks." kimi-k2.7-code and its highspeed twin: the
 * kimi-k2.7-code column reads "Optional. Thinking and Preserved Thinking are
 * always on.", and https://platform.kimi.ai/docs/openapi.json (checked
 * 2026-11-12) adds "Thinking is always on for this model." kimi-k2.6 is not
 * here: it thinks by default but takes `thinking.type: "disabled"`.
 */
const ALWAYS_THINKING_MODEL_IDS: readonly string[] = [
  "kimi-k3",
  "kimi-k3.1-pro",
  "kimi-k3.1-pro-highspeed",
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
] as const satisfies readonly MoonshotaiTextModelId[];

/**
 * Models that refuse `tool_choice: "required"`. The Model Parameter
 * Reference's `tool_choice` row reads "Passing `\"required\"` returns an
 * error." in both the kimi-k2.7-code and the kimi-k2.6 column, against
 * "`\"auto\"` / `\"none\"` / `\"required\"`" for the K3 series; and
 * "`kimi-k2.7-code-highspeed` has the same parameter constraints as
 * `kimi-k2.7-code`."
 */
const REQUIRED_TOOL_CHOICE_REFUSED_MODEL_IDS: readonly string[] = [
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
  "kimi-k2.6",
] as const satisfies readonly MoonshotaiTextModelId[];

/**
 * A function-object `tool_choice` on a model that always thinks. The
 * tool-choice guide: "Forcing a specific tool is currently incompatible with
 * thinking: with thinking enabled, the request returns a 400 error
 * (`tool_choice 'specified' is incompatible with thinking enabled`)." The
 * fallback the message offers follows the model: the K3 series takes
 * "required", kimi-k2.7-code(-highspeed) refuses it too.
 */
function checkForcedToolChoice(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const choice = params.tool_choice;
  if (typeof choice !== "object" || choice.type !== "function") return;
  if (!ALWAYS_THINKING_MODEL_IDS.includes(params.model)) return;
  const fallback = REQUIRED_TOOL_CHOICE_REFUSED_MODEL_IDS.includes(params.model)
    ? 'use "auto" or "none"'
    : 'use "required" to force a tool call, or "auto" / "none"';
  ctx.report({
    code: "unsupported_param",
    path: ["tool_choice"],
    model: params.model,
    message: `\`tool_choice\` cannot force a specific function on "${params.model}": thinking is always on for this model, and Kimi rejects a forced tool while thinking ("tool_choice 'specified' is incompatible with thinking enabled"); ${fallback}.`,
    meta: { source: TOOL_CHOICE_GUIDE },
  });
}

/** `tool_choice: "required"` on a model in REQUIRED_TOOL_CHOICE_REFUSED_MODEL_IDS. */
function checkRequiredToolChoice(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.tool_choice !== "required") return;
  if (!REQUIRED_TOOL_CHOICE_REFUSED_MODEL_IDS.includes(params.model)) return;
  ctx.report({
    code: "unsupported_param",
    path: ["tool_choice"],
    model: params.model,
    message: `\`tool_choice: "required"\` returns an error on "${params.model}"; use "auto" or "none", or a K3-series model (kimi-k3, kimi-k3.1-pro), which takes "required" to force a tool call.`,
    meta: { source: MODEL_PARAMETER_REFERENCE },
  });
}

/**
 * A `prompt_cache_breakpoint` on any content part. The Chat Completions
 * reference: "Explicit cache breakpoints are not supported: the request is
 * rejected (HTTP 400) if `prompt_cache_breakpoint` appears in `content`." The
 * shared dialect types the field on every part, so this is where Kimi's
 * refusal of it lives.
 */
function checkPromptCacheBreakpoints(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.messages.forEach((message, messageIndex) => {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;
    content.forEach((part: { prompt_cache_breakpoint?: unknown }, partIndex) => {
      if (part.prompt_cache_breakpoint === undefined) return;
      ctx.report({
        code: "unsupported_param",
        path: ["messages", messageIndex, "content", partIndex, "prompt_cache_breakpoint"],
        model: params.model,
        message:
          "`prompt_cache_breakpoint` is rejected with HTTP 400 by Moonshot AI's chat endpoint; Kimi caches repeated request prefixes automatically, so remove the breakpoint.",
        meta: { source: CHAT_API_REFERENCE },
      });
    });
  });
}

/**
 * Image MIME types the vision guide lists: "image/jpeg", "image/png",
 * "image/gif", "image/webp", "image/bmp", "image/heic", "image/heif".
 */
const IMAGE_FORMATS = ["jpeg", "png", "gif", "webp", "bmp", "heic", "heif"] as const;

/**
 * An SVG `data:` URL in an `image_url` part. The vision guide: "SVG is not
 * supported as image input: uploading an SVG with `purpose=\"image\"`, or
 * passing one through `image_url` (including base64-encoded), will be
 * rejected. To have the model interpret SVG content, include the SVG source
 * (XML text) directly as text in `messages`."
 *
 * Read off the declared MIME type: header sniffing identifies only PNG, JPEG,
 * WebP and GIF, all of which Kimi accepts, so a `media.image.formats` row
 * could never fire on the one format Kimi refuses.
 */
function checkSvgImages(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.messages.forEach((message, messageIndex) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      if (part.type !== "image_url" || !/^data:image\/svg\+xml[;,]/i.test(part.image_url.url)) return;
      ctx.report({
        code: "media_unsupported_format",
        path: ["messages", messageIndex, "content", partIndex],
        model: params.model,
        message: `image format "svg" is not supported by "${params.model}"; supported formats: ${IMAGE_FORMATS.join(", ")}. To have the model read an SVG, send its XML source as a text part.`,
        meta: { format: "svg", allowed: [...IMAGE_FORMATS], source: VISION_GUIDE },
      });
    });
  });
}

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
