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
 * The auth header moves with the URL, and it is the one thing `req` cannot
 * carry for you: that same request now wants `authorization: Bearer …`, not
 * `x-api-key`. {@link CHAT_AUTH} is the lookup — `CHAT_AUTH[provider]` gives
 * the header name and the scheme word, keyed the same way the ref is.
 *
 * ## What this entry is, relative to the provider subpaths
 *
 * `unmodel/anthropic`'s `chat()` mirrors `/v1/messages` exactly — `max_tokens`,
 * `cache_control`, the lot — because a validator that renamed things would be
 * lying about the request it validates. This entry adds only canonical
 * authoring and compilation: the emitted body is handed to that same concrete
 * provider validator, and its ordinary `Validated` result is returned.
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
import type { ChatCatalog, ChatModelProfile } from "../catalog/chat-profiles.gen";
import { chatProfiles } from "../catalog/chat-profiles.gen";
import { createChat, type ChatPackResult, type ChatValidator } from "./factory";
import { CHAT_PROVIDER_VALIDATORS, type ChatProviderValidatorRegistry } from "./providers";

/**
 * What `chat()` returns: the concrete target provider's own result, plus the
 * unified compiler's `target`, `modelId` and loss `warnings` metadata.
 *
 * Known provider refs derive this type directly from the validator registry,
 * so provider-specific fields and SDK/API targets cannot drift from the
 * substrate. The fallback exists only for an unresolvable dynamic ref, which
 * fails structurally at runtime but still needs a useful static type.
 */
export type ChatResult<R extends string> = ChatPackResult<
  typeof CHAT_PROVIDER_VALIDATORS,
  R
>;

// ---------------------------------------------------------------------------
// The ready-made validator
// ---------------------------------------------------------------------------

/**
 * Validates a request in unmodel's unified chat vocabulary and compiles it to
 * the wire body of whichever provider `model` names.
 *
 * The canonical shape is checked before compilation. The compiled wire body
 * then terminates in the selected provider's own validator, which supplies its
 * schema, catalog, constraints, capability/media checks, estimate, request
 * metadata and SDK/API targets.
 *
 * Throws `UnmodelValidationError` with every error issue aggregated, and
 * `TranslationUnavailableError` when the ref names a provider this entry
 * structurally cannot serve (cohere's fifth dialect, the factory-configured
 * providers, amazon-bedrock, a typo). Warnings never throw — they ride on the
 * result. `chat.safe()` returns a `ValidateResult` and throws neither.
 *
 * Annotated rather than inferred. `createChat` is `<const Registry>`, so
 * without the alias `const`-inference bakes the entire 32-entry registry
 * object type into the emitted declaration a *second* time — the same 438 KiB
 * expansion that already has to appear once for `CHAT_PROVIDER_VALIDATORS`
 * itself. The alias references it instead: same type, half the file.
 */
export const chat: ChatValidator<ChatProviderValidatorRegistry> =
  createChat(CHAT_PROVIDER_VALIDATORS);

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Legacy slim profile snapshot retained for discovery; provider validators are authoritative. */
export { chatProfiles };
export type { ChatCatalog, ChatModelProfile };

export type {
  ChatBody,
  ChatDialect,
  ChatDialectOf,
  ChatGeminiSdkParams,
  ChatModelOf,
  ChatProviderOf,
  ChatResultMeta,
  ChatSdkTargets,
} from "./public-types";

export { CHAT_AUTH, CHAT_PROVIDERS, classifyModelRef, classifyRef, dialectOf, parseModelRef, refProblemMessage } from "./refs";
export type {
  EndpointAuth,
  FactoryChatProviderId,
  ModelRef,
  NoCodecChatProviderId,
  RefClassification,
  RefProblem,
  RefProblemKindOf,
} from "./refs";

export { chatParamsSchema } from "./schema";

/**
 * `createChat` is deliberately **not** re-exported here as a value.
 *
 * It lives at `unmodel/chat/factory`, an entry that carries the canonical
 * compiler and three codecs and nothing else (135 KiB). Reaching the same
 * function through this entry costs ~1.7 MB of JS and 45 extra declaration
 * files, because `chat` above is a top-level call that anchors the whole
 * 32-provider registry into the module — no bundler tree-shakes that away.
 * The cheap path is the only path; the types are free, so they stay.
 */
export type {
  ChatPackResult,
  ChatProviderRegistry,
  ChatProviderResult,
  ChatProviderValidator,
  ChatValidator,
  UnregisteredChatProvider,
  UnservableChatReason,
} from "./factory";

export type { ChatOptions } from "./validate";
export { CHAT_ENDPOINT } from "./validate";

export type {
  ChatCache,
  ChatFilePart,
  ChatMediaDetail,
  ChatMessage,
  ChatModelRef,
  ChatNativeTool,
  ChatParams,
  ChatProviderId,
  ChatProviderOptions,
  ChatReasoning,
  ChatReasoningEffort,
  ChatReasoningPart,
  ChatResponseFormat,
  ChatServiceTier,
  ChatServiceTierFor,
  ChatTextPart,
  ChatToolCallPart,
  ChatToolChoice,
  ChatToolResultPart,
  ChatToolSpec,
} from "./types";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../core/carriers";
