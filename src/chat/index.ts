/**
 * `unmodel/chat` — one `chat()` for every provider.
 *
 * ```ts
 * import { chat } from "unmodel/chat";
 *
 * const req = chat({
 *   model: "anthropic/claude-opus-5",
 *   messages: [{ role: "user", content: "Explain retargeting." }],
 *   reasoning: { budgetTokens: 2048 },
 *   maxOutputTokens: 4096,
 * });
 *
 * await fetch(req.request.url, {
 *   method: req.request.method,
 *   headers: { ...req.request.headers, "x-api-key": process.env.ANTHROPIC_API_KEY! },
 *   body: JSON.stringify(req),          // enumerable props ARE the wire body
 * });
 * ```
 *
 * Change `model` to `"openai/gpt-5.2"` and the same object compiles to
 * `max_completion_tokens` + `reasoning_effort` at
 * `api.openai.com/v1/chat/completions`. That is the entire proposition.
 *
 * ## What this entry is, relative to the provider subpaths
 *
 * `unmodel/anthropic`'s `chat()` mirrors `/v1/messages` exactly — `max_tokens`,
 * `cache_control`, the lot — because a validator that renamed things would be
 * lying about the request it validates. This one takes the opposite trade: one
 * camelCase vocabulary, and the compiler emits whichever body the ref names.
 * Portability costs exactness, which is why anything genuinely one-off rides in
 * `providerOptions` rather than being invented here.
 *
 * The two compose, and that is the recommended way to get both: the result's
 * enumerable properties are the target's wire body, so
 * `anthropicChat({ ...chat({ model: "anthropic/…", … }) })` runs the full,
 * catalog-aware, provider-exact pass over the compiled request.
 *
 * ## No `.toApi()` here, deliberately
 *
 * A provider result offers `.toApi(target)` because it starts in one dialect
 * and may want another. A unified result has no dialect to leave — retargeting
 * it means changing `model` and calling `chat()` again, which is a string edit,
 * not an API. Adding `.toApi` would mean bundling the availability tables this
 * entry exists without.
 *
 * ## The type surface
 *
 * `chat()`'s return type is keyed off the model ref's **provider half**, split
 * on the first slash exactly as the runtime splits it — so
 * `chat({ model: "anthropic/claude-opus-5", … })` is typed as an Anthropic
 * `/v1/messages` body, `"google/…"` as a Gemini body with no `model` key (it
 * lives in the URL), and everything else as chat-completions. A ref whose
 * provider is not one of the 32 degrades to the union of all three bodies
 * rather than to `any`: unknown at compile time, still callable at runtime.
 */
import { UnmodelValidationError } from "../core/issues";
import type { ExactKeys, Validated } from "../core/request";
import type { ValidateResult } from "../core/result";
import type { AiSdkChatResult } from "../core/translate/ai-sdk";
import type { TranslationWarning } from "../core/translate/warnings";
// Type-only: `src/retarget/dialects.ts` maps a dialect to its wire body and is
// itself built from type-only wire-leaf imports, so this costs zero bytes and
// guarantees the compiled body's type is the same one `.toApi` hands out.
import type { DialectBody } from "../retarget/dialects";
import type { ChatModelRef, ChatProviderId } from "../catalog/chat-refs.gen";
import type { ChatCatalog, ChatModelProfile } from "../catalog/chat-profiles.gen";
import { chatProfiles } from "../catalog/chat-profiles.gen";
import type { ChatOptions } from "./validate";
import { CHAT_ENDPOINT, runChat } from "./validate";
import type { ChatParams } from "./types";

// ---------------------------------------------------------------------------
// Ref → dialect, at the type level
// ---------------------------------------------------------------------------

/** The three dialects `unmodel/chat` can compile to. */
export type ChatDialect = "openai-chat" | "anthropic-messages" | "gemini";

/**
 * The 30 providers that speak chat-completions — every chat provider except
 * the two with their own wire format. Derived rather than listed so a new
 * provider in the generated union lands in the right arm automatically.
 */
type OpenAiChatProviderId = Exclude<ChatProviderId, "anthropic" | "google">;

/**
 * `"openrouter/anthropic/claude-opus-5"` → `"openrouter"`.
 *
 * Template-literal inference is non-greedy from the left, so `infer P` stops at
 * the **first** slash — the same rule `parseModelRef` implements at runtime,
 * and the reason a slashed model id does not become a provider named
 * `openrouter/anthropic`.
 */
export type ChatProviderOf<R extends string> = R extends `${infer P}/${string}` ? P : string;

/** `"openrouter/anthropic/claude-opus-5"` → `"anthropic/claude-opus-5"`. */
export type ChatModelOf<R extends string> = R extends `${infer _P}/${infer M}` ? M : string;

/**
 * The wire dialect a ref compiles to. A ref whose provider half is not one of
 * the 32 — a typo, or a provider that shipped after this snapshot — resolves to
 * the full union, which is what makes the return type degrade to "one of the
 * three bodies" instead of to `any`.
 */
export type ChatDialectOf<R extends string> = R extends `${infer P}/${string}`
  ? P extends "anthropic"
    ? "anthropic-messages"
    : P extends "google"
      ? "gemini"
      : P extends OpenAiChatProviderId
        ? "openai-chat"
        : ChatDialect
  : ChatDialect;

/** The compiled wire body for a ref: the target dialect's shape. */
export type ChatBody<R extends string> = DialectBody<ChatDialectOf<R>, ChatModelOf<R>>;

/**
 * `@google/genai`'s `ai.models.generateContent()` params, which are the one
 * SDK shape that is not the wire body — `generationConfig`'s fields fold up
 * into `config` alongside `systemInstruction` / `tools` / `toolConfig`.
 */
export interface ChatGeminiSdkParams<M extends string = string> {
  model: M | (string & {});
  contents: unknown;
  config?: Record<string, unknown>;
}

/**
 * The `toSdk` targets a compiled result offers, by dialect.
 *
 * Written as a type alias rather than an interface on purpose: an
 * `interface extends Record<string, …>` inherits a string index signature,
 * which collapses `keyof` to `string` and makes `.toSdk("anything")`
 * type-check. See `SdkFormatters` in `core/request.ts`.
 *
 * When the dialect is unknown this resolves to a *union* of the three maps, and
 * `keyof` a union is the intersection of its keys — so an unresolvable ref
 * offers exactly `"ai-sdk"`, the one target every dialect has. That is the
 * correct answer rather than a lucky one.
 */
export type ChatSdkTargets<D, M extends string> = D extends "anthropic-messages"
  ? {
      anthropic: () => DialectBody<"anthropic-messages", M>;
      "ai-sdk": () => AiSdkChatResult;
    }
  : D extends "gemini"
    ? { google: () => ChatGeminiSdkParams<M>; "ai-sdk": () => AiSdkChatResult }
    : { openai: () => DialectBody<"openai-chat", M>; "ai-sdk": () => AiSdkChatResult };

/**
 * The two facts a compiled result carries that the wire body cannot.
 *
 * Both are non-enumerable, so `JSON.stringify(result)` is still exactly the
 * fetch body — and both are exempt from `ExactKeys`, which is what makes
 * `googleChat({ model: result.modelId, ...result })` compile.
 */
export interface ChatResultMeta<R extends string> {
  /** The provider the request compiled for — `model`'s first-slash prefix. */
  readonly target: ChatProviderOf<R>;
  /**
   * The **bare** model id. Not always on the body: Gemini puts it in the URL,
   * so this is the only place to read it back for a Gemini request.
   */
  readonly modelId: ChatModelOf<R>;
  /**
   * Everything compiling this request cost — a param with no equivalent on the
   * target, a reasoning level narrowed to the nearest one it can express, a
   * file handle minted by another provider. Empty means the translation was
   * lossless, and is asserted as such by the golden suite.
   */
  readonly warnings: readonly TranslationWarning[];
}

/**
 * What `chat()` returns: the target dialect's wire body (enumerable), plus
 * `toSdk`, `request`, `target`, `modelId` and `warnings` (all not).
 *
 * No `toApi` — `Validated`'s availability parameter is left at its `never`
 * default, which makes that member resolve to `unknown` and disappear.
 */
export type ChatResult<R extends string> = Validated<
  ChatBody<R>,
  ChatSdkTargets<ChatDialectOf<R>, ChatModelOf<R>>
> &
  ChatResultMeta<R>;

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

function safe(params: ChatParams, options: ChatOptions = {}): ValidateResult<object> {
  return runChat(params, options).result;
}

function validator(params: ChatParams, options: ChatOptions = {}): object {
  const { result, structural } = runChat(params, options);
  // Structural first, so the thrown type stays `TranslationUnavailableError`
  // rather than collapsing into a validation error that names no fixable param.
  if (structural !== undefined) throw structural;
  if (!result.ok) throw new UnmodelValidationError(CHAT_ENDPOINT, result.errors, result.warnings);
  return result.params;
}

validator.safe = safe;

/**
 * Validates a request in unmodel's unified chat vocabulary and compiles it to
 * the wire body of whichever provider `model` names.
 *
 * Four layers run before anything is emitted: the shape of `ChatParams`; the
 * model's entry in the bundled profile table (capabilities, limits, price); the
 * target provider's hand-written deny/enum rules, against the *compiled* body;
 * and a heuristic token estimate against the context window and
 * `options.maxCostUSD`.
 *
 * Throws `UnmodelValidationError` with every error issue aggregated, and
 * `TranslationUnavailableError` when the ref names a provider this entry
 * structurally cannot serve (cohere's fifth dialect, the factory-configured
 * providers, amazon-bedrock, a typo). Warnings never throw — they ride on the
 * result. `chat.safe()` returns a `ValidateResult` and throws neither.
 */
export const chat = validator as unknown as {
  <T extends ChatParams>(
    params: T & ExactKeys<T, ChatParams>,
    options?: ChatOptions,
  ): ChatResult<T["model"] & string>;
  safe<T extends ChatParams>(
    params: T & ExactKeys<T, ChatParams>,
    options?: ChatOptions,
  ): ValidateResult<ChatResult<T["model"] & string>>;
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** The bundled model profile table `chat()` validates against by default. */
export { chatProfiles };
export type { ChatCatalog, ChatModelProfile };

export { CHAT_PROVIDERS, classifyModelRef, classifyRef, dialectOf, parseModelRef, refProblemMessage } from "./refs";
export type { ModelRef, RefClassification, RefProblem } from "./refs";

export { CHAT_CONSTRAINT_ENDPOINTS, chatConstraintsFor } from "./constraints";

export { chatParamsSchema } from "./schema";

export type { ChatOptions };
export { CHAT_ENDPOINT } from "./validate";

export type {
  ChatCache,
  ChatFilePart,
  ChatMessage,
  ChatModelRef,
  ChatNativeTool,
  ChatParams,
  ChatProviderId,
  ChatReasoning,
  ChatReasoningEffort,
  ChatReasoningPart,
  ChatResponseFormat,
  ChatTextPart,
  ChatToolCallPart,
  ChatToolChoice,
  ChatToolResultPart,
  ChatToolSpec,
} from "./types";
