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
import { createChat } from "../../src/chat/factory";
import { chat as anthropicChat } from "../../src/providers/anthropic";
import { chat as googleChat } from "../../src/providers/google";
import { chat as openaiChat } from "../../src/providers/openai";
import type {
  ChatBody,
  ChatDialectOf,
  ChatModelOf,
  ChatProviderOf,
} from "../../src/chat/index";
import type { ChatModelRef, ChatParams } from "../../src/chat/types";
import type { ValidateResult } from "../../src/core/result";
import {
  expectAssignable,
  expectNotAny,
  expectNotNever,
  expectTrue,
  type IsNever,
  type KeyIn,
} from "./helpers";

/** Exact type equality (invariant both ways), as in `retarget.test-d.ts`. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

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
  maxOutputTokens: 4096,
  reasoning: { budgetTokens: 2048 },
});

// The registry must preserve provider result types rather than erasing them at
// its dynamic dispatch boundary. These fail if either the whole result or a
// provider-only field ever becomes `any`.
expectNotAny<typeof claude>();
expectNotAny<typeof claude.thinking>();

/**
 * Comparing a *whole dialect body* against an SDK's create-params runs into
 * two systematic divergences, neither of which is about the compiled request
 * being wrong. Each is neutralised explicitly below, so what remains asserted
 * is every other field — which is the part that would break if the compiler
 * emitted a wrong one.
 *
 * 1. **unmodel's content types are supersets of the SDKs' *request* types**
 *    (`Replace`). A wire `TextBlock` may carry `citations`, which the SDKs type
 *    only on responses, so one `MessageParam` models both directions where the
 *    SDK has separate `…Param` types. Substituting the SDK's own field type is
 *    what makes the rest of the comparison meaningful.
 * 2. **Some dialect fields are deliberately wider than any one SDK's**
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
 * **There used to be a third, and its removal is the point.** `stream` is the
 * discriminant in all three SDKs — their params are a union of `stream?: false`
 * and `stream: true` — and a unified result carried the dialect's open
 * `stream?: boolean`, which matches neither arm. This helper neutralised it
 * with `Omit<T, "stream"> & { stream?: false }`, i.e. the test performed the
 * narrowing the type would not, and the doc comment here argued that "a caller
 * narrows, by knowing which call they are making". A caller should not have to:
 * `src/chat/encode.ts` writes the key if and only if the caller wrote it, so
 * unmodel always knew. It narrows now (`ProviderParamsFor`, src/chat/factory.ts),
 * and this helper got shorter — which is the confirmation, since a fix that
 * needed the special case kept would not have been one.
 */
type SdkComparable<
  T,
  P extends object,
  Replace extends keyof P,
  Open extends PropertyKey = never,
> = Omit<T, Replace | Open> & Pick<P, Replace>;

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
expectNotAny<ReturnType<typeof claude.toSdk<"anthropic">>>();
expectAssignable<MessageCreateParams>(claudeSdk);
expectAssignable<"claude-opus-5" | (string & {})>(claude.model);
expectAssignable<number>(claude.max_tokens);
expectAssignable<MessageCreateParams["thinking"]>(claude.thinking);

const gpt = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 1024,
});
expectNotAny<typeof gpt.reasoning_effort>();

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
expectAssignable<"gpt-5.2">(gpt.model);
expectAssignable<ChatCompletionCreateParams["reasoning_effort"]>(gpt.reasoning_effort);

// ---------------------------------------------------------------------------
// `stream`: the result carries the key if and only if the caller wrote it
//
// This is the whole of the SDK hand-off fix. `client.chat.completions.create`
// and `client.messages.create` are overloaded on `stream` — a union of
// `stream?: false` and `stream: true` — so a result carrying an open
// `boolean` resolved neither overload and `.choices` did not exist on what
// came back. `src/chat/encode.ts` has always emitted the key only when asked;
// the type says so now (`ProviderParamsFor`, src/chat/factory.ts).
//
// The negative assertions are the load-bearing ones: `stream?: boolean` would
// satisfy every positive check below and still break `create()`.
// ---------------------------------------------------------------------------

expectTrue<IsNever<KeyIn<typeof gpt, "stream">>>();
expectTrue<IsNever<KeyIn<typeof claude, "stream">>>();

const gptStreaming = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
});
expectAssignable<true>(gptStreaming.stream);
expectAssignable<ChatCompletionCreateParams>(
  gptStreaming as unknown as SdkComparable<
    typeof gptStreaming,
    ChatCompletionCreateParams,
    OpenAiReplace,
    OpenAiOpen
  >,
);

const gptNotStreaming = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  stream: false,
});
// A literal `false`, not a widened `boolean`: the non-streaming overload takes
// `stream?: false`, so widening here would break the call the caller spelled
// out most explicitly.
expectAssignable<false>(gptNotStreaming.stream);

const claudeStreaming = chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 8,
  stream: true,
});
expectAssignable<true>(claudeStreaming.stream);

// Gemini is exempt from the whole mechanism, and must stay exempt: it has no
// streaming FLAG. `stream: true` selects `:streamGenerateContent`, a different
// URL, and the body never gains a key — which is what `src/chat/encode.ts`'s
// `targetDialect !== "gemini"` guard says and what this pins.
const geminiStreaming = chat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
});
expectTrue<IsNever<KeyIn<typeof geminiStreaming, "stream">>>();

// The assertion the whole item exists for, and the only one that exercises
// OVERLOAD RESOLUTION rather than assignability: `create()` is overloaded on
// `stream`, so a body that is merely *assignable* to the params union can
// still fall through to the base signature — where the return type is
// `ChatCompletion | Stream<ChatCompletionChunk>` and `.choices` is a TS2339.
// That was the adopter's report, and `{ ...body, stream: false }` was their
// workaround. `declare const` rather than a real client: no network, no
// runtime, and `src/` still never imports an SDK.
declare const openaiClient: import("openai").default;

async function sdkHandOffCompiles(): Promise<void> {
  // No cast, no spread, no `stream: false`. `.choices` resolving at all is the
  // assertion: it exists on `ChatCompletion` and not on the base overload's
  // `ChatCompletion | Stream<ChatCompletionChunk>`.
  const nonStreaming = await openaiClient.chat.completions.create(gpt.toSdk("openai"));
  expectAssignable<string | null>(nonStreaming.choices[0]?.message.content ?? null);

  // …and the other arm resolves too, which is what makes this a narrowing
  // rather than a `stream?: false` lie: `for await` only compiles on `Stream`.
  const streaming = await openaiClient.chat.completions.create(gptStreaming.toSdk("openai"));
  for await (const chunk of streaming) {
    expectAssignable<string | null | undefined>(chunk.choices[0]?.delta.content);
  }
}
void sdkHandOffCompiles;

// `anthropic.messages.create` is deliberately NOT called here, and the reason
// is `AnthropicReplace`, not `stream`. The wire `MessageParam` is a superset of
// the SDK's request type — a `TextBlock` may carry `citations`, which the SDK
// types only on responses — so `messages` needs the documented substitution
// before any comparison means anything, `stream` or no `stream`. The
// `claudeSync` / `claudeSdk` assertions above make that substitution and then
// assert the whole body, including the now-narrowed `stream`.
// @ts-expect-error — OpenAI's gpt-5.2 availability has no Groq target.
gpt.toApi("groq");

const gemini = chat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 1024,
});
expectNotAny<typeof gemini.generationConfig>();

// Gemini's model id travels in the URL, so it is STRIPPED from the body — the
// same invariant `google.chat`'s own result holds.
expectTrue<IsNever<KeyIn<typeof gemini, "model">>>();
expectAssignable<GenerateContentParameters>(gemini.toSdk("google") as GenerateContentParameters);
// `.modelId` is the only place to read the id back.
expectAssignable<"gemini-2.5-flash">(gemini.modelId);

// A narrow registry preserves the same provider-specific result inference
// without importing the ready-made 32-provider registry.
const narrowChat = createChat({
  anthropic: anthropicChat,
  google: googleChat,
  openai: openaiChat,
});
const narrowClaude = narrowChat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 4096,
});
expectNotAny<typeof narrowClaude>();
expectNotAny<typeof narrowClaude.thinking>();
narrowClaude.toSdk("anthropic");
narrowClaude.toApi("openrouter");

const narrowGemini = narrowChat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
});
expectNotAny<typeof narrowGemini>();
expectNotAny<typeof narrowGemini.generationConfig>();
narrowGemini.toSdk("google");

const narrowGpt = narrowChat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
});
expectNotAny<typeof narrowGpt>();
expectNotAny<typeof narrowGpt.reasoning_effort>();
expectAssignable<"gpt-5.2">(narrowGpt.model);
expectAssignable<ChatCompletionCreateParams["reasoning_effort"]>(narrowGpt.reasoning_effort);
narrowGpt.toApi("openrouter");
// @ts-expect-error — factory composition must preserve model-specific availability.
narrowGpt.toApi("groq");

// Registry keys are provider ids, not arbitrary labels.
createChat({
  // @ts-expect-error — not a statically addressable provider id.
  acme: anthropicChat,
});

// ---------------------------------------------------------------------------
// The registry's key and its value are one claim, not two
// ---------------------------------------------------------------------------
//
// Structurally every chat validator is the same type, and providers routinely
// serve the same model ids — so a mis-filed entry produces a request addressed
// to the wrong host, priced against the wrong catalog, with zero warnings. The
// provider brand is what makes it a compile error instead.

// @ts-expect-error — openai's validator filed under anthropic's key.
createChat({ anthropic: openaiChat });
// @ts-expect-error — anthropic's validator filed under openai's key.
createChat({ openai: anthropicChat });
// @ts-expect-error — google's validator filed under openai's key.
createChat({ openai: googleChat });

// An explicitly-`undefined` entry is a compile error, not a runtime TypeError:
// `tsconfig` has no `exactOptionalPropertyTypes`, so without this it would be
// assignable to the optional property and only fail at construction.
declare const registerOpenAI: boolean;
// @ts-expect-error — build the registry with a spread instead.
createChat({ openai: registerOpenAI ? openaiChat : undefined });

// ---------------------------------------------------------------------------
// The escape hatch for a hand-written validator
// ---------------------------------------------------------------------------
//
// A validator carrying no result-kind marker is still registrable — that is
// what keeps the registry open to third parties — and its declared result type
// must survive the round trip rather than degrading to `any` or `never`. No
// shipped validator takes this branch, which is exactly why it needs a test.

interface CustomBody {
  model: string;
  messages: unknown[];
  house_flag?: boolean;
}
type CustomResult = CustomBody & { request: { url: string; method: "POST" } };
declare const customChat: ((params: CustomBody) => CustomResult) & {
  safe: (params: CustomBody) => ValidateResult<CustomResult>;
};
const custom = createChat({ deepseek: customChat });
const customResult = custom({
  model: "deepseek/deepseek-chat",
  messages: [{ role: "user", content: "hi" }],
});
expectNotNever<typeof customResult>();
expectNotAny<typeof customResult>();
expectAssignable<boolean | undefined>(customResult.house_flag);
expectAssignable<string>(customResult.request.url);
// The unified compiler's own facts are still attached.
expectAssignable<"deepseek">(customResult.target);

// ---------------------------------------------------------------------------
// A ref whose provider is not in the pack has no usable result
// ---------------------------------------------------------------------------
//
// The call can only ever throw `TranslationUnavailableError`, so a result type
// that answers `.request` and `.toSdk` describes a value the program cannot
// produce. Naming the mistake at the call site is the point.

const unregistered = narrowChat({
  model: "groq/llama-3.1-8b-instant",
  messages: [{ role: "user", content: "hi" }],
});
expectNotNever<typeof unregistered>();
// @ts-expect-error — "groq" was never registered on this pack.
unregistered.request;
// @ts-expect-error — same.
unregistered.toSdk("openai");
// The brand names the provider that is missing.
expectAssignable<"groq">(unregistered.__unmodel_unregisteredChatProvider);

// ---------------------------------------------------------------------------
// A union of refs stays a union of results
// ---------------------------------------------------------------------------
//
// `flag ? "anthropic/…" : "google/…"` is the ordinary way a model is chosen at
// runtime. Without distribution the result collapses to `never` — which is
// assignable to everything, so nothing errors, the hover reads `never`, and
// the completion list is empty. `expectNotAny` cannot see this; only
// `expectNotNever` can.

declare const eitherRef: "anthropic/claude-opus-5" | "openai/gpt-5.2";
const either = chat({
  model: eitherRef,
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 64,
});
expectNotNever<typeof either>();
expectNotAny<typeof either>();
expectAssignable<string>(either.request.url);
expectAssignable<"anthropic" | "openai">(either.target);
// The union is a real discriminated union: `target` narrows it back to one
// provider's body, which is where the dialect-specific surface lives.
if (either.target === "anthropic") {
  expectAssignable<number>(either.max_tokens);
  either.toSdk("anthropic");
} else {
  expectAssignable<"gpt-5.2" | (string & {})>(either.model);
  either.toSdk("openai");
}
// Unnarrowed, `toSdk` is a union of two generic signatures, which TypeScript
// declines to call. That is the sound answer and deliberately not papered
// over: intersecting the signatures would make `either.toSdk("openai")`
// compile against a value that may be the Anthropic arm at runtime.
// @ts-expect-error — narrow on `target` first.
either.toSdk("ai-sdk");

declare const eitherDialect: "anthropic/claude-opus-5" | "google/gemini-2.5-flash";
const crossDialect = chat({
  model: eitherDialect,
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 64,
});
expectNotNever<typeof crossDialect>();
expectAssignable<"anthropic" | "google">(crossDialect.target);

const eitherNarrow = narrowChat({
  model: eitherRef,
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 64,
});
expectNotNever<typeof eitherNarrow>();
expectAssignable<string>(eitherNarrow.request.url);

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
// The concrete provider's `.toApi` surface survives
// ---------------------------------------------------------------------------

claude.toApi("openrouter");
gpt.toApiSafe("openai");
gemini.toApi("openrouter");

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

chat(
  { model: "openai/gpt-5.2", messages: [{ role: "user", content: "hi" }] },
  {
    // @ts-expect-error — a second catalog authority is incompatible with
    // provider-exact delegation; configure/register the provider validator.
    catalog: {},
  },
);

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
// A LITERAL provider this build cannot serve is branded, not structural
//
// Every ref below throws `TranslationUnavailableError` at runtime, always. The
// result type used to be a full `Validated` with `.request`, `.toSdk` and a
// three-body union — a type describing a value the program cannot produce. The
// brand carries the *reason*, so the hover names which of `refs.ts`'s four
// remedies applies.
// ---------------------------------------------------------------------------

const unknown = chat({
  model: "acme-labs/wonder-1",
  messages: [{ role: "user", content: "hi" }],
});

// @ts-expect-error — a call that always throws has no body.
unknown.messages;
// @ts-expect-error — and no SDK shape, not even the shared `ai-sdk` target.
unknown.toSdk("ai-sdk");
// @ts-expect-error — nor the per-dialect ones.
unknown.toSdk("openai");
// @ts-expect-error — nor request metadata.
unknown.request;
// The meta half survives, so `warnings`/`target` still read.
expectAssignable<"acme-labs">(unknown.target);
// The brand names the provider AND the remedy.
expectTrue<
  Equals<
    typeof unknown["__unmodel_unregisteredChatProvider"] &
      typeof unknown["__unmodel_refProblem"],
    "acme-labs" & "unknown-provider"
  >
>();

// The four real-provider cases, each with the reason `classifyRef` computes.
const cohereRef = chat({
  model: "cohere/command-a-03-2025",
  messages: [{ role: "user", content: "hi" }],
});
expectTrue<Equals<typeof cohereRef["__unmodel_refProblem"], "no-codec">>();
const azureRef = chat({ model: "azure/gpt-5", messages: [{ role: "user", content: "hi" }] });
expectTrue<Equals<typeof azureRef["__unmodel_refProblem"], "factory">>();
const bedrockRef = chat({
  model: "amazon-bedrock/anthropic.claude-sonnet-4-5",
  messages: [{ role: "user", content: "hi" }],
});
expectTrue<Equals<typeof bedrockRef["__unmodel_refProblem"], "factory-and-no-codec">>();
const typoRef = chat({ model: "opnai/gpt-5", messages: [{ role: "user", content: "hi" }] });
// A plain provider typo — the case `model`'s `(string & {})` tail lets through.
expectTrue<Equals<typeof typoRef["__unmodel_refProblem"], "unknown-provider">>();
// @ts-expect-error — and it can no longer be used as a request.
typoRef.request.url;

// A union ref loses `.request` entirely when ANY arm is unservable — the call
// throws half the time, so there is no honest shared shape. Deliberate, and a
// behaviour change beyond the four singletons above.
declare const flag: boolean;
const mixed = chat({
  model: flag ? "openai/gpt-5.2" : "cohere/command-a-03-2025",
  messages: [{ role: "user", content: "hi" }],
});
// @ts-expect-error — one arm of the union is branded.
mixed.request;

// A ref widened all the way to `string` stays fully callable — the escape hatch
// for a model released after this build.
declare const dynamicRef: string;
const dynamic = chat({ model: dynamicRef, messages: [{ role: "user", content: "hi" }] });
expectAssignable<string>(dynamic.request.url);
expectAssignable<readonly unknown[]>(dynamic.warnings);
// So does a post-snapshot model id at a REGISTERED provider.
const futureModel = chat({
  model: "openai/gpt-9-turbo",
  messages: [{ role: "user", content: "hi" }],
});
expectAssignable<string>(futureModel.request.url);

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

// Untyped boundaries have their own explicit safe surface. Its success value
// is still a useful, non-any fallback result even though no literal ref exists
// from which to select one provider statically.
declare const untrustedInput: unknown;
const untrustedOutcome = chat.safeUnknown(untrustedInput);
if (untrustedOutcome.ok) {
  expectNotAny<typeof untrustedOutcome.params>();
  expectAssignable<string>(untrustedOutcome.params.request.url);
  untrustedOutcome.params.toSdk("ai-sdk");
}

// ---------------------------------------------------------------------------
// `providerOptions`: closed keys, typed buckets, escape hatch intact
//
// The keys used to be `ChatProviderId | (string & {})`, which in KEY position
// collapses the mapped type to `[x: string]: …` and switches excess-property
// checking off entirely — so a bucket addressed to `opneai` compiled, and
// `encode.ts` then made it silently inert. The values used to be
// `Record<string, unknown>`, so nothing in the bucket was checked either.
//
// What must NOT break is the reason the field exists, so all three hatches are
// asserted rather than assumed.
// ---------------------------------------------------------------------------

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  providerOptions: {
    // A declared wire field of that provider's dialect, with its declared type.
    openai: { logprobs: true, top_logprobs: 5 },
    // A key no wire type declares — an endpoint-only extra (`store` lives on
    // OpenAI's own body, not the shared dialect body) or a knob shipped after
    // this snapshot. Both must still compile.
    anthropic: { container: "c-1", brand_new_2027_knob: true },
    // Nested, which is where the shallow form of this type broke.
    google: { generationConfig: { thinkingConfig: { thinkingBudget: 1024 }, brandNewKnob: 1 } },
    // A provider `unmodel/chat` cannot send to: known, inert, silent, legal.
    // `test/chat/encode.test.ts` pins the runtime half of that promise.
    "amazon-bedrock": { additionalModelRequestFields: { top_k: 5 } },
  },
});

// A new value on an already-closed wire enum still compiles — the leaf `(string
// & {})` arm. Without it the escape hatch would stop escaping for exactly the
// case it exists for, which the module header calls out by name.
chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 8,
  providerOptions: { anthropic: { service_tier: "priority_2027" } },
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — a typo'd bucket key is a compile error now, with a
  // "Did you mean to write 'openai'?" suggestion.
  providerOptions: { opneai: { store: true } },
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — and a declared field's type is checked: `logprobs` is a
  // boolean on that wire body.
  providerOptions: { openai: { logprobs: "yes" } },
});

// ---------------------------------------------------------------------------
// The openai bucket is typed off OpenAI's ENDPOINT body, not the shared
// dialect base — so the twelve params only OpenAI takes complete and check.
//
// They used to reach the `Record<string, unknown>` arm and check nothing: the
// package typed, enumerated and validated `verbosity` in `openai.chat`'s own
// schema and then handed the caller an untyped bag at the one place they write
// it. `verbosity` is the canonical example named in `ChatParams
// .providerOptions`' JSDoc: first-party, documented, single-witness — exactly
// what belongs in a bucket rather than in the vocabulary.
// ---------------------------------------------------------------------------

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  providerOptions: {
    openai: {
      verbosity: "low",
      store: true,
      safety_identifier: "u1",
      prompt_cache_key: "k",
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      prompt_cache_retention: "24h",
      metadata: { run: "42" },
      modalities: ["text"],
      moderation: { model: "omni-moderation-latest" },
      prediction: { type: "content", content: "x" },
      audio: { format: "mp3", voice: "alloy" },
      // The key hatch survives inside an OpenAI-only param, one level down.
      web_search_options: { search_context_size: "high", brand_new_2027_knob: 1 },
      // …and at the top level, which is what `store` itself needed before it
      // was reachable by name.
      another_brand_new_2027_knob: true,
    },
  },
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — `verbosity` is `low | medium | high`, and `openai.chat`
  // refuses anything else with `[invalid_shape]` today. Where the runtime
  // refuses, the type refuses: the leaf `(string & {})` hatch is for enums the
  // library CARRIES an unknown value through, which this is not.
  providerOptions: { openai: { verbosity: "extreme" } },
});

// The shared dialect half is untouched, so the hatch it exists for still
// works: `service_tier` is an open `string` on the base (~30 providers, ~30
// vocabularies), and both non-OpenAI codecs carry an unknown tier verbatim.
chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  providerOptions: { openai: { service_tier: "a_tier_shipped_next_month" } },
});

// `messages` is the compiler's, and `Omit` alone did not take it: `Openable`'s
// index signature re-admitted it, and the runtime then replaced the compiled
// conversation wholesale with no warning at all.
chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — a bucket cannot clobber the compiled messages array.
  providerOptions: { openai: { messages: [{ role: "user", content: "CLOBBERED" }] } },
});

// `model` is NOT subtracted with it. Gemini's model lives in the URL and
// `providerOptions.google.model` is a supported override of exactly that —
// see test/chat/streaming.test.ts, which pins the streaming URL to the one the
// validator produced so the override survives re-routing.
chat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
  providerOptions: { google: { model: "models/gemini-2.0-flash" } },
});

// `serviceTier` completes every dialect's vocabulary and gates none of them:
// both non-OpenAI codecs DROP an unknown tier with a named warning rather than
// refusing it, so the tail is what keeps the type honest about the runtime.
expectAssignable<ChatParams["serviceTier"]>("flex");
expectAssignable<ChatParams["serviceTier"]>("standard_only");
expectAssignable<ChatParams["serviceTier"]>("unspecified");
expectAssignable<ChatParams["serviceTier"]>("a_tier_shipped_next_month");

// ---------------------------------------------------------------------------
// The two provider-keyed fields below the top level
//
// Both used to be bare `string` / `unknown`, so both completed nothing and both
// failed silently: a file part whose provider unmodel has no endpoint for is
// DROPPED with `dropped_content`, and a native tool filed under the wrong
// dialect is dropped with `dropped_tool`. A warning on a channel most callers
// never read is a deleted attachment and a missing tool.
// ---------------------------------------------------------------------------

chat({
  model: "openai/gpt-5.2",
  messages: [
    {
      role: "user",
      content: [{ type: "file", data: { fileId: "file-1", provider: "openai" } }],
    },
  ],
});

// The tail stays: a provider added to the endpoint table after this build still
// compiles, exactly as `model` does.
chat({
  model: "openai/gpt-5.2",
  messages: [
    {
      role: "user",
      content: [{ type: "file", data: { fileId: "f", provider: "a-provider-from-2027" } }],
    },
  ],
});

// Each dialect's native tools, under the provider that owns them.
chat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
  nativeTools: [
    { provider: "google", definition: { googleSearch: {} } },
    { provider: "google", definition: { codeExecution: {} } },
    // A grounding tool shipped after this snapshot — the arm's own escape hatch.
    { provider: "google", definition: { brandNewGroundingTool: { x: 1 } } },
    // Vertex serves the same dialect, so a tool filed there is emitted, not dropped.
    { provider: "google-vertex", definition: { googleMaps: {} } },
  ],
});

chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 16,
  nativeTools: [
    { provider: "anthropic", definition: { type: "web_search_20250305", name: "web_search" } },
    { provider: "anthropic", definition: { type: "memory_20260101", name: "memory", extra: 1 } },
  ],
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  nativeTools: [
    { provider: "openai", definition: { type: "custom", custom: { name: "grammar" } } },
    { provider: "openai", definition: { type: "custom", custom: { name: "g" }, future_knob: 1 } },
    // The reason the openai-dialect arm is open on SHAPE: 30 providers ship
    // built-ins unmodel does not model and `interop.ts` forwards them verbatim.
    { provider: "groq", definition: { type: "browser_search" } },
    { provider: "xai", definition: { type: "web_search" } },
    { provider: "openrouter", definition: { type: "web", web: { max_results: 3 } } },
  ],
});

chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 16,
  // @ts-expect-error — a MISFILED tool: `{ googleSearch: {} }` is a Gemini
  // shape, and Anthropic's arm requires `type` and `name`. This used to compile
  // and then vanish with a `dropped_tool` warning at run time.
  nativeTools: [{ provider: "anthropic", definition: { googleSearch: {} } }],
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — same misfiling on an OpenAI-dialect provider: no `type`.
  nativeTools: [{ provider: "groq", definition: { googleSearch: {} } }],
});

chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 16,
  // @ts-expect-error — a provider typo, with a "Did you mean 'anthropic'?".
  nativeTools: [{ provider: "anthropicc", definition: { type: "t", name: "n" } }],
});

chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "hi" }],
  // @ts-expect-error — `cohere` resolves to no dialect and `amazon-bedrock`'s
  // has no codec, so tools filed under either can only ever be discarded.
  nativeTools: [{ provider: "cohere", definition: { type: "connector" } }],
});
