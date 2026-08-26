/**
 * Provider → dialect, and dialect → body shape.
 *
 * The simplification that keeps the whole feature's type surface small: there
 * are ~4 chat wire dialects but ~30 `.toApi` destinations, so `.toApi`'s
 * return type is keyed by **dialect**, not by provider. It is also what keeps
 * the module graph acyclic — this file reaches provider directories only
 * through their `wire.ts` leaves (type-only), never a validator or an
 * `index.ts`. Enforced by `test/import-graph.test.ts`.
 */
import type { DialectId } from "../core/translate/endpoints";
import type { GeminiSdkConfigKey } from "../core/translate/sdk-shapes";
import type { MessagesBody, ServerTool } from "../providers/anthropic/wire";
import type { GenerateContentBody, GoogleTool } from "../providers/google/wire";
import type { ChatCompletionsBodyBase, ChatCustomTool } from "../providers/openai-compatible/wire";
import type { ChatCompletionsBodyOf } from "../providers/openai/wire";

/**
 * The wire dialect a `.toApi` destination speaks. `google-vertex` also serves
 * an OpenAI-compatible MaaS surface, which the generated availability data
 * points at explicitly via its `endpoint` field; this type gives the
 * provider's *default* surface, which is all the v1 (static-target) union
 * needs.
 */
export type DialectOf<P> = P extends "anthropic"
  ? "anthropic-messages"
  : P extends "google" | "google-vertex"
    ? "gemini"
    : P extends "amazon-bedrock"
      ? "bedrock-converse"
      : "openai-chat";

/** `MessagesBody` with `model` pinned to the target's spelling. */
export type MessagesBodyFor<M extends string> = Omit<MessagesBody, "model"> & {
  model: M | (string & {});
};

/**
 * `GenerateContentBody` **without** `model` — Gemini puts the model id in the
 * URL path (`models/{model}:generateContent`), so a body carrying it would
 * break the "enumerable properties are exactly the wire body" invariant. The
 * id is on `.request.url`, exactly as `google.chat`'s own result
 * has it.
 */
export type GenerateContentBodyFor<_M extends string> = Omit<GenerateContentBody, "model">;

export type DialectBody<D, M extends string> = D extends "openai-chat"
  ? ChatCompletionsBodyBase<M>
  : D extends "anthropic-messages"
    ? MessagesBodyFor<M>
    : D extends "gemini"
      ? GenerateContentBodyFor<M>
      : never;

/**
 * OpenAI's own `/v1/chat/completions` body — the ENDPOINT body, not the
 * dialect base.
 *
 * `DialectBody<"openai-chat", M>` is deliberately the *shared* body: ~30
 * providers speak this dialect and most of them serve none of OpenAI's own
 * extras, so the dialect base is where `.toApi` has to key. But one consumer
 * genuinely wants the endpoint: `providerOptions.openai` is merged into a body
 * `openai.chat` compiled and `openai.chat` validates, so the bucket that names
 * it should complete and check what that endpoint declares. Re-exported from
 * here rather than imported directly because `src/chat/**` may name exactly
 * one module outside core and its own directory, and this is it (amendment A1,
 * test/import-graph.test.ts).
 *
 * `model` is left open on purpose. The one consumer `Omit`s it (the compiler
 * owns the model), and closing it to `OpenaiChatModelId` would make this
 * hub's chunk carry `catalog/openai.gen` — 80 KiB of literal ids in the
 * declaration graph of every provider's `types.ts` entry, measured at +43 KiB
 * each across fifty-seven of them.
 */
export type OpenAiChatBody = ChatCompletionsBodyOf<string>;

/**
 * The params OpenAI's endpoint adds over the shared dialect — `audio`,
 * `metadata`, `modalities`, `moderation`, `prediction`, the three
 * `prompt_cache_*`, `safety_identifier`, `store`, `verbosity` and
 * `web_search_options`.
 *
 * Derived rather than listed, so it cannot drift from either body. The
 * distinction matters to `ChatProviderOptions`: the shared half keeps the
 * escape hatch that lets a value ship ahead of a wire enum (`service_tier` and
 * `reasoning_effort` are open `string`s in the base for exactly that reason,
 * and ~30 providers narrow them differently), while every param in THIS set is
 * one OpenAI alone defines and `openai.chat`'s own schema enumerates — so its
 * declared vocabulary is the vocabulary, and a value outside it is an
 * `invalid_shape` error at validate time today.
 */
export type OpenAiOnlyChatParam = Exclude<keyof OpenAiChatBody, keyof ChatCompletionsBodyBase>;

/**
 * A **provider-defined** tool as one dialect spells it — the shape that goes
 * into `tools[]` verbatim, with no unmodel translation at any point.
 *
 * Each arm is as tight as the dialect genuinely is, and no tighter:
 *
 * - `gemini` — `GoogleTool` minus `functionDeclarations` (that half is what
 *   `ChatParams.tools` compiles to, so filing it here would be two ways to say
 *   one thing). The remaining eight keys are a genuinely closed, documented
 *   vocabulary that today's `unknown` makes invisible. `& Record<string,
 *   unknown>` keeps a grounding tool shipped after this snapshot compiling.
 * - `anthropic-messages` — `ServerTool`, which is `{ type, name }` plus an
 *   index signature. Permissive enough never to refuse a future server tool,
 *   strict enough to catch a *misfiled* one (a Gemini `{ googleSearch: {} }`
 *   has neither key).
 * - `openai-chat` — the 30-odd providers on this dialect ship built-ins
 *   unmodel does not model (`{ type: "browser_search" }`, `{ type: "web", web:
 *   { … } }`, …) and `interop.ts` forwards them untouched, so the arm must be
 *   open **on shape**: OpenAI's own `custom` grammar tool, or anything that at
 *   least names a `type`. Requiring `ChatCustomTool` alone would turn the
 *   escape hatch into a wall for every provider except OpenAI.
 *
 * `bedrock-converse` resolves to `never`: chat has no codec for it in v1, so a
 * tool filed there could only ever be discarded.
 */
export type DialectNativeTool<D> = D extends "anthropic-messages"
  ? ServerTool
  : D extends "gemini"
    ? Omit<GoogleTool, "functionDeclarations"> & Record<string, unknown>
    : D extends "openai-chat"
      ? ChatCustomTool | ({ type: string } & Record<string, unknown>)
      : never;

/**
 * `@google/genai`'s `ai.models.generateContent({ model, contents, config })`
 * params — the shape `geminiSdkParams` (`core/translate/sdk-shapes.ts`) builds
 * at runtime, stated as a type.
 *
 * `config` is the wire body's `generationConfig` flattened to the top level,
 * plus the keys that module's `CONFIG_KEYS` lifts unchanged — read back off
 * that same constant via {@link GeminiSdkConfigKey}, so the declared shape and
 * the runtime shaping cannot drift. Every lifted key is optional on the wire
 * body and stays optional here, matching the runtime, which omits `config`
 * entirely when nothing was set. `store` is absent on purpose: `@google/genai`
 * has no config equivalent, which `wire.ts` records at the field itself.
 */
export interface GeminiSdkParams<M extends string = string> {
  model: M | (string & {});
  contents: GenerateContentBody["contents"];
  config?: Partial<NonNullable<GenerateContentBody["generationConfig"]>> &
    Pick<GenerateContentBody, GeminiSdkConfigKey>;
}

/**
 * Every SDK target a dialect offers, mapped to the params object that target's
 * SDK actually takes.
 *
 * This map is the single source: {@link DialectSdkTargets} is its `keyof` and
 * `Retargeted.toSdk` indexes it **by the target the caller passed**, not by the
 * dialect. That distinction is load-bearing rather than stylistic. The map is
 * 1:1 today, but `"ai-sdk"` joins every arm once the retarget engine carries an
 * encoder for the target dialect too — and a dialect-keyed result would then
 * quietly claim `toSdk("ai-sdk")` returns a `MessagesBodyFor<M>`. Keying on the
 * target makes adding one a compile error until its shape is declared here: a
 * target whose declared shape is a lie is worse than one that does not exist.
 *
 * `anthropic` and `openai` are identity formatters — those SDKs' param objects
 * *are* the wire body, so both arms name `DialectBody` rather than restating a
 * shape. `google` is a real reshaping, supplied by the same function
 * `google.chat`'s own `toSdk("google")` uses.
 *
 * `bedrock-converse` maps to no targets at all, on purpose: nothing in v1 can
 * retarget *into* it (amazon-bedrock is factory-configured and outside the
 * one-argument `.toApi` union).
 */
export type DialectSdkMap<D, M extends string> = D extends "anthropic-messages"
  ? { anthropic: DialectBody<"anthropic-messages", M> }
  : D extends "openai-chat"
    ? { openai: DialectBody<"openai-chat", M> }
    : D extends "gemini"
      ? { google: GeminiSdkParams<M> }
      : Record<never, never>;

/** The SDK targets a retargeted result offers — the keys of {@link DialectSdkMap}. */
export type DialectSdkTargets<D> = Extract<keyof DialectSdkMap<D, string>, string>;

/** What `.toSdk(target)` hands back, keyed on the *target*. */
export type DialectSdkResult<D, M extends string, K extends PropertyKey> = K extends keyof DialectSdkMap<D, M>
  ? DialectSdkMap<D, M>[K]
  : never;

/** The dialect ids, re-exported so consumers need only one import. */
export type { DialectId };
