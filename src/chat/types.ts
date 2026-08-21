/**
 * The **standardized chat vocabulary** — one camelCase, AI-SDK-flavoured
 * request shape that compiles to any of the four wire dialects.
 *
 * unmodel's per-provider validators exist because they mirror a wire format
 * *exactly*: `unmodel/anthropic`'s `chat()` takes `max_tokens` and
 * `cache_control` because that is what Anthropic's `/v1/messages` takes, and a
 * validator that renamed things would be lying about the request it validates.
 * That is the right default and it is not going away.
 *
 * `unmodel/chat` is the other half of the trade: **one** vocabulary, and the
 * compiler emits whichever wire body the model ref names. It buys portability
 * at the cost of the exactness the provider subpaths keep — a param that only
 * one dialect has is either absent here or rides in `providerOptions`.
 *
 * Everything in this module is a type. **It imports nothing at runtime**, so
 * `import type { ChatParams } from "unmodel/chat"` costs zero bytes. Its three
 * imports are all type-only: the generated ref tables, this directory's own
 * `public-types`, and `retarget/dialects` — the shared dialect→body map, which
 * is how `serviceTier` and the `providerOptions` buckets state their
 * vocabularies in terms of the very bodies the compiler emits instead of
 * re-typing them here. (`retarget/dialects` is hand-written, not generated;
 * the import-graph amendment allows it type-only for exactly this reason.)
 *
 * ## The vocabulary decisions worth stating
 *
 * - **camelCase throughout, AI SDK spellings where one exists.** Three of the
 *   four dialects disagree about the same concept's name
 *   (`max_completion_tokens` / `max_tokens` / `generationConfig.maxOutputTokens`),
 *   so *some* name has to win; picking the one most TypeScript users already
 *   have muscle memory for is free.
 * - **`temperature` is canonical 0–2.** Anthropic's range is 0–1 and OpenAI's
 *   and Gemini's is 0–2, so a unified `temperature` has to declare a scale or
 *   mean nothing. It declares 2, which is why the encoder always stamps
 *   `IRSettings.temperatureMax = 2`: the IR carries the *source's* scale, and
 *   this vocabulary is the source. Targeting Anthropic then clamps 1.4 → 1
 *   with an `approximated_param` warning rather than silently rescaling it.
 * - **`cache` mirrors the IR's breakpoints, not any one provider's.** A
 *   breakpoint marks "everything up to here is reusable prefix", which is
 *   Anthropic's `cache_control`, Bedrock's `cachePoint` and OpenAI's
 *   `prompt_cache_breakpoint`. `true` means the default 5-minute ephemeral
 *   breakpoint; the object form exists only because Anthropic can also say
 *   `1h`.
 * - **`tools` is a `Record`, not an array.** Two tools with the same name is
 *   an error on every provider, and a `Record` makes that state
 *   unrepresentable instead of detectable. The key *is* the tool name, so
 *   there is no name field to get out of sync with it either.
 * - **`model` splits on the FIRST slash.** openrouter's own model ids contain
 *   slashes (`"anthropic/claude-opus-5"`), so `"openrouter/anthropic/claude-opus-5"`
 *   is provider `openrouter`, model `anthropic/claude-opus-5`. Splitting on
 *   the last slash — the obvious implementation — silently routes that
 *   request to a provider called `openrouter/anthropic`.
 * - **`(string & {})` escape hatches everywhere a generated union appears.**
 *   models.dev is a snapshot; a model released after it still has to be
 *   callable. The union drives autocomplete, it does not gate the API.
 */
import type { ChatModelRef, ChatProviderId } from "../catalog/chat-refs.gen";
import type { DialectBody } from "../retarget/dialects";
import type { ChatDialect } from "./public-types";

export type { ChatModelRef, ChatProviderId };

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/**
 * A prompt-cache breakpoint: "everything before this point is a reusable
 * prefix". `true` is the common case and means the provider default (a 5
 * minute ephemeral breakpoint); the object form exists because Anthropic is
 * the one dialect that also offers `1h`.
 *
 * Targets that cannot express a breakpoint at all (Gemini caches through a
 * separate `cachedContent` call) drop it with a named warning — the request
 * still works, it is simply not cached at that point.
 */
export type ChatCache = boolean | { ttl?: "5m" | "1h" };

export interface ChatTextPart {
  type: "text";
  text: string;
  cache?: ChatCache;
}

/**
 * Any non-text attachment: an image, a PDF, an audio clip.
 *
 * `data` is deliberately one field with three readings, because that is what
 * every dialect actually accepts and splitting it into three optional fields
 * would make "exactly one of these" unrepresentable-by-convention rather than
 * by construction:
 *
 * - a `data:` URL — the media type comes from the URL and `mediaType` is
 *   redundant;
 * - an `http(s)` URL — a public asset the *provider* fetches, so the bytes
 *   never touch this process;
 * - a bare base64 string — then `mediaType` is required, because no dialect
 *   accepts bytes without a declared type and inventing one is how you get a
 *   400 that reads like a content-policy refusal;
 * - `{ fileId, provider }` — a handle minted by a provider's Files API.
 *   File-id namespaces are per-provider and never portable, which is exactly
 *   why the provider is recorded alongside the id: compiling for a *different*
 *   provider then drops it with a warning instead of emitting a dead handle.
 */
export interface ChatFilePart {
  type: "file";
  /** IANA MIME type. Required with bare base64, redundant with a `data:` URL. */
  mediaType?: string;
  data: string | { fileId: string; provider: string };
  filename?: string;
  cache?: ChatCache;
}

/**
 * An assistant turn's tool call, replayed back as conversation history.
 *
 * `toolCallId` is mandatory even though Gemini's wire format has no id field:
 * every *other* dialect pairs a result to its call by id, so a vocabulary
 * without one cannot express a multi-tool turn at all. The Gemini codec
 * synthesizes and strips ids on its own.
 */
export interface ChatToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
  cache?: ChatCache;
}

/**
 * A previous assistant turn's chain of thought, replayed.
 *
 * `signature` is not decoration: Anthropic verifies it on every `thinking`
 * block and rejects the request without it, so a reasoning block that carries
 * no signature cannot be sent back to Anthropic at all. `redacted` is the
 * encrypted form Anthropic returns when it withholds the text.
 */
export interface ChatReasoningPart {
  type: "reasoning";
  text?: string;
  signature?: string;
  redacted?: string;
}

/**
 * A tool's result. The output union mirrors the AI SDK's 1:1 — and therefore
 * `IRToolOutput` — rather than any wire format, because the wire formats
 * disagree completely (Anthropic takes blocks, OpenAI takes a string, Gemini
 * takes a JSON object) and the SDK shape is the only one that can express all
 * three without loss.
 *
 * `error-text` is a distinct arm rather than an `isError` flag so a failed
 * result cannot be spelled two ways.
 */
export interface ChatToolResultPart {
  type: "tool-result";
  toolCallId: string;
  /**
   * Optional because OpenAI's `tool` message carries only the id — the name is
   * recovered from the call it answers. Supply it when you have it: Gemini's
   * `functionResponse.name` is required and there is nothing to recover it
   * from if the matching call is not in the same request.
   */
  toolName?: string;
  output:
    | { type: "text"; value: string }
    | { type: "json"; value: unknown }
    | { type: "error-text"; value: string }
    | {
        type: "content";
        value: Array<{ type: "text"; text: string } | { type: "media"; data: string; mediaType: string }>;
      };
}

/**
 * A conversation turn.
 *
 * Four roles, mapped down to the IR's two (`user` / `assistant`) by the
 * encoder: `system` messages fold into the standalone system prompt every
 * dialect keeps out of the turn list, and `tool` messages become tool-result
 * parts on a user turn (the Anthropic/Bedrock shape, which the OpenAI codec
 * splits back out). Both are allowed here because both are how people
 * actually write conversation history.
 */
export type ChatMessage =
  | { role: "system"; content: string; cache?: ChatCache }
  | { role: "user"; content: string | Array<ChatTextPart | ChatFilePart> }
  | { role: "assistant"; content: string | Array<ChatTextPart | ChatToolCallPart | ChatReasoningPart> }
  | { role: "tool"; content: ChatToolResultPart[] };

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * One function tool. The name is the `tools` record's key, not a field here —
 * see `ChatParams.tools`.
 *
 * `inputSchema` is plain JSON Schema because that is the one tool
 * representation all four dialects and the AI SDK share. Pass
 * `z.toJSONSchema(schema)` if you author with zod.
 */
export interface ChatToolSpec {
  description?: string;
  inputSchema: Record<string, unknown>;
  /** OpenAI/Anthropic structured-tool-call enforcement. Gemini always enforces. */
  strict?: boolean;
  cache?: ChatCache;
}

export type ChatToolChoice = "auto" | "none" | "required" | { type: "tool"; toolName: string };

/**
 * A provider-defined tool — Anthropic's `web_search_20250305`, Gemini's
 * `googleSearch` / `codeExecution`, OpenAI's `custom` grammar tools.
 *
 * These never cross dialects, so `definition` is passed through verbatim under
 * the provider that owns it and every other target drops it with a
 * `dropped_tool` warning that names the tool. Recording the provider is what
 * makes that warning nameable instead of "an unknown object was discarded".
 */
export interface ChatNativeTool {
  provider: string;
  definition: unknown;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The union of every dialect's effort vocabulary, not the intersection.
 *
 * OpenAI accepts `minimal|low|medium|high`, Anthropic `low|medium|high|xhigh|max`,
 * Gemini `MINIMAL|LOW|MEDIUM|HIGH`. Taking the intersection (`low|medium|high`)
 * would make `xhigh` unsayable to the one provider that has it; taking the
 * union means the compiler narrows to the target's nearest level and warns
 * `approximated_param` when it has to. Losing precision loudly beats not being
 * able to ask.
 */
export type ChatReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * How hard the model should think.
 *
 * Two families, because the providers genuinely have two: a *budget* in tokens
 * (Anthropic's `thinking.budget_tokens`, Gemini's `thinkingBudget`) and an
 * *effort* bucket (OpenAI's `reasoning_effort`, Gemini's `thinkingLevel`,
 * Anthropic's `output_config.effort`). Giving both — `{ effort, budgetTokens }`
 * — is legal and means "budget where budgets exist, effort where they do not";
 * it is the only way to write one request that reasons well everywhere.
 *
 * `false` and `"off"` are the same thing and both are accepted, because half
 * the ecosystem spells "no thinking" each way.
 */
export type ChatReasoning =
  | ChatReasoningEffort
  | "off"
  | false
  | { effort: ChatReasoningEffort; budgetTokens?: number }
  | { budgetTokens: number };

/**
 * `{ type: "json" }` is JSON mode without a schema. Anthropic has no such
 * thing (its structured outputs require a schema), so that arm is the one
 * response format that does not survive to every target — prefer
 * `json-schema` if you care about portability.
 */
export type ChatResponseFormat =
  | { type: "text" }
  | { type: "json" }
  | { type: "json-schema"; name?: string; schema: Record<string, unknown>; strict?: boolean };

/**
 * OpenAI's six service tiers.
 *
 * Hand-written rather than derived, and deliberately so: the shared
 * `openai-chat` wire type leaves `service_tier` a bare `string` because ~30
 * providers reuse that body and most define their own tiers, so the closed list
 * lives on the endpoint that owns it — `ChatCompletionsBody.service_tier` in
 * `src/providers/openai/chat.ts`, which `src/chat/**` may not import (the
 * import-graph amendment allows only `retarget/dialects.ts` and the three
 * codecs). A test may import both, so `test/chat/provider-options.test.ts`
 * asserts this union equals that field's in both directions — a copy with a
 * drift guard, rather than a copy.
 */
type OpenAiChatServiceTier = "auto" | "default" | "flex" | "scale" | "priority" | "fast";

/**
 * One dialect's service-tier vocabulary, read off that dialect's own wire body
 * wherever the wire body states it: `anthropic-messages` closes it to
 * `auto | standard_only`, and `gemini` to the four its own body names. Those
 * two arms are read through `DialectBody`, so they cannot drift from the wire
 * types the compiler emits.
 */
export type ChatServiceTierFor<D extends ChatDialect> = D extends "anthropic-messages"
  ? NonNullable<DialectBody<"anthropic-messages", string>["service_tier"]>
  : D extends "gemini"
    ? NonNullable<DialectBody<"gemini", string>["serviceTier"]>
    : OpenAiChatServiceTier;

/**
 * The union of every dialect's tier vocabulary, not the intersection — the same
 * rule {@link ChatReasoningEffort} states, and for the same reason: taking the
 * intersection would make `standard_only` unsayable to the one provider that
 * has it.
 *
 * The tail stays, and stays on purpose. Both non-OpenAI codecs *drop* an
 * off-vocabulary tier with a named warning rather than refusing the call
 * (`dropped_param`, severity warning), so gating here would refuse a value the
 * library itself only warns about — and a tier that ships between releases
 * would become unsayable. The union drives autocomplete; it does not gate.
 */
export type ChatServiceTier = ChatServiceTierFor<ChatDialect> | (string & {});

/**
 * The wire dialect whose body a `providerOptions` bucket is merged into.
 * Mirrors `ChatDialectOf`'s provider→dialect mapping, one level up.
 */
type BucketDialect<P> = P extends "anthropic"
  ? "anthropic-messages"
  : P extends "google"
    ? "gemini"
    : "openai-chat";

/**
 * A deep partial that keeps a `string` tail at every level.
 *
 * Two escape hatches have to survive, because they are what `providerOptions`
 * is *for*: an unknown KEY at any depth (`{ google: { generationConfig: {
 * brandNewKnob: 1 } } }`), which the `Record<string, unknown>` arm carries, and
 * an unknown VALUE inside an already-closed union (`service_tier: "priority"`
 * on a body whose enum predates it), which the leaf arm carries. Without the
 * leaf arm this type would contradict the `(string & {})` convention stated in
 * this module's own header — the wire enums are snapshots too.
 */
type Openable<T> = T extends readonly (infer E)[]
  ? ReadonlyArray<Openable<E>> | Array<Openable<E>>
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { [K in keyof T]?: Openable<T[K]> } & Record<string, unknown>
      : string extends T
        ? T
        : T extends string
          ? T | (string & {})
          : T;

/**
 * One provider's bucket: that provider's dialect body, minus the two fields the
 * compiler owns outright.
 */
type ChatProviderBucket<P> = Openable<Omit<DialectBody<BucketDialect<P>, string>, "model" | "messages">>;

/**
 * Providers unmodel knows and whose buckets the runtime tolerates, but which
 * `unmodel/chat` cannot send to (see `./refs`). Their buckets are inert and
 * silent — which is the point of the field: one request object carries tuned
 * settings for several providers and stays portable — so they are typed as
 * open bags rather than dropped. `test/chat/provider-options.test.ts` pins this
 * set against the runtime's tolerated set in both directions.
 */
type InertChatProviderId =
  | "amazon-bedrock"
  | "azure"
  | "cloudflare-workers-ai"
  | "cohere"
  | "google-vertex";

/**
 * The per-provider escape hatch, keyed to the providers the runtime actually
 * honours and valued by each provider's own dialect body.
 *
 * The key half closes a real hole: `Record<ChatProviderId | (string & {}), …>`
 * collapses to `[x: string]: …` in key position, which switches excess-property
 * checking off entirely — so `{ opneai: { store: true } }` type-checked, and at
 * runtime `encode.ts` makes a bucket keyed to a real-but-wrong provider
 * silently inert. A settings override that never happens, invisible in a diff
 * and invisible at runtime. The media packs already close exactly this hole
 * (`UnifiedProviderOptions`); chat was the outlier.
 *
 * The value half is a deliberate reversal of "the surface has no opinion about
 * wire params": these buckets are not foreign objects, they are *this library's
 * own* dialect bodies, merged verbatim into a body it compiled itself. One
 * consequence worth stating rather than discovering: about half the keys that
 * now complete on a bucket (`max_tokens`, `temperature`, `top_p`, `tools`, …)
 * are non-portable wire duplicates of fields this vocabulary already owns
 * portably. Overriding them is supported (the kernel warns when a bucket
 * shadows a compiled field), but the portable field is nearly always the right
 * answer.
 */
export type ChatProviderOptions = {
  [P in ChatProviderId]?: ChatProviderBucket<P>;
} & {
  [P in InertChatProviderId]?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface ChatParams {
  /**
   * `"provider/model"`, split on the **first** slash — `"openai/gpt-5"`,
   * `"openrouter/anthropic/claude-opus-5"`. The provider half decides which
   * wire body gets compiled and which URL it is posted to.
   */
  model: ChatModelRef | (string & {});
  messages: ChatMessage[];
  /**
   * The system prompt. The array form exists only so a cache breakpoint can
   * be placed *inside* a long system prompt, which is the single most
   * valuable place to put one.
   *
   * Supplying both this and `role: "system"` messages is legal: this comes
   * first, then the folded-out messages in order. Every dialect keeps system
   * text in one leading slot, so there is nowhere else for them to go.
   */
  system?: string | Array<{ text: string; cache?: ChatCache }>;
  maxOutputTokens?: number;
  /** Canonical 0–2. Clamped, never rescaled, when the target's ceiling is 1. */
  temperature?: number;
  topP?: number;
  /** Dropped with a warning when targeting `openai-chat`, which has no `top_k`. */
  topK?: number;
  stopSequences?: string[];
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  /** OpenAI `n` / Gemini `candidateCount`. Anthropic returns exactly one. */
  candidates?: number;
  reasoning?: ChatReasoning;
  responseFormat?: ChatResponseFormat;
  /** Tool name → spec. A `Record` makes duplicate names unrepresentable. */
  tools?: Record<string, ChatToolSpec>;
  nativeTools?: ChatNativeTool[];
  toolChoice?: ChatToolChoice;
  parallelToolCalls?: boolean;
  /** End-user attribution: OpenAI `user`, Anthropic `metadata.user_id`. */
  user?: string;
  /**
   * OpenAI `service_tier`, Anthropic `service_tier`, Gemini `serviceTier`. A
   * tier the target dialect does not know is dropped with a named warning.
   */
  serviceTier?: ChatServiceTier;
  /**
   * Gemini has no streaming *flag* — it has a different method
   * (`:streamGenerateContent`), so `stream: true` there changes the URL rather
   * than the body. The compiler handles that; you write `stream: true` either
   * way.
   */
  stream?: boolean;
  /**
   * Per-provider escape hatch, keyed by provider id. The bucket matching the
   * provider in `model` is merged into that provider's wire body **verbatim**;
   * every other bucket is inert, so one request object can carry tuned
   * settings for several providers and stay portable.
   *
   * This is where anything genuinely one-off goes — OpenAI's `store`,
   * openrouter's `provider` routing block, Gemini's `generationConfig`
   * extensions (which nest exactly as they do on the wire).
   *
   * A bucket is typed as its provider's **dialect** body, which is what the
   * compiler merges it into — so the shared `openai-chat` params complete, and
   * endpoint-only extras like OpenAI's own `store` or openrouter's `provider`
   * do not, because they live on those providers' own body types. They still
   * compile: every level of a bucket keeps an open arm, for exactly this and
   * for a wire enum that grows between releases.
   */
  providerOptions?: ChatProviderOptions;
}
