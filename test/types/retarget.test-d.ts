/**
 * Type-level tests for `.toSdk(target)` / `.toApi(provider)`. Not executed by
 * `bun test` (the filename avoids the *.test.* pattern); checked by
 * `bun run check`.
 *
 * These assert the *shape* of the mechanism against the real generated
 * availability data, without depending on the provider modules' public casts —
 * those are wired in the migration phase, and their own test-d files then
 * assert the same properties end to end.
 */
import type { AnthropicAvailability } from "../../src/catalog/availability/anthropic.gen";
import type { GoogleAvailability } from "../../src/catalog/availability/google.gen";
import type { GroqAvailability } from "../../src/catalog/availability/groq.gen";
import type { Validated } from "../../src/core/request";
import type { ApiModelFor, ApiTargetsFor, StaticApiTargetId } from "../../src/retarget/ids";
import type { MessagesBody } from "../../src/providers/anthropic/wire";
import type { GenerateContentBody } from "../../src/providers/google/wire";
import type {
  ChatCompletionsBodyBase,
  ChatMessage,
} from "../../src/providers/openai-compatible/wire";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

/** Exact type equality (invariant both ways), for asserting resolved unions. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// ---------------------------------------------------------------------------
// PREREQUISITE INVARIANT — every `.toApi`-capable dialect must declare `model`
// as `Union | (string & {})`, never plain `string`.
//
// This is the silent-degradation hazard of the whole design: with plain
// `string`, TypeScript widens the caller's literal, `ApiTargetsFor` takes its
// permissive fallback arm, and `.toApi` quietly accepts every target. Nothing
// else in the suite would fail. So it is asserted here, first.
// ---------------------------------------------------------------------------

type IsExactlyString<T> = Equals<T, string>;

expectTrue<IsExactlyString<MessagesBody["model"]> extends true ? false : true>();
expectTrue<IsExactlyString<GenerateContentBody["model"]> extends true ? false : true>();
expectTrue<
  IsExactlyString<ChatCompletionsBodyBase<"gpt-5.4">["model"]> extends true ? false : true
>();
// …and the literal genuinely survives into the union, rather than the field
// merely being some other non-`string` type.
expectAssignable<MessagesBody["model"]>("claude-opus-5");
expectAssignable<ChatCompletionsBodyBase<"gpt-5.4">["model"]>("gpt-5.4");

// ---------------------------------------------------------------------------
// The headline example: a Claude request knows which providers serve Claude.
// ---------------------------------------------------------------------------

type AnthropicSdkTargets = {
  anthropic: () => MessagesBody;
  "ai-sdk": () => { messages: unknown[] };
};

declare const claude: Validated<
  MessagesBody & { model: "claude-opus-5" },
  AnthropicSdkTargets,
  AnthropicAvailability,
  "claude-opus-5"
>;

// OpenAI does not serve Claude. This is the whole point of the feature.
// @ts-expect-error — "openai" is not a target for "claude-opus-5".
claude.toApi("openai");

// OpenRouter and the Vercel AI Gateway do.
const viaOpenRouter = claude.toApi("openrouter");
claude.toApi("vercel");

// Neither does a provider that serves no Claude at all, nor a typo.
// @ts-expect-error — groq does not serve "claude-opus-5".
claude.toApi("groq");
// @ts-expect-error — not a catalog provider id.
claude.toApi("open-ai");

// The available set is exactly the static targets in the generated data
// (amazon-bedrock is in the data but factory-configured, so it is filtered).
expectTrue<Equals<ApiTargetsFor<AnthropicAvailability, "claude-opus-5">, "openrouter" | "vercel">>();

// ---------------------------------------------------------------------------
// Factory providers are excluded from the one-arg union (design-types §5).
// ---------------------------------------------------------------------------

// @ts-expect-error — amazon-bedrock needs a region `.toApi` never received.
claude.toApi("amazon-bedrock");
// @ts-expect-error — azure needs the resource endpoint (and its `model` is a deployment name).
claude.toApi("azure");
// @ts-expect-error — google-vertex needs project + location.
claude.toApi("google-vertex");

// ---------------------------------------------------------------------------
// The retargeted result is a body of the TARGET's dialect.
// ---------------------------------------------------------------------------

// Anthropic → OpenRouter crosses into chat-completions, so the result has
// `messages` in OpenAI's shape and the model carries openrouter's spelling.
expectAssignable<ChatMessage[]>(viaOpenRouter.messages);
// `model` carries the TARGET's spelling, widened with `(string & {})` the same
// way every wire body in this repo is.
expectTrue<Equals<typeof viaOpenRouter.model, "anthropic/claude-opus-5" | (string & {})>>();
expectTrue<Equals<ApiModelFor<AnthropicAvailability, "claude-opus-5", "openrouter">, "anthropic/claude-opus-5">>();
expectAssignable<number | null | undefined>(viaOpenRouter.temperature);
expectAssignable<string>(viaOpenRouter.request.url);
expectAssignable<"openrouter">(viaOpenRouter.target);
expectAssignable<number>(viaOpenRouter.warnings.length);

// One hop only: chaining is a compile error, which is what keeps every dialect
// module from having to carry every provider's availability map.
// @ts-expect-error — a retargeted result has no `.toApi`.
viaOpenRouter.toApi("groq");
// @ts-expect-error — nor `.toApiSafe`.
viaOpenRouter.toApiSafe("groq");

// Its `toSdk` union is the target dialect's, not the source's.
viaOpenRouter.toSdk("openai");
// @ts-expect-error — a chat-completions body has no anthropic SDK shape.
viaOpenRouter.toSdk("anthropic");

// `toApiSafe` returns the same payload behind a ValidateResult.
const safe = claude.toApiSafe("openrouter");
if (safe.ok) expectAssignable<ChatMessage[]>(safe.params.messages);

// ---------------------------------------------------------------------------
// `Avail = never` removes `.toApi` entirely — how the ~106 media endpoints opt
// out, at zero type cost.
// ---------------------------------------------------------------------------

declare const speech: Validated<{ input: string; voice: string }, { openai: () => unknown }>;

// @ts-expect-error — this endpoint declares no API targets, so there is no `.toApi`.
speech.toApi("openai");
// @ts-expect-error — nor `.toApiSafe`.
speech.toApiSafe("openai");
expectTrue<IsNever<KeyIn<typeof speech, "toApi">>>();
expectTrue<IsNever<KeyIn<typeof speech, "toApiSafe">>>();

// `.toSdk` and `.request` are still there.
speech.toSdk("openai");
expectAssignable<string>(speech.request.url);

// ---------------------------------------------------------------------------
// `.toSdk(target)`: the zero-arg form is gone, and the union is per-endpoint.
// ---------------------------------------------------------------------------

// @ts-expect-error — `.toSdk()` no longer exists; name the target.
claude.toSdk();
// @ts-expect-error — this endpoint offers anthropic and ai-sdk, not openai.
claude.toSdk("openai");
expectAssignable<MessagesBody>(claude.toSdk("anthropic"));
expectAssignable<{ messages: unknown[] }>(claude.toSdk("ai-sdk"));

// ---------------------------------------------------------------------------
// The model id flows independently of the body — required because
// google.generateContent strips `model` into `.request.url`.
// ---------------------------------------------------------------------------

declare const gemini: Validated<
  Omit<GenerateContentBody, "model">,
  { google: () => unknown },
  GoogleAvailability,
  "gemini-2.5-pro"
>;

// @ts-expect-error — `model` is stripped; it lives in `.request.url`.
gemini.model;
// …yet the availability lookup still resolves, from the fourth type param.
const geminiRouted = gemini.toApi("openrouter");
expectTrue<Equals<typeof geminiRouted.model, "google/gemini-2.5-pro" | (string & {})>>();
expectTrue<
  Equals<ApiModelFor<GoogleAvailability, "gemini-2.5-pro", "openrouter">, "google/gemini-2.5-pro">
>();
// @ts-expect-error — anthropic does not serve Gemini.
gemini.toApi("anthropic");

// ---------------------------------------------------------------------------
// `ApiModelFor` reads both availability entry forms.
// ---------------------------------------------------------------------------

// Bare-string shorthand.
expectTrue<
  Equals<ApiModelFor<GroqAvailability, "openai/gpt-oss-120b", "cerebras">, "gpt-oss-120b">
>();
// The `{ id, narrows }` long form resolves to the id, not the object.
expectTrue<
  Equals<ApiModelFor<GroqAvailability, "qwen/qwen3.6-27b", "siliconflow">, "Qwen/Qwen3.6-27B">
>();

// ---------------------------------------------------------------------------
// Degradation: an unknown model stays permissive (runtime-checked), because an
// unknown model is a warning everywhere else in this library, not an error.
// ---------------------------------------------------------------------------

expectTrue<Equals<ApiTargetsFor<AnthropicAvailability, "claude-future-99">, StaticApiTargetId>>();
expectTrue<Equals<ApiTargetsFor<AnthropicAvailability, string>, StaticApiTargetId>>();
expectTrue<Equals<ApiModelFor<AnthropicAvailability, "claude-future-99", "openrouter">, string>>();

declare const unknownModel: Validated<
  MessagesBody,
  AnthropicSdkTargets,
  AnthropicAvailability,
  string
>;
// Permissive: any static target compiles and is checked at runtime instead.
unknownModel.toApi("groq");
// Still not a factory target, and still not a made-up id.
// @ts-expect-error — factory targets are excluded from the one-arg union.
unknownModel.toApi("amazon-bedrock");
// @ts-expect-error — not a catalog provider id.
unknownModel.toApi("not-a-provider");
