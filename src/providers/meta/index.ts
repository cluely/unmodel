/**
 * unmodel/meta — Meta's Model API Chat Completions endpoint (the Muse Wonder,
 * Muse Spark and Muse Ember model families), validated against the generated
 * models.dev catalog. The docs describe the endpoint as "drop-in compatible
 * with the OpenAI SDK" (https://dev.meta.ai/docs, checked 2026-08-13).
 *
 * Every Muse model is a reasoning model, and the endpoint-wide HTTP 400s the
 * protocol, reasoning and tool-calling pages state are encoded below. The
 * API-reference schema page still lists `stop`, `modalities` and
 * `reasoning_effort: "none"` in its request schema; the prose pages say each
 * returns HTTP 400, and the prose wins. Deliberately NOT refused, because no
 * page states a 400: `frequency_penalty` / `presence_penalty` ("a request that
 * sets them can return an error"), `top_logprobs`, and `reasoning_effort:
 * "max"` on the ids the docs call it "not available" for.
 *
 * Cost caveat: muse-ember-1.0 bills a request over 200K input tokens at its
 * long-context rates in full ("Over 200K input tokens": $0.30 input / $1.50
 * output / $0.012 cached input per 1M, https://dev.meta.ai/docs/pricing-rate-limits,
 * checked 2026-11-12). `ModelCost` has no input-size tier, so its estimates use
 * the up-to-200K rates and run 3x low above that threshold.
 *
 * Note: this is Meta's current developer API. The earlier "Llama API" public
 * preview (api.llama.com) was retired; its former docs host now redirects to
 * the Model API documentation.
 */
import { createOpenAICompatible } from "../openai-compatible";
import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { FamilyRule } from "../../core/constraint-types";
import type { ModelInfo } from "../../core/catalog-types";
import type { PipelineContext } from "../../core/pipeline";
import { models, provider } from "../../catalog/meta.gen";
import type { MetaTextModelId } from "../../catalog/meta.gen";
import { availability } from "../../catalog/availability/meta.gen";

const CHAT_COMPLETIONS_DOC =
  "https://dev.meta.ai/docs/protocols/chat-completions (checked 2026-11-12)";
const REASONING_DOC = "https://dev.meta.ai/docs/reasoning (checked 2026-11-12)";
const TOOL_CALLING_DOC = "https://dev.meta.ai/docs/tool-calling (checked 2026-11-12)";
const ERROR_HANDLING_DOC = "https://dev.meta.ai/docs/error-handling (checked 2026-11-12)";
const MEDIA_DOC = "https://dev.meta.ai/docs/media-understanding (checked 2026-11-12)";

/**
 * The protocol page's table, introduced by "A small set of OpenAI parameters
 * is not supported and returns `HTTP 400`:", plus its `max_output_tokens`
 * line. Each reason quotes the row.
 */
const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "Meta Model API chat completions",
    match: () => true,
    deny: {
      stop: {
        reason: '"Not supported on reasoning models." Meta returns HTTP 400 for it',
        source: CHAT_COMPLETIONS_DOC,
      },
      logit_bias: {
        reason: '"Unsupported on reasoning models." Meta returns HTTP 400 for it',
        source: CHAT_COMPLETIONS_DOC,
      },
      prediction: {
        reason: '"Unsupported on reasoning models." Meta returns HTTP 400 for it',
        source: CHAT_COMPLETIONS_DOC,
      },
      verbosity: {
        reason: '"Not implementable without model retraining." Meta returns HTTP 400 for it',
        source: CHAT_COMPLETIONS_DOC,
      },
      web_search_options: {
        reason:
          '"Search grounding is not available on Chat Completions." Meta returns HTTP 400 for it; the Responses API\'s `web_search` tool is where search grounding lives',
        source: CHAT_COMPLETIONS_DOC,
      },
      modalities: {
        reason: '"Not supported; any value returns `HTTP 400`." Output is text only',
        source: CHAT_COMPLETIONS_DOC,
      },
      audio: {
        reason: '"No audio output." Meta returns HTTP 400 for it',
        source: CHAT_COMPLETIONS_DOC,
      },
      max_output_tokens: {
        reason:
          '"`max_output_tokens` is a Responses API parameter and is rejected on Chat Completions." Use `max_completion_tokens`',
        source: CHAT_COMPLETIONS_DOC,
      },
    },
    enums: {
      // "\"none\" | Disables reasoning. Not supported by Muse Wonder, Muse
      // Spark, or Muse Ember: returns HTTP 400." (REASONING_DOC); the other
      // six levels are that table's remaining rows.
      reasoning_effort: ["minimal", "low", "medium", "high", "xhigh", "max"],
      // "Only \"auto\" (the default) is supported on both Chat Completions and
      // the Responses API" / "\"none\", \"required\", and named function
      // choices return HTTP 400" (TOOL_CALLING_DOC). The enum check refuses
      // object values, which covers the named-function form.
      tool_choice: ["auto"],
      // "Only `n=1` is supported; values greater than 1 return `HTTP 400`."
      n: [1],
    },
  },
];

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  MetaTextModelId,
  typeof availability,
  "meta"
>({
  id: provider.id,
  // Documented OpenAI-compatible base URL (https://dev.meta.ai/docs,
  // checked 2026-08-13); matches the generated catalog's `api` field.
  baseUrl: "https://api.meta.ai/v1",
  catalog: models,
  availability,
  familyRules: chatFamilyRules,
  extraChecks: [
    checkLogprobs,
    checkResponsesTextFormat,
    checkTools,
    checkSamplingRanges,
    checkImageCount,
  ],
});

/** POST https://api.meta.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  MetaModelId,
  MetaTextModelId,
  MetaImageModelId,
  MetaAudioModelId,
  MetaVideoModelId,
} from "../../catalog/meta.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * "Muse Spark is a reasoning model, so this is not supported — `logprobs:
 * true` returns `HTTP 400`." `false` is the documented default, so a deny
 * table (which fires on any non-null value) would over-refuse.
 */
function checkLogprobs(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.logprobs !== true) return;
  ctx.report({
    code: "unsupported_param",
    path: ["logprobs"],
    model: params.model,
    message: `\`logprobs: true\` is not supported by "${params.model}": Meta's reasoning models return HTTP 400 for it. Omit \`logprobs\` or send \`false\`.`,
    meta: { source: REASONING_DOC },
  });
}

/**
 * "Sending `text.format`, which belongs to the Responses API, to the Chat
 * Completions endpoint also returns `HTTP 400`." Only `format` is named, so
 * only `format` is refused; any other `text` key stays an `unknown_param`
 * warning.
 */
function checkResponsesTextFormat(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const text = "text" in params ? params.text : undefined;
  if (typeof text !== "object" || text === null || !("format" in text) || text.format == null) {
    return;
  }
  ctx.report({
    code: "unsupported_param",
    path: ["text", "format"],
    model: params.model,
    message: `\`text.format\` is a Responses API parameter and returns HTTP 400 on Meta's Chat Completions endpoint; use \`response_format\`.`,
    meta: { source: CHAT_COMPLETIONS_DOC },
  });
}

/**
 * "Function tool names must match `^[a-zA-Z0-9_.-]+$`" "and contain at most
 * one dot." "Names with two or more dots return `HTTP 400`." (TOOL_CALLING_DOC)
 */
const FUNCTION_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * Tool-list rules from the tool-calling page: "Custom tools are
 * Responses-API-only; sending `{"type": "custom", ...}` to Chat Completions
 * returns `HTTP 400`.", and the function-name pattern above.
 */
function checkTools(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.tools?.forEach((tool, index) => {
    if (tool.type === "custom") {
      ctx.report({
        code: "unsupported_param",
        path: ["tools", index],
        model: params.model,
        message: `Custom tools ("${tool.custom.name}") are Responses-API-only and return HTTP 400 on Meta's Chat Completions endpoint; declare it as a \`function\` tool.`,
        meta: { source: TOOL_CALLING_DOC },
      });
      return;
    }
    const name = tool.function.name;
    if (FUNCTION_NAME_PATTERN.test(name) && name.split(".").length <= 2) return;
    ctx.report({
      code: "invalid_shape",
      path: ["tools", index, "function", "name"],
      model: params.model,
      message: `Function tool name "${name}" is not accepted by Meta: names must match ^[a-zA-Z0-9_.-]+$ and contain at most one dot (two or more dots return HTTP 400).`,
      meta: { name, pattern: FUNCTION_NAME_PATTERN.source, source: TOOL_CALLING_DOC },
    });
  });
}

/**
 * The error-handling page's HTTP 400 list: "Invalid parameter values such as
 * `temperature` outside the 0–2 range," and "`top_p` outside `0 < top_p ≤ 1`,
 * including `top_p: 0`,". The shared dialect leaves both unbounded.
 */
function checkSamplingRanges(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const { temperature, top_p } = params;
  if (temperature != null && (temperature < 0 || temperature > 2)) {
    ctx.report({
      code: "invalid_shape",
      path: ["temperature"],
      model: params.model,
      message: `\`temperature\` must be between 0 and 2 on Meta's Chat Completions endpoint; got ${temperature}.`,
      meta: { min: 0, max: 2, value: temperature, source: ERROR_HANDLING_DOC },
    });
  }
  if (top_p != null && (top_p <= 0 || top_p > 1)) {
    ctx.report({
      code: "invalid_shape",
      path: ["top_p"],
      model: params.model,
      message: `\`top_p\` must satisfy 0 < top_p ≤ 1 on Meta's Chat Completions endpoint; got ${top_p}.`,
      meta: { min: 0, max: 1, value: top_p, source: ERROR_HANDLING_DOC },
    });
  }
}

/**
 * "You can include up to 50 images; more than 50 returns HTTP 400". A PDF's
 * first 50 page-images count toward the same budget; only `image_url` parts
 * are counted here, so the check can under-count but never over-refuse.
 */
const MAX_IMAGES_PER_REQUEST = 50;

function checkImageCount(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  let count = 0;
  for (const message of params.messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "image_url") count += 1;
    }
  }
  if (count <= MAX_IMAGES_PER_REQUEST) return;
  ctx.report({
    code: "invalid_shape",
    path: ["messages"],
    model: params.model,
    message: `Request contains ${count} images; Meta's Chat Completions endpoint accepts at most ${MAX_IMAGES_PER_REQUEST} images per request.`,
    meta: { images: count, limit: MAX_IMAGES_PER_REQUEST, source: MEDIA_DOC },
  });
}
