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
 * `import type { ChatParams } from "unmodel/chat"` costs zero bytes, and the
 * only import is a type-only one from a type-only generated file.
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
  serviceTier?: string;
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
   */
  providerOptions?: Partial<Record<ChatProviderId | (string & {}), Record<string, unknown>>>;
}
