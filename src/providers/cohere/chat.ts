import { z } from "zod";
import { models } from "../../catalog/cohere.gen";
import type { CohereTextModelId } from "../../catalog/cohere.gen";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS } from "../../core/request";
import type { ExactKeys, RequestMeta, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { computeCostUSD } from "../../core/cost";
import { PER_MESSAGE_TOKEN_OVERHEAD, estimateToolDefinitionTokens } from "../../core/tokens";
import { toBytes } from "../../core/media/bytes";
import { sniffImage } from "../../core/media/image";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";

// ---------------------------------------------------------------------------
// unmodel/cohere — Cohere's NATIVE v2 Chat API (not v1, not the
// OpenAI-compatible /compatibility endpoint):
// POST https://api.cohere.com/v2/chat
//
// Wire shapes verified against the v2 API reference on 2026-08-13:
// https://docs.cohere.com/reference/chat — note v2 differs meaningfully from
// v1 (messages array with roles instead of message/chat_history/preamble,
// documents moved shape, tools are function-schema shaped).
// ---------------------------------------------------------------------------

export const CHAT_URL = "https://api.cohere.com/v2/chat";

const CHAT_DOCS = "https://docs.cohere.com/reference/chat (checked 2026-08-13)";
const IMAGE_DOCS = "https://docs.cohere.com/docs/image-inputs (checked 2026-08-13)";

// ---------------------------------------------------------------------------
// Wire types — mirror the POST /v2/chat body exactly.
// ---------------------------------------------------------------------------

export interface CohereTextContent {
  type: "text";
  text: string;
}

/** Reasoning block an assistant turn echoes back in multi-turn requests. */
export interface CohereThinkingContent {
  type: "thinking";
  thinking: string;
}

/** Image input for vision models; url is an http(s) URL or a base64 data: URL. */
export interface CohereImageContent {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

/** Tool-result document content of a `tool` message. */
export interface CohereDocumentContent {
  type: "document";
  document: {
    data: string | Record<string, unknown>;
    id?: string;
  };
}

export type CohereUserContentPart = CohereTextContent | CohereImageContent;

export interface CohereUserMessage {
  role: "user";
  content: string | CohereUserContentPart[];
}

export interface CohereSystemMessage {
  role: "system";
  content: string | CohereTextContent[];
}

export interface CohereToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

export interface CohereAssistantMessage {
  role: "assistant";
  content?: string | Array<CohereTextContent | CohereThinkingContent>;
  tool_calls?: CohereToolCall[];
  /** Chain-of-thought reflection preceding tool calls. */
  tool_plan?: string;
  citations?: Array<Record<string, unknown>>;
}

export interface CohereToolMessage {
  role: "tool";
  /** Id of the tool call this message answers. */
  tool_call_id: string;
  content: string | Array<CohereTextContent | CohereDocumentContent>;
}

export type CohereChatMessage =
  | CohereUserMessage
  | CohereSystemMessage
  | CohereAssistantMessage
  | CohereToolMessage;

export interface CohereTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON-Schema object describing the function parameters. */
    parameters: Record<string, unknown>;
  };
}

export type CohereDocument = string | { data: string | Record<string, unknown>; id?: string };

export type CohereResponseFormat =
  | { type: "text" }
  | { type: "json_object"; json_schema?: Record<string, unknown> };

export type CohereThinking =
  | { type: "enabled"; token_budget?: number }
  | { type: "disabled" };

export interface CohereCitationOptions {
  mode?: "ENABLED" | "DISABLED" | "FAST" | "ACCURATE" | "OFF";
}

export interface ChatBody {
  model: CohereTextModelId | (string & {});
  messages: CohereChatMessage[];
  stream?: boolean;
  tools?: CohereTool[];
  /** Forces tool calls to strictly follow the tool parameter schemas. */
  strict_tools?: boolean;
  documents?: CohereDocument[];
  citation_options?: CohereCitationOptions;
  /** json_object is not supported in combination with `tools` or `documents`. */
  response_format?: CohereResponseFormat;
  /** Newer models support only CONTEXTUAL and STRICT. */
  safety_mode?: "CONTEXTUAL" | "STRICT" | "OFF";
  max_tokens?: number;
  /** Up to 5 sequences. */
  stop_sequences?: string[];
  /** Non-negative; defaults to 0.3. */
  temperature?: number;
  /** Best-effort deterministic sampling. */
  seed?: number;
  /** 0..1; defaults to 0. */
  frequency_penalty?: number;
  /** 0..1; defaults to 0. */
  presence_penalty?: number;
  /** Top-k: 0..500; 0 (default) disables. */
  k?: number;
  /** Nucleus sampling: 0.01..0.99; defaults to 0.75. */
  p?: number;
  logprobs?: boolean;
  /** REQUIRED forces at least one tool call, NONE forbids tool calls; omit for model discretion. Command-r7b and newer. */
  tool_choice?: "REQUIRED" | "NONE";
  thinking?: CohereThinking;
  /** Request priority under load; 0 (default) is highest. */
  priority?: number;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const textContentSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
const thinkingContentSchema = z.looseObject({ type: z.literal("thinking"), thinking: z.string() });
const imageContentSchema = z.looseObject({
  type: z.literal("image_url"),
  image_url: z.looseObject({
    url: z.string(),
    detail: z.enum(["low", "high", "auto"]).optional(),
  }),
});

const toolCallSchema = z.looseObject({
  id: z.string(),
  type: z.literal("function"),
  function: z.looseObject({ name: z.string(), arguments: z.string() }),
});

const messageSchema = z.discriminatedUnion("role", [
  z.looseObject({
    role: z.literal("user"),
    content: z.union([
      z.string(),
      z.array(z.discriminatedUnion("type", [textContentSchema, imageContentSchema])),
    ]),
  }),
  z.looseObject({
    role: z.literal("system"),
    content: z.union([z.string(), z.array(textContentSchema)]),
  }),
  z.looseObject({
    role: z.literal("assistant"),
    content: z
      .union([
        z.string(),
        z.array(z.discriminatedUnion("type", [textContentSchema, thinkingContentSchema])),
      ])
      .optional(),
    tool_calls: z.array(toolCallSchema).optional(),
    tool_plan: z.string().optional(),
    citations: z.array(z.looseObject({})).optional(),
  }),
  z.looseObject({
    role: z.literal("tool"),
    tool_call_id: z.string(),
    // Tool content blocks are kept loose ({type: "document"|"text", ...}).
    content: z.union([z.string(), z.array(z.looseObject({ type: z.string() }))]),
  }),
]);

const schema = z
  .looseObject({
    model: z.string(),
    messages: z.array(messageSchema).min(1, "messages must contain at least one message."),
    stream: z.boolean().optional(),
    tools: z
      .array(
        z.looseObject({
          type: z.literal("function"),
          function: z.looseObject({
            name: z.string(),
            description: z.string().optional(),
            parameters: z.record(z.string(), z.unknown()),
          }),
        }),
      )
      .optional(),
    strict_tools: z.boolean().optional(),
    documents: z
      .array(
        z.union([
          z.string(),
          z.looseObject({
            data: z.union([z.string(), z.record(z.string(), z.unknown())]),
            id: z.string().optional(),
          }),
        ]),
      )
      .optional(),
    citation_options: z
      .looseObject({
        mode: z.enum(["ENABLED", "DISABLED", "FAST", "ACCURATE", "OFF"]).optional(),
      })
      .optional(),
    response_format: z
      .discriminatedUnion("type", [
        z.looseObject({ type: z.literal("text") }),
        z.looseObject({
          type: z.literal("json_object"),
          json_schema: z.record(z.string(), z.unknown()).optional(),
        }),
      ])
      .optional(),
    safety_mode: z.enum(["CONTEXTUAL", "STRICT", "OFF"]).optional(),
    max_tokens: z.int().positive().optional(),
    stop_sequences: z.array(z.string()).max(5, "stop_sequences accepts up to 5 strings.").optional(),
    temperature: z.number().min(0).optional(),
    seed: z.int().optional(),
    frequency_penalty: z.number().min(0).max(1).optional(),
    presence_penalty: z.number().min(0).max(1).optional(),
    k: z.int().min(0).max(500).optional(),
    p: z.number().min(0.01).max(0.99).optional(),
    logprobs: z.boolean().optional(),
    tool_choice: z.enum(["REQUIRED", "NONE"]).optional(),
    thinking: z
      .discriminatedUnion("type", [
        z.looseObject({ type: z.literal("enabled"), token_budget: z.int().positive().optional() }),
        z.looseObject({ type: z.literal("disabled") }),
      ])
      .optional(),
    priority: z.int().optional(),
  })
  .superRefine((params, ctx) => {
    // Every tool message must answer a tool call declared by a preceding
    // assistant message ("The id of the associated tool call").
    const declared = new Set<string>();
    params.messages.forEach((message, index) => {
      if (message.role === "assistant") {
        for (const call of message.tool_calls ?? []) declared.add(call.id);
      }
      if (message.role === "tool" && !declared.has(message.tool_call_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["messages", index, "tool_call_id"],
          message: `tool message references tool_call_id "${message.tool_call_id}", but no preceding assistant message declares that tool call.`,
        });
      }
    });
  });

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type ImagePartVisitor = (
  part: Record<string, unknown>,
  path: Array<string | number>,
) => void;

function eachImagePart(params: ChatBody, visit: ImagePartVisitor): void {
  params.messages.forEach((message, i) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return;
    message.content.forEach((part, j) => {
      if (typeof part !== "object" || part === null) return;
      const record = part as unknown as Record<string, unknown>;
      if (record["type"] !== "image_url") return;
      visit(record, ["messages", i, "content", j]);
    });
  });
}

export function validateCapabilities(
  params: ChatBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;

  if (params.tools !== undefined && params.tools.length > 0 && !info.toolCall) {
    ctx.report({
      code: "unsupported_capability",
      path: ["tools"],
      model,
      message: `"${model}" does not support tool calling; remove \`tools\`.`,
    });
  }

  if (params.thinking?.type === "enabled" && !info.reasoning) {
    ctx.report({
      code: "unsupported_capability",
      path: ["thinking"],
      model,
      message: `"${model}" does not support reasoning; remove \`thinking\`.`,
    });
  }

  if (params.response_format?.type === "json_object" && info.structuredOutput === false) {
    ctx.report({
      code: "unsupported_capability",
      path: ["response_format"],
      model,
      message: `"${model}" does not support structured outputs (response_format json_object).`,
    });
  }

  const outputLimit = info.limit.output ?? 0;
  if (params.max_tokens !== undefined && outputLimit > 0 && params.max_tokens > outputLimit) {
    ctx.report({
      code: "over_output_limit",
      path: ["max_tokens"],
      model,
      message: `max_tokens ${params.max_tokens} exceeds the ${outputLimit}-token output limit of "${model}".`,
      meta: { requested: params.max_tokens, limit: outputLimit },
    });
  }

  if (!info.modalities.input.includes("image")) {
    eachImagePart(params, (_part, path) => {
      ctx.report({
        code: "unsupported_capability",
        path,
        model,
        message: `"${model}" does not accept image input; remove this image_url content part.`,
      });
    });
  }
}

/**
 * v2 structured outputs are "not supported when used in combination with the
 * `documents` or `tools` parameters" (CHAT_DOCS).
 */
export function validateResponseFormatCompatibility(
  params: ChatBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.response_format?.type !== "json_object") return;
  for (const param of ["tools", "documents"] as const) {
    const value = params[param];
    if (value !== undefined && value.length > 0) {
      ctx.report({
        code: "unsupported_param",
        path: ["response_format"],
        model: params.model,
        message: `response_format json_object is not supported in combination with \`${param}\`; remove one of them.`,
        meta: { conflict: param, source: CHAT_DOCS },
      });
    }
  }
}

/** "You can pass in a maximum of 20 images per request, or 20 megabytes (mb) in total data" (IMAGE_DOCS). */
const MAX_IMAGES_PER_REQUEST = 20;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_RULE: MediaRule = { formats: ["png", "jpeg", "webp", "gif"] };

/**
 * Vision-input limits: per-image format checks (base64 data: URLs are
 * sniffed; http(s) URLs are checked against `options.media` declarations),
 * the 20-images-per-request cap, and the 20MB total-payload cap over the
 * image bytes that could be inspected or were declared.
 */
export function validateImages(
  params: ChatBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  let count = 0;
  let knownBytes = 0;
  eachImagePart(params, (part, path) => {
    count += 1;
    const imageUrl = part["image_url"];
    const url =
      typeof imageUrl === "object" && imageUrl !== null
        ? (imageUrl as Record<string, unknown>)["url"]
        : undefined;
    const bytes = typeof url === "string" && url.startsWith("data:") ? toBytes(url) : undefined;
    const sniffed = bytes === undefined ? undefined : sniffImage(bytes);
    const declaration = findMediaDeclaration(ctx.options.media, path);
    knownBytes += sniffed?.bytes ?? declaration?.bytes ?? 0;
    if (sniffed === undefined && declaration === undefined) return;
    reportMediaIssues(ctx, {
      kind: "image",
      rule: IMAGE_RULE,
      path,
      model: params.model,
      ...(sniffed !== undefined && { sniffed }),
      ...(declaration !== undefined && { declaration }),
      source: IMAGE_DOCS,
    });
  });

  if (count > MAX_IMAGES_PER_REQUEST) {
    ctx.report({
      code: "invalid_shape",
      path: ["messages"],
      model: params.model,
      message: `Request contains ${count} images; Cohere accepts at most ${MAX_IMAGES_PER_REQUEST} images per request.`,
      meta: { images: count, limit: MAX_IMAGES_PER_REQUEST, source: IMAGE_DOCS },
    });
  }
  if (knownBytes > MAX_TOTAL_IMAGE_BYTES) {
    ctx.report({
      code: "media_too_large",
      path: ["messages"],
      model: params.model,
      message: `Request carries ${knownBytes} bytes of image data; Cohere caps total image data at ${MAX_TOTAL_IMAGE_BYTES} bytes (20 MB) per request.`,
      meta: { bytes: knownBytes, limit: MAX_TOTAL_IMAGE_BYTES, source: IMAGE_DOCS },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * Coarse per-image token constant for estimation — Cohere does not publish a
 * fixed per-image token cost, so this is a heuristic, not a quote.
 */
const IMAGE_TOKENS = 1000;

function estimateChat(
  params: ChatBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const tokenizer = ctx.tokenizer;
  let inputTokens = 0;

  const countText = (value: unknown): void => {
    if (typeof value === "string") inputTokens += tokenizer.count(value);
  };

  for (const message of params.messages) {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      inputTokens += tokenizer.count(content);
    } else if (Array.isArray(content)) {
      for (const part of content as Array<Record<string, unknown>>) {
        switch (part["type"]) {
          case "text":
            countText(part["text"]);
            break;
          case "thinking":
            countText(part["thinking"]);
            break;
          case "image_url":
            inputTokens += IMAGE_TOKENS;
            break;
          case "document":
            inputTokens += estimateToolDefinitionTokens(tokenizer, part["document"]);
            break;
          default:
            break;
        }
      }
    }
    if (message.role === "assistant") {
      countText(message.tool_plan);
      for (const call of message.tool_calls ?? []) {
        countText(call.function.arguments);
      }
    }
  }

  for (const tool of params.tools ?? []) {
    inputTokens += estimateToolDefinitionTokens(tokenizer, tool);
  }
  for (const document of params.documents ?? []) {
    if (typeof document === "string") inputTokens += tokenizer.count(document);
    else inputTokens += estimateToolDefinitionTokens(tokenizer, document.data);
  }

  // Worst case: the model fills the requested (or maximum) output budget.
  const outputTokens = params.max_tokens ?? info?.limit.output ?? 0;
  const costUSD = computeCostUSD(info?.cost, { inputTokens, outputTokens });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body + .toSdk("cohere") (cohere-ai v2 camelCase shape) + .request
// ---------------------------------------------------------------------------

/** Renames snake_case message fields to the cohere-ai SDK's camelCase. */
function sdkMessage(message: CohereChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    const { tool_call_id, content, ...rest } = message;
    return { ...rest, toolCallId: tool_call_id, content };
  }
  if (message.role === "assistant") {
    const { tool_calls, tool_plan, ...rest } = message;
    return {
      ...rest,
      ...(tool_calls !== undefined && { toolCalls: tool_calls }),
      ...(tool_plan !== undefined && { toolPlan: tool_plan }),
    };
  }
  if (message.role === "user" && Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image_url" ? { type: "image_url", imageUrl: part.image_url } : part,
      ),
    };
  }
  return message as unknown as Record<string, unknown>;
}

/**
 * Re-shapes the wire body into the camelCase params of `cohere-ai`'s
 * `client.v2.chat()` / `client.v2.chatStream()` (`V2ChatRequest`). The shape
 * is hand-mirrored from the SDK — never imported — so assignability is not
 * compiler-checked. `stream` is dropped: the SDK splits it into two methods.
 */
function toSdkParams(body: ChatBody): Record<string, unknown> {
  const {
    messages,
    stream: _stream,
    strict_tools,
    citation_options,
    response_format,
    safety_mode,
    max_tokens,
    stop_sequences,
    frequency_penalty,
    presence_penalty,
    tool_choice,
    thinking,
    ...rest
  } = body;
  return {
    ...rest,
    messages: messages.map(sdkMessage),
    ...(strict_tools !== undefined && { strictTools: strict_tools }),
    ...(citation_options !== undefined && { citationOptions: citation_options }),
    ...(response_format !== undefined && {
      responseFormat:
        response_format.type === "json_object" && response_format.json_schema !== undefined
          ? { type: "json_object", jsonSchema: response_format.json_schema }
          : { type: response_format.type },
    }),
    ...(safety_mode !== undefined && { safetyMode: safety_mode }),
    ...(max_tokens !== undefined && { maxTokens: max_tokens }),
    ...(stop_sequences !== undefined && { stopSequences: stop_sequences }),
    ...(frequency_penalty !== undefined && { frequencyPenalty: frequency_penalty }),
    ...(presence_penalty !== undefined && { presencePenalty: presence_penalty }),
    ...(tool_choice !== undefined && { toolChoice: tool_choice }),
    ...(thinking !== undefined && {
      thinking:
        thinking.type === "enabled" && thinking.token_budget !== undefined
          ? { type: "enabled", tokenBudget: thinking.token_budget }
          : { type: thinking.type },
    }),
  };
}

/**
 * The SDK targets this endpoint declares: `cohere-ai`'s `client.v2.chat()`.
 *
 * No `.toApi`. Cohere's v2 Chat API is a fourth native dialect with no codec
 * in v1, and the availability codegen emits no `cohere` table at all — the
 * heuristic finds no other implemented provider serving a Cohere model under a
 * matching id AND display name, so there is nothing to retarget to.
 */
export type ChatSdkTargets = { cohere: () => Record<string, unknown> };

function finalize(params: ChatBody): unknown {
  const body = { ...params };
  const request: RequestMeta = { url: CHAT_URL, method: "POST", headers: JSON_HEADERS };
  return toValidated(body, request, { sdk: { cohere: () => toSdkParams(body) } });
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

const validator = createValidator<ChatBody, unknown>({
  endpoint: "cohere.chat",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [validateCapabilities, validateResponseFormatCompatibility, validateImages],
  estimate: estimateChat,
  finalize,
});

/**
 * Validates params for POST https://api.cohere.com/v2/chat. The result's
 * enumerable properties are the exact fetch JSON body; `.toSdk("cohere")`
 * re-shapes it into the camelCase `V2ChatRequest` of the `cohere-ai` SDK's
 * `client.v2.chat()`; `.request` carries url/method/static headers. Auth is
 * your job: add an `authorization: Bearer <COHERE_API_KEY>` header when
 * fetching.
 */
export const chat = validator as unknown as {
  <T extends ChatBody>(
    params: T & ExactKeys<T, ChatBody>,
    options?: ValidateOptions,
  ): Validated<T, ChatSdkTargets>;
  safe<T extends ChatBody>(
    params: T & ExactKeys<T, ChatBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, ChatSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
