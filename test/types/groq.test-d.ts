/**
 * Type-level tests for the groq provider (OPENAI-COMPATIBLE CHAT overlay).
 * NOT run by `bun test` — this file is only type-checked (`bun run check` /
 * tsc --noEmit).
 *
 * This is a genuinely distinct code path from the per-endpoint casts the
 * other test-d files cover: the whole openai-compatible fleet (groq,
 * togetherai, cerebras, …) is produced by `createOpenAICompatible`, whose
 * `ExactKeys` guard lives once in the factory's return interface
 * (`OpenAICompatibleChat<ModelId>` in src/providers/openai-compatible/index.ts)
 * rather than in each overlay. One assertion here covers every overlay.
 */
import { chat, checkChat } from "../../src/providers/groq";
import type { GroqTextModelId } from "../../src/providers/groq";
import type { ChatFinishReason } from "../../src/providers/openai-compatible";
import type { ResponseReport } from "../../src/core/report";
import { chat as cerebrasChat } from "../../src/providers/cerebras";
import type { GroqAvailability } from "../../src/catalog/availability/groq.gen";
import { createOpenAICompatible } from "../../src/providers/openai-compatible";
import type {
  ChatCompletionsBodyBase,
  OpenAICompatibleChat,
  OpenAICompatibleCatalogOf,
  OpenAICompatibleProvider,
} from "../../src/providers/openai-compatible";
import { models as groqModels } from "../../src/catalog/groq.gen";
import type { GroqModelId } from "../../src/catalog/groq.gen";
import { availability } from "../../src/catalog/availability/groq.gen";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import {
  expectAssignable,
  expectNotAny,
  expectTrue,
  type HasLiteralMember,
  type IsNever,
  type KeyIn,
} from "./helpers";

function groqChatTypeTests(): void {
  // The overlay's `chat` IS the factory's interface, instantiated with the
  // provider's generated model union and its generated availability table —
  // the single assertion that ties this file to the factory rather than to
  // groq's own module.
  expectAssignable<OpenAICompatibleChat<GroqTextModelId, GroqAvailability>>(chat);

  const v = chat({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
      { role: "tool", content: "result", tool_call_id: "call_1" },
    ],
    max_completion_tokens: 256,
    temperature: 0.2,
    top_p: 0.9,
    stop: ["\n\n"],
    stream: true,
    stream_options: { include_usage: true },
    response_format: { type: "json_object" },
    tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
    tool_choice: "auto",
    parallel_tool_calls: false,
  });

  // The dialect strips nothing: the params object IS the wire body, so every
  // key survives with its literal type intact.
  expectAssignable<"llama-3.3-70b-versatile">(v.model);
  expectAssignable<number>(v.temperature);
  expectAssignable<number>(v.max_completion_tokens);
  expectAssignable<ChatCompletionsBodyBase>(v);
  expectTrue<IsNever<KeyIn<typeof v, "notAParam">>>();
  expectAssignable<string>(JSON.stringify(v));

  // `.request` and `.toSdk("openai")` stay typed; toSdk is the identity
  // re-shape, and its one target is "openai" for the whole fleet — you call
  // Groq with `new OpenAI({ baseURL })` (or groq-sdk, a fork of it with the
  // same param shape), never with a package named after the catalog id.
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  expectAssignable<Record<string, string>>(v.request.headers);
  expectAssignable<"llama-3.3-70b-versatile">(v.toSdk("openai").model);
  // @ts-expect-error the zero-arg .toSdk() form was removed — name the target
  v.toSdk();
  // @ts-expect-error the fleet's SDK shape is OpenAI's, not a per-overlay id
  v.toSdk("groq");

  // `.toApi(provider)`: the same-dialect fleet hop, which is 90.4% of every
  // retarget edge in the generated data. The union comes from groq's own
  // availability table, so it is exactly the providers that serve THIS model.
  const oss = chat({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "hi" }] });
  const viaCerebras = oss.toApi("cerebras");
  // The body is the target's dialect (unchanged here) carrying the TARGET's
  // spelling of the model id — `gpt-oss-120b`, not `openai/gpt-oss-120b`.
  expectAssignable<"gpt-oss-120b" | (string & {})>(viaCerebras.model);
  expectAssignable<ChatCompletionsBodyBase>(viaCerebras);
  expectAssignable<string>(viaCerebras.request.url);
  expectAssignable<"cerebras">(viaCerebras.target);
  expectAssignable<number>(viaCerebras.warnings.length);
  // Its `toSdk` union is the TARGET dialect's — the same "openai" the source
  // offers here, since both ends speak chat-completions.
  viaCerebras.toSdk("openai");
  // @ts-expect-error a chat-completions body has no anthropic SDK shape
  viaCerebras.toSdk("anthropic");
  oss.toApi("openrouter");
  oss.toApi("togetherai");

  // The composition escape hatch (retarget, then re-validate against the
  // target's own catalog) is a type-level contract, not a comment: a
  // retargeted body IS structurally valid input to the target's validator.
  expectAssignable<Parameters<typeof cerebrasChat>[0]>(viaCerebras);
  // …and the plain call compiles too, which is the point: `ExactKeys` exempts
  // the result's non-enumerable members (`request` / `toSdk` / `target` /
  // `warnings`), so the documented idiom is one line rather than a destructure.
  // At runtime nothing changes — those members were never enumerable, so the
  // validator has always seen exactly the wire body.
  expectAssignable<"gpt-oss-120b" | (string & {})>(cerebrasChat(viaCerebras).model);
  // Destructuring still works, for callers who want the wire body by itself.
  const { request, toSdk, target, warnings, ...retargetedBody } = viaCerebras;
  expectAssignable<"gpt-oss-120b" | (string & {})>(cerebrasChat(retargetedBody).model);
  expectAssignable<string>(request.url);
  expectAssignable<"cerebras">(target);
  expectAssignable<number>(warnings.length);
  expectAssignable<(t: "openai") => unknown>(toSdk);

  // @ts-expect-error a retargeted result has no `.toApi` — one hop only
  viaCerebras.toApi("openrouter");
  // groq is the source, and it is a valid target too: a provider serves its
  // own models, so this is the identity retarget — the same body at the same
  // URL, which is what lets a provider-generic call site pass any target.
  const viaGroq = oss.toApi("groq");
  expectAssignable<"openai/gpt-oss-120b" | (string & {})>(viaGroq.model);
  expectAssignable<"groq">(viaGroq.target);
  // @ts-expect-error anthropic does not serve gpt-oss
  oss.toApi("anthropic");
  // @ts-expect-error amazon-bedrock serves it, but needs a region `.toApi` never got
  oss.toApi("amazon-bedrock");
  // @ts-expect-error google-vertex serves it (on its MaaS surface) but needs project + location
  oss.toApi("google-vertex");
  // @ts-expect-error not a catalog provider id
  oss.toApi("cerebras-ai");

  // A model the availability table has not caught up on degrades to the
  // permissive arm — runtime-checked, because an unknown model is a warning
  // everywhere else in this library, not an error. (Every model in groq's
  // *catalog* is in its availability table now, since each carries at least
  // its own identity target, so this has to be a genuinely future id.)
  const unlisted = chat({ model: "llama-4.9-99b-future", messages: [] as never });
  unlisted.toApi("openrouter");
  // …but still not a factory target, and still not a made-up id.
  // @ts-expect-error factory targets stay out of the one-arg union
  unlisted.toApi("azure");

  // The factory's ModelId generic narrows `model` to THIS provider's catalog…
  expectAssignable<GroqTextModelId>("openai/gpt-oss-120b");
  // @ts-expect-error not a Groq text model id
  expectAssignable<GroqTextModelId>("gpt-5.2");
  // …while unknown ids still type-check through the (string & {}) escape.
  chat({ model: "llama-4-unreleased", messages: [{ role: "user", content: "hi" }] });

  // safe() narrows to the same Validated shape.
  const result = chat.safe({
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: "hi" }],
  });
  if (result.ok) {
    expectAssignable<"openai/gpt-oss-20b">(result.params.model);
    expectAssignable<string>(result.params.request.url);
  }

  expectAssignable<EndpointConstraints[]>(chat.constraintsFor("llama-3.3-70b-versatile"));

  chat({
    model: "llama-3.3-70b-versatile",
    // @ts-expect-error role must be one of the dialect's six message roles
    messages: [{ role: "human", content: "hi" }],
  });

  // ExactKeys: a typo'd/excess top-level key is a COMPILE error, not a
  // silent unknown_param warning. This guard lives in the FACTORY's return
  // interface, so this assertion protects every openai-compatible overlay.
  chat({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "hi" }],
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    temprature: 0.2,
  });

  // The same guard is wired into the factory's safe() overload.
  chat.safe({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "hi" }],
    // @ts-expect-error excess (typo'd) top-level key — ExactKeys on safe()
    max_tokens_completion: 128,
  });
}

/**
 * `checkChat`'s report reaches the caller NARROWED — through the factory.
 *
 * This is the assertion that protects the whole ~30-provider fleet, and it is
 * here rather than in a core test because the failure mode is specific to the
 * factory: `OpenAICompatibleProvider.checkChat` RE-ANNOTATES the member that
 * `createOpenAICompatible` fills from `createCheckChat`. Writing the wide
 * `(res: ChatCompletionLike) => ResponseReport` there type-checks perfectly
 * and silently discards the narrowed `finishReason` for every overlay at once
 * — groq's completion list measured 5 with the narrow annotation and 0 with
 * the wide one. Narrowing check.ts alone is not enough.
 */
function groqReportTypeTests(): void {
  const report = checkChat({ choices: [{ finish_reason: "stop" }] });

  // `HasLiteralMember`, not an equality check: a `(string & {})`-tailed union
  // and bare `string` are mutually assignable, so an equality check passes
  // even against a fully widened type (see the helper's doc).
  expectTrue<HasLiteralMember<typeof report.finishReason, "tool_calls">>();
  expectTrue<HasLiteralMember<typeof report.finishReason, "content_filter">>();
  expectTrue<HasLiteralMember<ChatFinishReason, "length">>();
  if (report.finishReason === "tool_calls") void 0;
  if (report.finishReason === "content_filter") void 0;

  // Backward compatible: a narrowed report is still a `ResponseReport`.
  const wide: ResponseReport = report;
  void wide;

  // Tail-open by convention — this dialect is spoken by ~30 third-party hosts
  // that each add their own finish reasons, and the checker refuses none of
  // them.
  const vendorSpecific: ChatFinishReason = "tool_use";
  void vendorSpecific;
}

/**
 * The factory's `catalog` parameter preserves the generated catalog's literal
 * types instead of erasing them at the boundary.
 *
 * Every generated catalog is `as const satisfies Record<string, ModelInfo>` —
 * literal keys, literal capability flags, literal limits — and the config's
 * `catalog: Record<string, ModelInfo>` annotation used to discard all of it
 * the moment it crossed into the factory. THAT, not catalog size, is what
 * blocked per-model narrowing for the whole ~30-provider fleet: the factory
 * never saw which model had which capability, so the model union had to be
 * supplied separately as an explicit type argument.
 *
 * This asserts the plumbing only. Nothing here turns a capability flag into a
 * compile error, and nothing should until the rows behind it are audited —
 * models.dev's aggregator rows are not (66 of openrouter's 349 carry
 * `toolCall: false`, some of them wrongly), so gating on them would refuse
 * requests that work.
 */
function openAICompatibleCatalogTypeTests(): void {
  // Opting in = naming the fourth type argument. `Catalog` is inferred-shaped
  // and `const`, but TypeScript fills a trailing parameter from its DEFAULT
  // once any type argument is written explicitly, and all 33 call sites write
  // three — which is exactly why this change touched none of them.
  const narrow = createOpenAICompatible<
    GroqTextModelId,
    typeof availability,
    "groq",
    typeof groqModels
  >({
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    catalog: groqModels,
    availability,
  });

  type Catalog = OpenAICompatibleCatalogOf<typeof narrow>;

  // The derived model-id union. This was `string` before — the single fact
  // that made per-model narrowing impossible from inside the factory.
  expectTrue<SameType<keyof Catalog, GroqModelId>>();
  expectNotAny<keyof Catalog>();
  expectTrue<SameType<SameType<keyof Catalog, string>, false>>();

  // Per-model capability flags and limits survive as literals, not `boolean`
  // and `number` — the raw material a future per-dialect arm needs.
  expectTrue<SameType<Catalog["llama-3.3-70b-versatile"]["toolCall"], true>>();
  expectTrue<SameType<Catalog["allam-2-7b"]["toolCall"], false>>();
  expectTrue<SameType<Catalog["llama-3.3-70b-versatile"]["limit"]["context"], 131072>>();

  // BACKWARD COMPATIBILITY, pinned: the three-argument form every overlay
  // actually writes still compiles and still gets the wide default. If this
  // ever stopped being true, the new parameter would be a breaking change to
  // 33 call sites at once.
  const wide = createOpenAICompatible<GroqTextModelId, typeof availability, "groq">({
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    catalog: groqModels,
    availability,
  });
  expectTrue<SameType<keyof OpenAICompatibleCatalogOf<typeof wide>, string>>();

  // …and the narrowed provider is still assignable to the wide interface, so
  // `AzureProvider`-style aliases keep working.
  expectAssignable<OpenAICompatibleProvider<GroqTextModelId, typeof availability, "groq">>(narrow);
}

/** Local structural-equality probe. */
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export { groqChatTypeTests, groqReportTypeTests, openAICompatibleCatalogTypeTests };
