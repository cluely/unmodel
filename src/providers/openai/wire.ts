import type { ChatCompletionsBodyBase, ChatTextPart } from "../openai-compatible/wire";

// ---------------------------------------------------------------------------
// Wire leaf for POST https://api.openai.com/v1/chat/completions: the wire
// types, and nothing else. Unlike its four siblings this leaf carries no zod
// at all — the shared dialect's schema factory lives in
// ../openai-compatible/wire.ts and OpenAI's own extras are composed onto it in
// ./chat.ts, which is where the checks, the estimator and `createValidator`
// stay. What moved here is exactly the shape.
//
// It moved because something outside this directory needs to name it.
// `ChatProviderOptions`' openai bucket (src/chat/types.ts) used to be typed
// off the shared `ChatCompletionsBodyBase`, which by design excludes the
// twelve params only OpenAI's endpoint takes — so `providerOptions.openai`
// completed none of them and checked none of them, while `openai.chat`'s own
// schema typed, enumerated and validated all twelve. The bucket now reads the
// endpoint body through `src/retarget/dialects.ts`, and the import-graph rule
// that lets it (a wire leaf, type-only) is the same one `anthropic/wire.ts`
// and `google/wire.ts` already satisfy.
//
// AND IT IMPORTS NO CATALOG, unlike `anthropic/wire.ts` and `google/wire.ts`.
// The body is generic in its model id ({@link ChatCompletionsBodyOf}) and
// `./chat.ts` supplies `OpenaiChatModelId`, because `dialects.ts` is a hub:
// every provider's `types.ts` entry reaches its chunk, so a type-only
// `catalog/openai.gen` import here put 80 KiB of literal model ids into
// FIFTY-SEVEN declaration graphs — measured at +43 KiB per types entry, for a
// field (`model`) the one consumer `Omit`s away. The generic parameter costs a
// line and is the whole difference.
// ---------------------------------------------------------------------------

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
 * The common dialect plus OpenAI-only params, with OpenAI's exact enum unions
 * where the dialect leaves the string open (reasoning_effort, service_tier).
 *
 * Generic in the model id so this module stays catalog-free — see the header.
 * `ChatCompletionsBody` in ./chat.ts is this at `OpenaiChatModelId`, and that
 * is the name the public surface uses.
 */
export interface ChatCompletionsBodyOf<M extends string>
  extends Omit<ChatCompletionsBodyBase, "model" | "reasoning_effort" | "service_tier"> {
  model: M | (string & {});
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
  /**
   * "Constrains the verbosity of the model's response. Lower values will
   * result in more concise responses, while higher values will result in more
   * verbose responses." `low | medium | high`, default `medium`, re-verified
   * 2026-08-26 against
   * https://developers.openai.com/api/docs/api-reference/chat/create.
   *
   * Deliberately NOT promoted to `ChatParams`: a single witness. OpenRouter's
   * chat reference documents no equivalent, Gemini has none, and Anthropic's
   * `output_config.effort` is *effort*, which `ChatReasoning` already carries.
   * It is reachable, typed and enumerated at
   * `providerOptions.openai.verbosity` — see the JSDoc on
   * `ChatParams.providerOptions`, which names it as the canonical example of a
   * genuinely one-off param that is nonetheless typed.
   */
  verbosity?: "low" | "medium" | "high" | null;
  web_search_options?: ChatWebSearchOptions;
}
