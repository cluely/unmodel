// The OpenAI-compatible provider factory. This module exports only the
// factory plus the shared dialect types/pieces — a raw unconfigured endpoint
// is meaningless, so there is no default `openaiCompatible.chat`. Overlay
// modules (unmodel/groq etc.) call
// `createOpenAICompatible<TheirModelId, typeof availability, "id">` with their
// generated catalog, so `model` gets their exact literal union and
// `.toApi(provider)` gets their exact retarget targets.

import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { AvailabilityMap } from "../../core/translate/availability-types";
import type { EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import {
  chatCompletionsChecks,
  createChatCompletionsSchema,
  createChatEstimate,
  createChatFinalize,
  estimateChatTokens,
  type ChatCompletionsBodyBase,
  type ChatConstraintSpec,
  type ChatFinalizeSpec,
  type ChatSdkTargets,
} from "./chat-completions";
import { createCheckChat, type ChatCompletionLike, type ChatFinishReason } from "./check";
import type { ResponseReport } from "../../core/report";
import type {
  ValidatorProviderCarrier,
  ValidatorResultKind,
  ValidatorResultKindCarrier,
} from "../../core/validator-result-kind";

declare const openaiCompatibleCatalog: unique symbol;

/**
 * Nominal, type-only carrier for the EXACT catalog an overlay was built with.
 *
 * Same device, and the same reasoning, as `ValidatorProviderCarrier` in
 * src/core/validator-result-kind.ts: the property is optional, so carrying it
 * never grows a fake runtime member and the factory's plain object literal
 * still satisfies the interface.
 *
 * It exists because every generated catalog is
 * `as const satisfies Record<string, ModelInfo>` — `models.limit.output`,
 * `models.toolCall`, `keyof typeof models` are all literal at the source — and
 * `catalog: Record<string, ModelInfo>` on the config used to discard every one
 * of them at the factory boundary. That is what blocked per-model narrowing
 * for the ~30-provider fleet, not catalog size. Threading `Catalog` through
 * keeps the literals reachable so a future per-dialect arm can read
 * `Catalog[M]["toolCall"]`.
 */
export interface OpenAICompatibleCatalogCarrier<Catalog extends Record<string, ModelInfo>> {
  readonly [openaiCompatibleCatalog]?: Catalog;
}

/** The exact catalog a factory-built provider carries, or `never` when unmarked. */
export type OpenAICompatibleCatalogOf<Provider> =
  typeof openaiCompatibleCatalog extends keyof Provider
    ? Provider extends OpenAICompatibleCatalogCarrier<infer Catalog>
      ? Catalog
      : never
    : never;

export interface OpenAICompatibleConfigBase<
  Avail extends AvailabilityMap = never,
  Catalog extends Record<string, ModelInfo> = Record<string, ModelInfo>,
> {
  /** Short provider id, e.g. "groq" — used in endpoint names ("groq.chat") and messages. */
  id: string;
  /**
   * Per-model catalog (generated models.gen.ts or a hand-maintained models.ts).
   *
   * Typed as the INFERRED `Catalog`, not as `Record<string, ModelInfo>`: the
   * wide annotation type-checks identically and silently throws away the
   * literal keys, capability flags and limits the generated
   * `as const satisfies Record<string, ModelInfo>` object carries. `Catalog`
   * defaults to the wide record, so every existing
   * `createOpenAICompatible<ModelId, Avail, Provider>({…})` call — all of
   * which pass three explicit type arguments — keeps compiling unchanged.
   */
  catalog: Catalog;
  /**
   * This provider's generated cross-provider availability table, imported
   * directly by the overlay:
   *
   * ```ts
   * import { availability } from "../../catalog/availability/groq.gen";
   * createOpenAICompatible<GroqTextModelId, typeof availability, "groq">({ …, availability });
   * ```
   *
   * Passing it is what gives `chat()`'s result `.toApi(provider)`; the type
   * argument and this value are the same table, so the compile-time union and
   * the runtime lookup cannot drift apart. Overlays whose provider has no
   * generated table simply omit both (the field's type is then `never`), and
   * `.toApi` does not exist for them — in the type or at runtime.
   *
   * There is deliberately no aggregating index over `catalog/availability/`:
   * each overlay imports exactly its own table, so `unmodel/groq` pays ~1 KB
   * rather than the fleet's ~185 KB.
   */
  availability?: Avail;
  /**
   * Decoders for the other wire dialects this overlay's availability data can
   * reach, declared as a plain object literal so a bundler sees exactly which
   * codecs the overlay needs:
   *
   * ```ts
   * import { decodeAnthropic } from "../anthropic/interop";
   * import { decodeGemini } from "../google/interop";
   * createOpenAICompatible<…>({ …, decoders: { "anthropic-messages": decodeAnthropic, gemini: decodeGemini } });
   * ```
   *
   * Most overlays omit this: their availability data names only other
   * OpenAI-compatible providers, and that path is a model-id respell plus a
   * URL swap. The two gateways whose data does name Gemini and Anthropic
   * targets (openrouter, vercel) declare it and pay for those two modules;
   * everyone else pays nothing.
   */
  decoders?: ChatFinalizeSpec["decoders"];
  /** Hand-written per-model constraint table for provider quirks. */
  constraints?: Readonly<Partial<Record<string, EndpointConstraints>>>;
  /** Pattern rules (reasoning families, endpoint-wide media limits etc.). */
  familyRules?: readonly FamilyRule[];
  /** Extra static non-auth headers sent with every chat request. */
  headers?: Record<string, string>;
  /**
   * Provider-specific checks run after the shared dialect checks — for
   * quirks the per-param deny/enum tables can't express (nested fields,
   * cross-param rules).
   */
  extraChecks?: ReadonlyArray<
    (params: ChatCompletionsBodyBase, info: ModelInfo | undefined, ctx: PipelineContext) => void
  >;
}

/**
 * Factory config: exactly one of `baseUrl` (the standard case — the chat URL
 * is baseUrl + "/chat/completions") or `chatUrl` (a full-URL override for
 * endpoints that do not follow the fixed path, e.g. Azure's resource-scoped
 * `{endpoint}/openai/v1/chat/completions`).
 */
export type OpenAICompatibleConfig<
  Avail extends AvailabilityMap = never,
  Catalog extends Record<string, ModelInfo> = Record<string, ModelInfo>,
> = OpenAICompatibleConfigBase<Avail, Catalog> &
  (
    | {
        /**
         * OpenAI-compatible base URL without a trailing slash, e.g.
         * "https://api.groq.com/openai/v1"; the chat URL is baseUrl + "/chat/completions".
         */
        baseUrl: string;
        chatUrl?: undefined;
      }
    | {
        baseUrl?: undefined;
        /** Complete chat completions URL, used verbatim (query params included). */
        chatUrl: string;
      }
  );

/**
 * The standard validator surface, with `model` narrowed to the provider's
 * union and `.toApi`'s targets read off the provider's availability table.
 *
 * `Avail` defaults to `never`, which makes `.toApi` vanish from the result
 * type entirely (see `Validated`) — that is the shape an overlay gets when it
 * passes no `availability`.
 */
/** Registry-instantiable result type for every OpenAI-compatible overlay. */
export interface OpenAICompatibleChatResultKind<
  ModelId extends string,
  Avail extends AvailabilityMap,
> extends ValidatorResultKind {
  readonly output: this["input"] extends ChatCompletionsBodyBase<ModelId>
    ? Validated<
        this["input"],
        ChatSdkTargets<this["input"]>,
        Avail,
        this["input"]["model"] & string
      >
    : never;
}

export interface OpenAICompatibleChat<
  ModelId extends string = string,
  Avail extends AvailabilityMap = never,
  Provider extends string = string,
> extends ValidatorResultKindCarrier<OpenAICompatibleChatResultKind<ModelId, Avail>>,
    ValidatorProviderCarrier<Provider> {
  <T extends ChatCompletionsBodyBase<ModelId>>(
    params: T & ExactKeys<T, ChatCompletionsBodyBase<ModelId>>,
    options?: ValidateOptions,
  ): Validated<T, ChatSdkTargets<T>, Avail, T["model"] & string>;
  safe<T extends ChatCompletionsBodyBase<ModelId>>(
    params: T & ExactKeys<T, ChatCompletionsBodyBase<ModelId>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, ChatSdkTargets<T>, Avail, T["model"] & string>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

export interface OpenAICompatibleProvider<
  ModelId extends string = string,
  Avail extends AvailabilityMap = never,
  Provider extends string = string,
  Catalog extends Record<string, ModelInfo> = Record<string, ModelInfo>,
> extends OpenAICompatibleCatalogCarrier<Catalog> {
  /**
   * Validates params for POST {baseUrl}/chat/completions. The result's
   * enumerable properties are the exact fetch body; `.toSdk("openai")` returns
   * the wire body unchanged in shape (this dialect's SDK params are the OpenAI
   * SDK's), `.request` carries url/method/static headers, and — for overlays
   * that pass an `availability` table — `.toApi(provider)` retargets to any
   * provider that serves the same model, this one included (identity).
   */
  chat: OpenAICompatibleChat<ModelId, Avail, Provider>;
  /** {baseUrl}/chat/completions, or the configured `chatUrl` override verbatim. */
  chatUrl: string;
  /**
   * Post-generation response inspection + usage pricing. Never throws.
   *
   * The `ResponseReport<ChatFinishReason>` return type is load-bearing and
   * must not be relaxed to a bare `ResponseReport`: this member re-annotates
   * `createCheckChat`'s result, so writing the wide form here throws the
   * narrowed `finishReason` away for EVERY overlay at once and
   * `report.finishReason === "` completes nothing across the whole fleet.
   * `test/unified/completions.test.ts` pins that.
   */
  checkChat: (res: ChatCompletionLike) => ResponseReport<ChatFinishReason>;
  /** The shared heuristic prompt-token estimator. */
  estimateChatTokens: typeof estimateChatTokens;
}

/**
 * Builds one overlay's chat surface.
 *
 * `Avail` is inferred from the `availability` value on its own — but naming
 * `ModelId` explicitly (which every overlay must, since it is a phantom: the
 * catalog's value type erases its keys) turns inference off for the rest, so
 * overlays write all three. Passing the table as a value as well as a type
 * keeps the two honest: the type argument names the object the runtime looks
 * up in.
 *
 * `Catalog` is INFERRED (and `const`, so an inline object literal keeps its
 * literal types too), never written by an overlay. It is fourth and defaulted
 * precisely so it stays invisible: every overlay passes exactly three explicit
 * type arguments, TypeScript then fills the fourth from its default rather
 * than inferring it, and all 33 call sites keep compiling byte-identically.
 * An overlay opts in by naming it — `createOpenAICompatible<Id, Avail, Prov,
 * typeof models>({…})` — which is what makes `keyof Catalog` and
 * `Catalog[M]["toolCall"]` reachable from the returned provider.
 *
 * That reach is deliberately UNUSED here. Turning a catalog capability flag
 * into a compile error is a separate decision and a bad one for the
 * gateway/aggregator overlays specifically: models.dev's openrouter rows are
 * unaudited aggregation (66 of 349 carry `toolCall: false`, including models
 * that demonstrably tool-call), so gating on them would refuse requests that
 * work. This parameter is the unblock, not the gate.
 *
 * `Provider` is the models.dev id, repeated as a type argument because
 * `config.id` is a `string` by the time the parameter type is formed and TS
 * has no partial inference to recover the literal from it. It is not
 * decoration: it is what makes `createChat({ groq: togetheraiChat })` — two
 * validators with identical structural types, serving overlapping model ids,
 * on different hosts — a compile error rather than a silently misaddressed
 * request. `createChat` also re-checks it at runtime against the endpoint the
 * validator reports, so an unbranded third-party validator is still caught.
 *
 * ```ts
 * import { availability } from "../../catalog/availability/groq.gen";
 * createOpenAICompatible<GroqTextModelId, typeof availability, "groq">({
 *   id: provider.id, baseUrl: "…", catalog: models, availability,
 * });
 * ```
 */
export function createOpenAICompatible<
  ModelId extends string = string,
  Avail extends AvailabilityMap = never,
  Provider extends string = string,
  const Catalog extends Record<string, ModelInfo> = Record<string, ModelInfo>,
>(
  config: OpenAICompatibleConfig<Avail, Catalog>,
): OpenAICompatibleProvider<ModelId, Avail, Provider, Catalog> {
  const chatUrl =
    config.chatUrl !== undefined ? config.chatUrl : `${config.baseUrl}/chat/completions`;
  // One id for both the validator's issue labels and the retarget route
  // (`"groq.chat → cerebras.chat"`); they must agree.
  const endpoint = `${config.id}.chat`;
  const spec: ChatConstraintSpec = {
    ...(config.constraints !== undefined && { constraints: config.constraints }),
    ...(config.familyRules !== undefined && { familyRules: config.familyRules }),
  };

  const validator = createValidator<ChatCompletionsBodyBase, unknown>({
    endpoint,
    schema: createChatCompletionsSchema(),
    modelId: (params) => params.model,
    catalog: config.catalog,
    ...spec,
    checks: [...chatCompletionsChecks(spec), ...(config.extraChecks ?? [])],
    estimate: createChatEstimate(spec),
    promptPath: ["messages"],
    finalize: createChatFinalize({
      endpoint,
      provider: config.id,
      request: {
        url: chatUrl,
        method: "POST",
        headers: { ...JSON_HEADERS, ...config.headers },
      },
      ...(config.availability !== undefined && { availability: config.availability }),
      ...(config.decoders !== undefined && { decoders: config.decoders }),
    }),
  });

  return {
    chat: validator as unknown as OpenAICompatibleChat<ModelId, Avail, Provider>,
    chatUrl,
    checkChat: createCheckChat(config.catalog, config.id),
    estimateChatTokens,
  };
}

// Shared dialect pieces, re-exported for overlays and provider compositions.
export {
  chatCompletionsChecks,
  checkInputModalities,
  checkOutputLimit,
  checkReasoningCapability,
  checkSamplingParams,
  checkStructuredOutput,
  checkToolSupport,
  createChatCompletionsSchema,
  createChatEstimate,
  createChatFinalize,
  createInlineImagesCheck,
  estimateChatTokens,
  imageTokensFor,
  messagesSchema,
  textContentSchema,
  DEFAULT_IMAGE_TOKENS,
} from "./chat-completions";
export type {
  ChatAssistantMessage,
  ChatAudioPart,
  ChatCompletionsBodyBase,
  ChatConstraintSpec,
  ChatFinalizeSpec,
  ChatSdkTargets,
  ChatCustomTool,
  ChatCustomToolCall,
  ChatDeveloperMessage,
  ChatFilePart,
  ChatFunctionMessage,
  ChatFunctionTool,
  ChatFunctionToolCall,
  ChatImagePart,
  ChatMessage,
  ChatPromptCacheBreakpoint,
  ChatRefusalPart,
  ChatResponseFormat,
  ChatSystemMessage,
  ChatTextPart,
  ChatTool,
  ChatToolCall,
  ChatToolChoice,
  ChatToolMessage,
  ChatUserContentPart,
  ChatUserMessage,
} from "./chat-completions";
export { createCheckChat } from "./check";
export type { ChatChoiceLike, ChatCompletionLike, ChatFinishReason } from "./check";
