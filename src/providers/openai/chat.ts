import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ModelInfo } from "../../core/catalog-types";
import type { ChatCompletionsBodyOf } from "./wire";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  chatCompletionsChecks,
  createChatCompletionsSchema,
  createChatEstimate,
  createChatFinalize,
  textContentSchema,
  type ChatConstraintSpec,
  type ChatSdkTargets,
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
// The wire SHAPE moved to ./wire.ts, a type-only leaf, so `providerOptions
// .openai` can be typed off the real endpoint body without `src/chat/**`
// importing this module. What stayed here is everything that needs the
// catalog: `dialects.ts` is a hub whose chunk every provider's `types.ts`
// entry reaches, so a `catalog/openai.gen` import in the leaf cost +43 KiB on
// fifty-seven declaration graphs. This module's public surface is unchanged
// and `unmodel/openai` still names all four at their old address.
// ---------------------------------------------------------------------------

export type { ChatWebSearchOptions } from "./wire";

/**
 * Catalog id families that live in `OpenaiTextModelId` but are not
 * /v1/chat/completions models (embeddings, image generation, realtime);
 * POST /v1/chat/completions rejects them with "This is not a chat model".
 *
 * Exported because it is now stated three times on purpose. This is the *type*
 * half, which shapes {@link OpenaiChatModelId}; the runtime half is
 * `NON_CHAT_ROUTES` below (a check cannot read a type), and the
 * ref-generation half is `chatScopeExclude` in
 * data/availability-overrides.json (codegen cannot read `src/`).
 * `./chat.test.ts` pins the runtime table against the data file, and
 * `test/chat/refs.test.ts` pins the generated refs against this type.
 */
export type NonChatModelId =
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
 * OpenAI's `/v1/chat/completions` body — {@link ChatCompletionsBodyOf} with
 * `model` closed to the chat-capable catalog ids.
 */
export interface ChatCompletionsBody extends ChatCompletionsBodyOf<OpenaiChatModelId> {}

// ---------------------------------------------------------------------------
// Substrate signpost — the models this endpoint cannot serve
//
// `NonChatModelId` (./wire.ts) shapes autocomplete and refuses nothing: the
// `(string & {})` tail means `openai.chat({ model: "gpt-5.3-codex" })` type-
// checks, and until this check existed it also validated clean, emitted a Chat
// Completions body and addressed /v1/chat/completions — for a model whose own
// docs read "Chat Completions | v1/chat/completions | Not supported".
//
// A WARNING, not an error, and the severity is the whole design. Wire-truth
// (docs/decisions.md §1) says a substrate validator mirrors the documented
// request and never refuses what the API might fulfil — models.dev is a
// snapshot, OpenAI's routing is not unmodel's to enforce, and a caller who
// knows better must be able to send. The typed refusal lives one layer up,
// where `unmodel/chat` no longer generates a ref for these ids at all
// (`chatScopeExclude`, data/availability-overrides.json), so the unified
// surface answers at compile time and the substrate answers at validate time.
//
// The table is the runtime twin of `NonChatModelId`: a check cannot read a
// type, so the families are stated twice and pinned against each other in
// ./chat.test.ts.
// ---------------------------------------------------------------------------

interface NonChatRoute {
  match: RegExp;
  /** The route OpenAI actually serves these ids on. */
  route: string;
  /** What to reach for instead, or `undefined` when unmodel serves nothing. */
  instead: string | undefined;
}

const NON_CHAT_ROUTES: readonly NonChatRoute[] = [
  {
    // `gpt-5.3-codex`, `gpt-5.3-codex-spark`. The one family unmodel has no
    // surface for at all, which is exactly what decisions.md #7 records.
    match: /-codex(?:$|-)/,
    route: "POST /v1/responses",
    instead: undefined,
  },
  {
    match: /^text-embedding-/,
    route: "POST /v1/embeddings",
    instead: undefined,
  },
  {
    match: /^(?:gpt-image-|chatgpt-image-|dall-e-)/,
    route: "POST /v1/images/generations",
    instead: "`image` from `unmodel/openai`",
  },
  {
    match: /^gpt-realtime-/,
    route: "the Realtime API",
    instead: "`realtimeSession` from `unmodel/openai`",
  },
];

/**
 * Names the route a non-chat model is actually served on.
 *
 * Runs on the raw id before any catalog lookup, because the point is to answer
 * for ids the catalog *does* carry (models.dev files all nine as text-out) as
 * well as ones it does not.
 */
function checkChatCompletionsRoute(
  params: ChatCompletionsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const route = NON_CHAT_ROUTES.find((entry) => entry.match.test(model));
  if (route === undefined) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["model"],
    model,
    message:
      `"${model}" is served by ${route.route}, not POST /v1/chat/completions — ` +
      `OpenAI's model reference lists Chat Completions as not supported for it, so this ` +
      `request is expected to come back 400. ` +
      (route.instead === undefined
        ? `unmodel has no validator for ${route.route}; send it yourself, or pick a chat model.`
        : `Use ${route.instead} instead.`) +
      " The request is sent as written all the same.",
    meta: { route: route.route, source: MODELS_DOCS_URL },
  });
}

/** Where the per-model "Endpoints" table lives — the page the message quotes. */
const MODELS_DOCS_URL = "https://developers.openai.com/api/docs/models";

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
  checks: [...chatCompletionsChecks(CHAT_CONSTRAINT_SPEC), checkChatCompletionsRoute],
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

/**
 * The declared body with `model` pinned to the registry-supplied input's — and
 * `stream` taken from that input rather than from the declaration.
 *
 * The anthropic and google result kinds intersect the whole `this["input"]`, so
 * they inherit that narrowing for free; this one reads `model` out of the input
 * and rebuilds from the declared body, so the one field the unified compiler
 * knows better than the declaration has to be named. Why it matters is in
 * `ProviderParamsFor` (src/chat/factory.ts): `stream` is the discriminant in
 * OpenAI's SDK union, an open `boolean` matches neither arm, and
 * `src/chat/encode.ts` emits the key only when the caller wrote it. The input
 * this receives has already had `stream` resolved, so this forwards rather than
 * decides.
 */
type AppliedOpenAIChatBody<Input> = Input extends { model: infer Model extends string }
  ? Omit<ChatCompletionsBody, "model" | "stream"> &
      { model: Model } &
      ("stream" extends keyof Input ? { stream: Input["stream" & keyof Input] } : unknown)
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
    options?: ValidateOptions<T>,
  ): Validated<T, ChatSdkTargets<T>, typeof availability, T["model"] & string>;
  safe<T extends ChatCompletionsBody>(
    params: T & ExactKeys<T, ChatCompletionsBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ChatSdkTargets<T>, typeof availability, T["model"] & string>>;
  constraintsFor(modelId: string): EndpointConstraints[];
} & ValidatorResultKindCarrier<OpenAIChatResultKind> & ValidatorProviderCarrier<"openai">;

// Part of this module's inferred public types, and therefore part of what a
// declaration-emitting consumer has to be able to name — see
// src/core/carriers.ts. `ChatSdkTargets` is the shared dialect's, re-exported
// through here rather than imported directly by ./index.ts so the barrel keeps
// naming exactly one module per concern.
export type { ChatSdkTargets } from "../openai-compatible/chat-completions";
