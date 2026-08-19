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
 * id is on `.request.url`, exactly as `google.generateContent`'s own result
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
 * The SDK targets a retargeted result offers.
 *
 * `anthropic` and `openai` are identity formatters — those SDKs' param objects
 * *are* the wire body. `google` is a real shaping (`{ model, contents, config }`),
 * supplied by `core/translate/sdk-shapes.ts`, which is the same function
 * `google.generateContent`'s own `toSdk("google")` uses.
 *
 * `bedrock-converse` maps to `never` on purpose: nothing in v1 can retarget
 * *into* it (amazon-bedrock is factory-configured and outside the one-argument
 * `.toApi` union), and a `toSdk` target that exists but produces the wrong
 * shape is worse than one that does not exist. `"ai-sdk"` joins every arm once
 * the retarget engine carries an encoder for the target dialect too.
 */
export type DialectSdkTargets<D> = D extends "anthropic-messages"
  ? "anthropic"
  : D extends "openai-chat"
    ? "openai"
    : D extends "gemini"
      ? "google"
      : never;

/** The dialect ids, re-exported so consumers need only one import. */
export type { DialectId };
