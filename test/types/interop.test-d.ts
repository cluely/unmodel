/**
 * Type-level tests for the dialect codecs, `toSdk("ai-sdk")` and the
 * `unmodel/ai-sdk` adapter. Not executed by `bun test` (the filename avoids
 * the `*.test.*` pattern); checked by `bun run check`.
 *
 * Where `retarget.test-d.ts` asserts the mechanism against synthetic
 * availability types, this file asserts the same properties **through the real
 * provider modules' public casts** — which is the only way to catch a wiring
 * mistake in an endpoint's `sdk` / `api` literals.
 */
import { chat as anthropicChat } from "../../src/providers/anthropic";
import { chat as googleChat } from "../../src/providers/google";
import { chat as groqChat } from "../../src/providers/groq";
import { chat as openaiChat } from "../../src/providers/openai";
import { chat as openrouterChat } from "../../src/providers/openrouter";
import { video } from "../../src/providers/openai/video";
import { withJsonSchemaTools } from "../../src/ai-sdk";
import type { AiSdkChatOptions, AiSdkChatResult } from "../../src/core/translate/ai-sdk";
import type { ChatIR, DecodeContext } from "../../src/core/translate/ir";
import type { Decoder, Encoder } from "../../src/core/translate/retarget";
import type { TranslationWarning, Warn } from "../../src/core/translate/warnings";
import { decodeAnthropic, encodeAnthropic } from "../../src/providers/anthropic/interop";
import { decodeGemini, encodeGemini } from "../../src/providers/google/interop";
import {
  decodeOpenAIChat,
  encodeOpenAIChat,
} from "../../src/providers/openai-compatible/interop";
import type { MessagesBody } from "../../src/providers/anthropic/wire";
import type { GenerateContentBody } from "../../src/providers/google/wire";
import type { ChatCompletionsBodyBase } from "../../src/providers/openai-compatible/wire";
import type { ChatGeminiSdkParams } from "../../src/chat/public-types";
import type { GeminiSdkParams } from "../../src/retarget/dialects";
import { expectAssignable, expectNotAny, expectTrue, type IsNever, type KeyIn } from "./helpers";

/** Exact type equality (invariant both ways), as in `retarget.test-d.ts`. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// ---------------------------------------------------------------------------
// Every codec satisfies the engine's encoder/decoder contracts, so wiring one
// into a `RetargetSpec` cannot go wrong by shape.
// ---------------------------------------------------------------------------

expectAssignable<Encoder<MessagesBody, ChatIR>>(encodeAnthropic);
expectAssignable<Encoder<GenerateContentBody, ChatIR>>(encodeGemini);
expectAssignable<Encoder<ChatCompletionsBodyBase, ChatIR>>(encodeOpenAIChat);
expectAssignable<Decoder<ChatIR>>(decodeAnthropic);
expectAssignable<Decoder<ChatIR>>(decodeGemini);
expectAssignable<Decoder<ChatIR>>(decodeOpenAIChat);

// A decoder may be driven without a target (the golden-fixture suite does),
// and `ctx` narrows the target when there is one.
declare const ir: ChatIR;
declare const warn: Warn;
declare const ctx: DecodeContext;
expectAssignable<MessagesBody>(decodeAnthropic(ir, warn));
expectAssignable<MessagesBody>(decodeAnthropic(ir, warn, ctx));
// Gemini's wire body has no `model` — the id lives in the URL path.
expectTrue<IsNever<KeyIn<ReturnType<typeof decodeGemini>, "model">>>();

// ---------------------------------------------------------------------------
// `toSdk("ai-sdk")` — declared on every chat endpoint family, and nowhere the
// AI SDK cannot actually serve.
// ---------------------------------------------------------------------------

const claude = anthropicChat({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
const gemini = googleChat({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
});
const gpt = openaiChat({ model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] });
const routed = openrouterChat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "hi" }],
});

expectAssignable<AiSdkChatOptions>(claude.toSdk("ai-sdk"));
expectAssignable<AiSdkChatOptions>(gemini.toSdk("ai-sdk"));
expectAssignable<AiSdkChatOptions>(gpt.toSdk("ai-sdk"));
expectAssignable<AiSdkChatOptions>(routed.toSdk("ai-sdk"));

// The lossy contract has to be *observable*: `.toSdk("ai-sdk")` genuinely
// drops things (reasoning parts, server tools, cache breakpoints), so the
// documented `warnings` audit trail must type-resolve, not merely exist at
// runtime. Every chat family declares `AiSdkChatResult`, not bare options.
expectAssignable<readonly TranslationWarning[]>(claude.toSdk("ai-sdk").warnings);
expectAssignable<readonly TranslationWarning[]>(gemini.toSdk("ai-sdk").warnings);
expectAssignable<readonly TranslationWarning[]>(gpt.toSdk("ai-sdk").warnings);
expectAssignable<readonly TranslationWarning[]>(routed.toSdk("ai-sdk").warnings);
expectAssignable<AiSdkChatResult>(claude.toSdk("ai-sdk"));

// The own-SDK targets still resolve to their own shapes.
expectAssignable<MessagesBody>(claude.toSdk("anthropic"));
expectAssignable<{ model: string }>(gemini.toSdk("google"));

// @ts-expect-error the zero-argument form is gone — a target is required
claude.toSdk();
// @ts-expect-error an endpoint offers only the targets it declares
claude.toSdk("openai");
// @ts-expect-error the AI SDK's video primitive is experimental; v1 declares no target
video({ model: "sora-2", prompt: "a cat" }).toSdk("ai-sdk");

// ---------------------------------------------------------------------------
// `.toApi` through the real public casts.
// ---------------------------------------------------------------------------

expectAssignable<{ model: "anthropic/claude-opus-5" | (string & {}) }>(claude.toApi("openrouter"));

// The `.`-vs-`-` version separator, at the type level. Anthropic spells this
// model `claude-opus-4-7`; OpenRouter and Vercel spell it
// `anthropic/claude-opus-4.7`. Until the id normalization collapsed
// digit-dot-digit, the two never joined, `ApiTargetsFor` resolved to `never`,
// and both lines below were compile errors reading "not assignable to
// parameter of type 'never'" — on models OpenRouter demonstrably serves.
const dottedClaude = anthropicChat({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
expectAssignable<{ model: "anthropic/claude-opus-4.7" | (string & {}) }>(
  dottedClaude.toApi("openrouter"),
);
expectAssignable<{ model: "anthropic/claude-opus-4.7" | (string & {}) }>(
  dottedClaude.toApi("vercel"),
);
// The alias-linked flagship pair resolves the same way.
expectAssignable<{ model: "anthropic/claude-haiku-4.5" | (string & {}) }>(
  anthropicChat({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "hi" }],
  }).toApi("openrouter"),
);
// @ts-expect-error openai does not serve Claude, per the generated availability data
claude.toApi("openai");
// @ts-expect-error factory-configured targets are out of the one-argument union
claude.toApi("amazon-bedrock");

// The composition story is a type-level contract, not a comment: a retargeted
// body is valid input to the target provider's own validator, which is how a
// caller opts into the catalog-aware layers `.toApi` deliberately skips.
expectAssignable<Parameters<typeof openrouterChat>[0]>(claude.toApi("openrouter"));
expectAssignable<"anthropic/claude-opus-5" | (string & {})>(
  openrouterChat(claude.toApi("openrouter")).model,
);
// …and the reverse crossing, which lands on Anthropic's own required shape.
expectAssignable<Parameters<typeof anthropicChat>[0]>(routed.toApi("anthropic"));
expectAssignable<number>(anthropicChat(routed.toApi("anthropic")).max_tokens);

// A retargeted result offers the TARGET dialect's SDK targets, and no second hop.
claude.toApi("openrouter").toSdk("openai");
// @ts-expect-error a chat-completions body has no anthropic SDK shape
claude.toApi("openrouter").toSdk("anthropic");
// A retarget INTO the gemini dialect must offer a target too: `DialectSdkTargets`
// resolving to `never` there made `toSdk` uncallable at the type level and gave
// JS callers a TypeError whose "Available:" list was blank.
const routedGemini = openrouterChat({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: "hi" }],
});
routedGemini.toApi("google").toSdk("google");
// @ts-expect-error a gemini body is not shaped for the OpenAI SDK
routedGemini.toApi("google").toSdk("openai");
// @ts-expect-error one hop only — a.toApi(x).toApi(y) is a.toApi(y)
claude.toApi("openrouter").toApi("vercel");

// ---------------------------------------------------------------------------
// `withJsonSchemaTools` — the dependency-free `jsonSchema()` adapter.
// ---------------------------------------------------------------------------

declare const brandedJsonSchema: (schema: Record<string, unknown>) => { brand: "ai" };

const wrapped = withJsonSchemaTools(claude.toSdk("ai-sdk"), brandedJsonSchema);
expectAssignable<AiSdkChatOptions["messages"]>(wrapped.messages);
expectAssignable<{ brand: "ai" } | undefined>(wrapped.tools?.["save_note"]?.inputSchema);
// The wrapper's return type flows through, so `ai`'s branded schema survives.
expectTrue<
  NonNullable<typeof wrapped.tools>[string]["inputSchema"] extends { brand: "ai" } ? true : false
>();

// ---------------------------------------------------------------------------
// `.toSdk(target)` on a RETARGETED result returns the target's real params
// object, not `unknown`.
//
// `unknown` made the library's own advertised flow — retarget, then hand the
// result to that SDK — a hard compile error at the last hop, so every call site
// needed an `as any` and threw away the validation it had just paid for. The
// result is keyed on the TARGET, not on the dialect: see `DialectSdkMap`.
// ---------------------------------------------------------------------------

// openai-chat arm: the SDK params ARE the wire body, model pinned to the target's spelling.
const oss = groqChat({
  model: "openai/gpt-oss-120b",
  messages: [{ role: "user", content: "hi" }],
});
const viaCerebras = oss.toApi("cerebras");
expectAssignable<"gpt-oss-120b" | (string & {})>(viaCerebras.toSdk("openai").model);
expectNotAny<ReturnType<typeof viaCerebras.toSdk<"openai">>>();
// @ts-expect-error `unknown` used to accept this; a real body has no such key.
viaCerebras.toSdk("openai").not_a_chat_completions_key;

// anthropic-messages arm.
const viaAnthropic = claude.toApi("anthropic");
expectAssignable<number>(viaAnthropic.toSdk("anthropic").max_tokens);
// @ts-expect-error camelCase is the SDK's spelling, not the wire's.
viaAnthropic.toSdk("anthropic").maxTokens;

// gemini arm: a real reshaping, `{ model, contents, config }`, matching what
// `geminiSdkParams` builds at runtime.
const viaGoogle = routedGemini.toApi("google");
expectAssignable<GenerateContentBody["contents"]>(viaGoogle.toSdk("google").contents);
expectAssignable<number | undefined>(viaGoogle.toSdk("google").config?.temperature);
// `generationConfig` is FLATTENED into `config` — the runtime spreads it, and
// the type now says so instead of `Record<string, unknown>`.
// @ts-expect-error the wire body's nesting does not survive into the SDK shape.
viaGoogle.toSdk("google").config?.generationConfig;
// `store` is deliberately not carried (no @google/genai equivalent).
// @ts-expect-error
viaGoogle.toSdk("google").config?.store;

// The degraded chat arm hands back the SAME gemini shape as a registered ref,
// because `ChatGeminiSdkParams` is now an alias of the retarget engine's type.
expectTrue<Equals<ChatGeminiSdkParams<"gemini-2.5-flash">, GeminiSdkParams<"gemini-2.5-flash">>>();
expectTrue<
  Equals<ChatGeminiSdkParams["contents"], GenerateContentBody["contents"]> extends true
    ? true
    : false
>();