/**
 * Type-level tests for `unmodel/chat`. Not executed by `bun test` (the
 * filename avoids the `*.test.*` pattern); type-checked by `bun run check`.
 *
 * The claim being tested is the interesting half of the feature: **one function
 * whose return type is decided by a string literal**. `chat({ model:
 * "anthropic/…" })` has to be typed as an Anthropic body, `"google/…"` as a
 * Gemini body with no `model` key, and everything else as chat-completions —
 * from nothing but the ref, split on the first slash exactly as the runtime
 * splits it.
 *
 * The three official SDK packages are devDependencies used only in this
 * directory; `src/` never imports them (their bundled types drag `node:*` into
 * `dist`'s d.ts). Asserting the compiled bodies against them here is what makes
 * "the wire body is the SDK's params" a checked statement rather than a claim.
 */
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";
import type { GenerateContentParameters } from "@google/genai";
import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";

import { chat } from "../../src/chat/index";
import { chat as anthropicChat } from "../../src/providers/anthropic";
import { chat as googleChat } from "../../src/providers/google";
import type {
  ChatBody,
  ChatDialectOf,
  ChatModelOf,
  ChatProviderOf,
} from "../../src/chat/index";
import type { ChatModelRef, ChatParams } from "../../src/chat/types";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

// ---------------------------------------------------------------------------
// The ref union drives autocomplete without gating the API
// ---------------------------------------------------------------------------

expectAssignable<ChatModelRef>("anthropic/claude-opus-5");
expectAssignable<ChatModelRef>("openai/gpt-5.2");
expectAssignable<ChatModelRef>("google/gemini-2.5-flash");
// Model ids that contain slashes are refs too — that is why the split is on the
// FIRST slash and never the last.
expectAssignable<ChatModelRef>("openrouter/anthropic/claude-opus-5");
// @ts-expect-error — not a ref in the committed snapshot.
expectAssignable<ChatModelRef>("openai/gpt-5.2-turbo-max");
// …but `ChatParams["model"]` still accepts it, because models.dev is a
// snapshot and a model released after it must stay callable.
expectAssignable<ChatParams["model"]>("openai/gpt-5.2-turbo-max");

// ---------------------------------------------------------------------------
// SplitRef: first slash, never last
// ---------------------------------------------------------------------------

expectTrue<ChatProviderOf<"openai/gpt-5.2"> extends "openai" ? true : false>();
expectTrue<
  ChatProviderOf<"openrouter/anthropic/claude-opus-5"> extends "openrouter" ? true : false
>();
expectTrue<ChatModelOf<"openai/gpt-5.2"> extends "gpt-5.2" ? true : false>();
expectTrue<
  ChatModelOf<"openrouter/anthropic/claude-opus-5"> extends "anthropic/claude-opus-5" ? true : false
>();

expectTrue<ChatDialectOf<"anthropic/claude-opus-5"> extends "anthropic-messages" ? true : false>();
expectTrue<ChatDialectOf<"google/gemini-2.5-flash"> extends "gemini" ? true : false>();
expectTrue<ChatDialectOf<"groq/llama-3.1-8b-instant"> extends "openai-chat" ? true : false>();
expectTrue<ChatDialectOf<"openrouter/anthropic/claude-opus-5"> extends "openai-chat" ? true : false>();

// ---------------------------------------------------------------------------
// Per-dialect return bodies, against the official SDK param types
// ---------------------------------------------------------------------------

const claude = chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 1024,
  reasoning: { budgetTokens: 512 },
});

/**
 * Comparing a *whole dialect body* against an SDK's create-params runs into
 * three systematic divergences, none of which is about the compiled request
 * being wrong. Each is neutralised explicitly below, so what remains asserted
 * is every other field — which is the part that would break if the compiler
 * emitted a wrong one.
 *
 * 1. **`stream` is a discriminant in all three SDKs.** Their params are a union
 *    of a non-streaming arm (`stream?: false`) and a streaming one
 *    (`stream: true`), so an open `stream?: boolean` matches neither until a
 *    caller narrows it — which a caller does, by knowing which call they are
 *    making. `stream?: false` narrows it the same way.
 * 2. **unmodel's content types are supersets of the SDKs' *request* types**
 *    (`Replace`). A wire `TextBlock` may carry `citations`, which the SDKs type
 *    only on responses, so one `MessageParam` models both directions where the
 *    SDK has separate `…Param` types. Substituting the SDK's own field type is
 *    what makes the rest of the comparison meaningful.
 * 3. **Some dialect fields are deliberately wider than any one SDK's**
 *    (`Open`). The chat-completions dialect is shared by 30 providers who each
 *    narrow `reasoning_effort` and `service_tier` differently, so the base type
 *    keeps them open `string`s; Anthropic's `container` accepts an object form
 *    the SDK types as a bare string, and `output_config.format` carries the
 *    caller's schema as a `Record`. The per-provider validators pin the exact
 *    unions — see `test/types/openai.test-d.ts`.
 *
 * Both lists are spelled out one field at a time on purpose: a name that
 * quietly joins them is a field that stopped matching its SDK.
 *
 * The provider subpaths' own type tests need none of this, because there the
 * body's type is the caller's literal `T` — which mentions no field the caller
 * did not write. A unified result is typed from the *ref*, so it always carries
 * the dialect's full optional surface.
 */
type SdkComparable<
  T,
  P extends object,
  Replace extends keyof P,
  Open extends PropertyKey = never,
> = Omit<T, "stream" | Replace | Open> & Pick<P, Replace> & { stream?: false };

/**
 * Fields whose wire type is a superset of the SDK's request type.
 * `messages` / `system` because a wire `TextBlock` may carry response-only
 * `citations`; `tools` because the wire union also covers Anthropic's
 * provider-defined server tools, which have no `input_schema`.
 */
type AnthropicReplace = "messages" | "system" | "tools";
/** Fields the dialect keeps wider than the SDK's own union. */
type AnthropicOpen = "container" | "output_config";

type OpenAiReplace = "messages";
type OpenAiOpen = "reasoning_effort" | "service_tier";

// `@anthropic-ai/sdk`'s params ARE the wire body, so the compiled result is
// directly usable as `client.messages.create(...)` input.
declare const claudeSync: SdkComparable<typeof claude, MessageCreateParams, AnthropicReplace, AnthropicOpen>;
expectAssignable<MessageCreateParams>(claudeSync);
declare const claudeSdk: SdkComparable<
  ReturnType<typeof claude.toSdk<"anthropic">>,
  MessageCreateParams,
  AnthropicReplace,
  AnthropicOpen
>;
expectAssignable<MessageCreateParams>(claudeSdk);
expectAssignable<"claude-opus-5" | (string & {})>(claude.model);
expectAssignable<number>(claude.max_tokens);

const gpt = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 1024,
});

declare const gptSync: SdkComparable<typeof gpt, ChatCompletionCreateParams, OpenAiReplace, OpenAiOpen>;
expectAssignable<ChatCompletionCreateParams>(gptSync);
declare const gptSdk: SdkComparable<
  ReturnType<typeof gpt.toSdk<"openai">>,
  ChatCompletionCreateParams,
  OpenAiReplace,
  OpenAiOpen
>;
expectAssignable<ChatCompletionCreateParams>(gptSdk);
expectAssignable<"gpt-5.2" | (string & {})>(gpt.model);

const gemini = chat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 1024,
});

// Gemini's model id travels in the URL, so it is STRIPPED from the body — the
// same invariant `google.chat`'s own result holds.
expectTrue<IsNever<KeyIn<typeof gemini, "model">>>();
expectAssignable<GenerateContentParameters>(gemini.toSdk("google") as GenerateContentParameters);
// `.modelId` is the only place to read the id back.
expectAssignable<"gemini-2.5-flash">(gemini.modelId);

// Every dialect offers "ai-sdk"; only its own dialect's native target.
gpt.toSdk("ai-sdk");
claude.toSdk("ai-sdk");
gemini.toSdk("ai-sdk");
// @ts-expect-error — an anthropic ref does not offer OpenAI's SDK shape.
claude.toSdk("openai");
// @ts-expect-error — a chat-completions ref does not offer Anthropic's.
gpt.toSdk("anthropic");
// @ts-expect-error — every target is named; the zero-arg form does not exist.
gpt.toSdk();

// ---------------------------------------------------------------------------
// No `.toApi` — a unified result has no dialect to leave
// ---------------------------------------------------------------------------

// @ts-expect-error — `unmodel/chat` results do not retarget; change `model`.
claude.toApi("openrouter");
// @ts-expect-error — nor the safe form.
gpt.toApiSafe("groq");
expectTrue<IsNever<KeyIn<typeof gemini, "toApi">>>();

// ---------------------------------------------------------------------------
// `target` and `modelId` narrow to the ref's halves
// ---------------------------------------------------------------------------

expectAssignable<"anthropic">(claude.target);
expectAssignable<"claude-opus-5">(claude.modelId);
expectAssignable<"openrouter">(
  chat({ model: "openrouter/anthropic/claude-opus-5", messages: [] as never }).target,
);

// ---------------------------------------------------------------------------
// ExactKeys: a typo is a compile error, not a silent pass-through
// ---------------------------------------------------------------------------

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — the param is `maxOutputTokens`; `maxTokens` is a typo.
  maxTokens: 128,
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — wire spellings do not belong in the unified vocabulary.
  max_completion_tokens: 128,
});

// ---------------------------------------------------------------------------
// The composition idiom compiles — which is the whole reason `modelId` and
// `target` are exempt from `ExactKeys`. Spreading a result into the provider's
// own validator is the documented way to get unified authoring plus
// provider-exact, catalog-aware validation.
// ---------------------------------------------------------------------------

anthropicChat({ ...claude });
// Gemini strips `model` into the URL, so it has to be put back — and the
// literal only compiles because `modelId` is `ExactKeys`-exempt.
googleChat({ model: gemini.modelId, ...gemini });

// ---------------------------------------------------------------------------
// An unresolvable ref degrades to the three-body union, not to `any`
// ---------------------------------------------------------------------------

const unknown = chat({
  model: "acme-labs/wonder-1",
  messages: [{ role: "user", content: "hi" }],
});

// `messages` exists on two of the three dialects and not on Gemini, so the
// union has no such property — the honest outcome of an unknown provider.
// @ts-expect-error — the dialect is unknown, so the body is a union.
unknown.messages;
// Only the target every dialect shares survives `keyof` on a union.
unknown.toSdk("ai-sdk");
// @ts-expect-error — not offered by every arm of the union.
unknown.toSdk("openai");
// The request metadata is dialect-independent and stays fully typed.
expectAssignable<string>(unknown.request.url);
expectAssignable<"POST">(unknown.request.method);

// A ref widened all the way to `string` behaves the same.
declare const dynamicRef: string;
const dynamic = chat({ model: dynamicRef, messages: [{ role: "user", content: "hi" }] });
expectAssignable<string>(dynamic.request.url);
expectAssignable<readonly unknown[]>(dynamic.warnings);

// ---------------------------------------------------------------------------
// ChatBody, standalone
// ---------------------------------------------------------------------------

expectTrue<IsNever<KeyIn<ChatBody<"google/gemini-2.5-flash">, "model">>>();
expectAssignable<ChatBody<"anthropic/claude-opus-5">>({
  model: "claude-opus-5",
  max_tokens: 16,
  messages: [{ role: "user", content: "hi" }],
});
expectAssignable<"claude-opus-5" | (string & {})>(
  (undefined as unknown as ChatBody<"anthropic/claude-opus-5">).model,
);
expectAssignable<ChatBody<"groq/llama-3.1-8b-instant">>({
  model: "llama-3.1-8b-instant",
  messages: [{ role: "user", content: "hi" }],
});

// ---------------------------------------------------------------------------
// safe() carries the identical surface
// ---------------------------------------------------------------------------

const outcome = chat.safe({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 64,
});
declare const safeSync: SdkComparable<
  Extract<typeof outcome, { ok: true }>["params"],
  MessageCreateParams,
  AnthropicReplace,
  AnthropicOpen
>;
expectAssignable<MessageCreateParams>(safeSync);

if (outcome.ok) {
  expectAssignable<"claude-opus-5">(outcome.params.modelId);
  expectAssignable<number | undefined>(outcome.estimate.inputTokens);
} else {
  expectAssignable<string>(outcome.errors[0]?.message ?? "");
}
