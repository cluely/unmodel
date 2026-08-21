import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  chatCompletionsChecks,
  createChatCompletionsSchema,
  createChatEstimate,
  createChatFinalize,
  textContentSchema,
  type ChatCompletionsBodyBase,
  type ChatConstraintSpec,
  type ChatSdkTargets,
  type ChatTextPart,
} from "../openai-compatible/chat-completions";
import { models, type OpenaiTextModelId } from "../../catalog/openai.gen";
import { availability } from "../../catalog/availability/openai.gen";
import { chatFamilyRules, chatConstraints } from "./constraints";
import type {
  ValidatorProviderCarrier,
  ValidatorResultKind,
  ValidatorResultKindCarrier,
} from "../../core/validator-result-kind";

export const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

// The Chat Completions dialect (wire message/tool/response_format types, the
// loose schema, the catalog-driven checks, and the token/cost estimator)
// lives in src/providers/openai-compatible/chat-completions.ts — OpenAI is
// its reference composition. This module adds only what is genuinely
// OpenAI-only: the catalog, the URL, the constraint tables, and the params
// other OpenAI-compatible providers don't speak.

export { estimateChatTokens } from "../openai-compatible/chat-completions";
export type {
  ChatPromptCacheBreakpoint,
  ChatTextPart,
  ChatImagePart,
  ChatAudioPart,
  ChatFilePart,
  ChatRefusalPart,
  ChatUserContentPart,
  ChatSystemMessage,
  ChatDeveloperMessage,
  ChatUserMessage,
  ChatAssistantMessage,
  ChatToolMessage,
  ChatFunctionMessage,
  ChatMessage,
  ChatFunctionToolCall,
  ChatCustomToolCall,
  ChatToolCall,
  ChatFunctionTool,
  ChatCustomTool,
  ChatTool,
  ChatToolChoice,
  ChatResponseFormat,
} from "../openai-compatible/chat-completions";

// ---------------------------------------------------------------------------
// OpenAI-only wire types — mirror POST /v1/chat/completions exactly (verified
// against the OpenAPI-generated openai@7.4.0 types on 2026-08-12).
// ---------------------------------------------------------------------------

export interface ChatWebSearchOptions {
  search_context_size?: "low" | "medium" | "high";
  user_location?: {
    type: "approximate";
    approximate: { city?: string; country?: string; region?: string; timezone?: string };
  } | null;
}

/**
 * Catalog id families that live in `OpenaiTextModelId` but are not
 * /v1/chat/completions models (embeddings, image generation, realtime);
 * POST /v1/chat/completions rejects them with "This is not a chat model".
 */
type NonChatModelId =
  | `text-embedding-${string}`
  | `gpt-image-${string}`
  | `chatgpt-image-${string}`
  | `dall-e-${string}`
  | `gpt-realtime-${string}`
  // Codex models are served via /v1/responses only ("not supported with
  // Chat Completions" per the gpt-5-codex model docs).
  | `${string}-codex${string}`;

/** Chat-capable subset of the generated openai text-model union. */
export type OpenaiChatModelId = Exclude<OpenaiTextModelId, NonChatModelId>;

/**
 * The common dialect plus OpenAI-only params, with OpenAI's exact enum unions
 * where the dialect leaves the string open (reasoning_effort, service_tier).
 */
export interface ChatCompletionsBody
  extends Omit<ChatCompletionsBodyBase, "model" | "reasoning_effort" | "service_tier"> {
  model: OpenaiChatModelId | (string & {});
  audio?: {
    format: "wav" | "aac" | "mp3" | "flac" | "opus" | "pcm16";
    /** A built-in voice name, or a custom voice object `{ id: "voice_1234" }`. */
    voice: string | { id: string };
  } | null;
  metadata?: Record<string, string> | null;
  modalities?: Array<"text" | "audio"> | null;
  moderation?: {
    model: string;
    policy?: {
      input?: { mode: "score" | "block" } | null;
      output?: { mode: "score" | "block" } | null;
    } | null;
  } | null;
  prediction?: { type: "content"; content: string | ChatTextPart[] } | null;
  prompt_cache_key?: string | null;
  prompt_cache_options?: { mode?: "implicit" | "explicit"; ttl?: "30m" };
  /** @deprecated Use `prompt_cache_options.ttl`. */
  prompt_cache_retention?: "in_memory" | "24h" | null;
  /**
   * "Currently supported values are `none`, `minimal`, `low`, `medium`,
   * `high`, `xhigh`, and `max`." Re-verified 2026-08-13 against
   * https://developers.openai.com/api/docs/api-reference/chat/create. The
   * same page adds "Not all reasoning models support every value. See the
   * reasoning guide for model-specific support" WITHOUT enumerating which
   * value each family takes, so there is deliberately no per-model
   * `reasoning_effort` constraint — an undocumented narrowing would
   * false-positive.
   */
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  safety_identifier?: string | null;
  /**
   * The chat/create reference documents `auto`, `default`, `flex`, `fast` and
   * `priority` (checked 2026-08-13); `scale` is kept because the docs never
   * state it is rejected — absence is not a documented denial.
   */
  service_tier?: "auto" | "default" | "flex" | "scale" | "priority" | "fast" | null;
  store?: boolean | null;
  verbosity?: "low" | "medium" | "high" | null;
  web_search_options?: ChatWebSearchOptions;
}

// ---------------------------------------------------------------------------
// Schema — the shared dialect shape plus OpenAI-only top-level params, loose
// everywhere so unknown keys pass through (the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const chatSchema = createChatCompletionsSchema({
  audio: z
    .looseObject({
      format: z.string(),
      voice: z.union([z.string(), z.looseObject({ id: z.string() })]),
    })
    .nullable()
    .optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  modalities: z.array(z.enum(["text", "audio"])).nullable().optional(),
  moderation: z.looseObject({ model: z.string() }).nullable().optional(),
  prediction: z
    .looseObject({ type: z.literal("content"), content: textContentSchema })
    .nullable()
    .optional(),
  prompt_cache_key: z.string().nullable().optional(),
  prompt_cache_options: z
    .looseObject({ mode: z.enum(["implicit", "explicit"]).optional(), ttl: z.string().optional() })
    .optional(),
  prompt_cache_retention: z.enum(["in_memory", "24h"]).nullable().optional(),
  safety_identifier: z.string().nullable().optional(),
  store: z.boolean().nullable().optional(),
  verbosity: z.enum(["low", "medium", "high"]).nullable().optional(),
  web_search_options: z
    .looseObject({
      search_context_size: z.enum(["low", "medium", "high"]).optional(),
      user_location: z
        .looseObject({
          type: z.literal("approximate"),
          approximate: z.looseObject({
            city: z.string().optional(),
            country: z.string().optional(),
            region: z.string().optional(),
            timezone: z.string().optional(),
          }),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Validator — shared checks/estimator wired to OpenAI's constraint tables.
// ---------------------------------------------------------------------------

const CHAT_CONSTRAINT_SPEC: ChatConstraintSpec = {
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
};

const validator = createValidator<ChatCompletionsBody, unknown>({
  endpoint: "openai.chat",
  schema: chatSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
  checks: chatCompletionsChecks(CHAT_CONSTRAINT_SPEC),
  estimate: createChatEstimate(CHAT_CONSTRAINT_SPEC),
  promptPath: ["messages"],
  finalize: createChatFinalize({
    endpoint: "openai.chat",
    request: {
      url: CHAT_COMPLETIONS_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    availability,
  }),
});

type AppliedOpenAIChatBody<Input> = Input extends { model: infer Model extends string }
  ? Omit<ChatCompletionsBody, "model"> & { model: Model }
  : never;

/** Registry-instantiable form of this endpoint's generic result. */
export interface OpenAIChatResultKind extends ValidatorResultKind {
  readonly output: AppliedOpenAIChatBody<this["input"]> extends infer Body
    ? Body extends ChatCompletionsBody
      ? Validated<
          Body,
          ChatSdkTargets<Body>,
          typeof availability,
          Body["model"] & string
        >
      : never
    : never;
}

/**
 * Validates params for POST /v1/chat/completions. The result's enumerable
 * properties are the exact fetch body; `.toSdk("openai")` returns the wire body
 * unchanged in shape (OpenAI's SDK params are wire-shaped), `.request` carries
 * url/method/static headers, and `.toApi(provider)` retargets the request to
 * any provider that serves the same model (`gpt-oss-120b` → groq, cerebras,
 * togetherai, …), typed off the generated availability table. `"openai"` is
 * always in that union: the identity retarget returns the same wire body at
 * the same URL, so a provider-generic call site needs no special case.
 */
export const chat = validator as unknown as {
  <T extends ChatCompletionsBody>(
    params: T & ExactKeys<T, ChatCompletionsBody>,
    options?: ValidateOptions,
  ): Validated<T, ChatSdkTargets<T>, typeof availability, T["model"] & string>;
  safe<T extends ChatCompletionsBody>(
    params: T & ExactKeys<T, ChatCompletionsBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, ChatSdkTargets<T>, typeof availability, T["model"] & string>>;
  constraintsFor(modelId: string): EndpointConstraints[];
} & ValidatorResultKindCarrier<OpenAIChatResultKind> & ValidatorProviderCarrier<"openai">;
