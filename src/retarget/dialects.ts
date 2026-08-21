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
import type { MessagesBody } from "../providers/anthropic/wire";
import type { GenerateContentBody } from "../providers/google/wire";
import type { ChatCompletionsBodyBase } from "../providers/openai-compatible/wire";

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
