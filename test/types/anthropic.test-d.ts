/**
 * Type-level tests for the anthropic provider. Not executed by `bun test`
 * (the filename avoids the *.test.* pattern); checked by `bun run check`.
 * The @anthropic-ai/sdk package is a devDependency used exclusively here;
 * src/ never imports it (its bundled types drag node:* into dist d.ts).
 */
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";
import { chat, checkChat } from "../../src/providers/anthropic";
import type { AnthropicStopReason, MessagesBody } from "../../src/providers/anthropic";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import type { ModelsWhereFalse } from "../../src/core/catalog-types";
import { models as anthropicModels } from "../../src/catalog/anthropic.gen";
import { chatConstraints as anthropicChatConstraints } from "../../src/providers/anthropic/constraints";
import type { ResponseReport } from "../../src/core/report";
import { expectAssignable, expectTrue, type HasLiteralMember } from "./helpers";

const validated = chat({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});

// The enumerable body doubles as SDK params. toSdk("anthropic") is typed as
// the wire body (identity); its SDK assignability is asserted HERE, and only
// here — src/ never imports @anthropic-ai/sdk.
expectAssignable<MessageCreateParams>(validated);
expectAssignable<MessageCreateParams>(validated.toSdk("anthropic"));

// The zero-arg form is gone: every target is named.
// @ts-expect-error — `.toSdk()` no longer exists.
validated.toSdk();
// @ts-expect-error — this endpoint declares "anthropic", not "openai".
validated.toSdk("openai");

// The caller's literal params type is preserved on the validated value.
expectAssignable<number>(validated.max_tokens);
expectAssignable<string>(validated.request.url);

// safe() narrows to the same Validated shape.
const result = chat.safe({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
if (result.ok) expectAssignable<MessageCreateParams>(result.params.toSdk("anthropic"));

// ---------------------------------------------------------------------------
// `.toApi(provider)` — the union is the model's own availability, end to end
// through the public cast (test/types/retarget.test-d.ts asserts the same
// properties against the mechanism in isolation).
// ---------------------------------------------------------------------------

const opus = chat({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});

// OpenRouter and the Vercel AI Gateway serve Claude; OpenAI and Groq do not.
opus.toApi("openrouter");
opus.toApi("vercel");
// @ts-expect-error — openai does not serve "claude-opus-5".
opus.toApi("openai");
// @ts-expect-error — groq does not serve "claude-opus-5".
opus.toApi("groq");
// @ts-expect-error — factory targets need config a one-arg call never had.
opus.toApi("amazon-bedrock");

// The retargeted body is the TARGET's dialect, and does not offer a second hop.
expectAssignable<"anthropic/claude-opus-5" | (string & {})>(opus.toApi("openrouter").model);
// @ts-expect-error — one hop only.
opus.toApi("openrouter").toApi("groq");

// safe() results carry the same retarget surface.
const opusSafe = chat.safe({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
if (opusSafe.ok) {
  const routed = opusSafe.params.toApiSafe("openrouter");
  if (routed.ok) expectAssignable<string>(routed.params.request.url);
}

expectAssignable<EndpointConstraints[]>(chat.constraintsFor("claude-opus-5"));

// @ts-expect-error — max_tokens is required on the wire.
chat({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] });

// Model id autocomplete sanity: strict catalog ids and free-form strings both work.
expectAssignable<MessagesBody["model"]>("claude-opus-4-6");
expectAssignable<MessagesBody["model"]>("claude-future-model");
chat({ model: "claude-opus-4-6", max_tokens: 1, messages: [{ role: "user", content: "x" }] });
chat({ model: "claude-future-model", max_tokens: 1, messages: [{ role: "user", content: "x" }] });

chat({
  model: "claude-sonnet-4-5",
  max_tokens: 1,
  // @ts-expect-error — role must be "user" | "assistant".
  messages: [{ role: "system", content: "x" }],
});

chat({
  model: "claude-sonnet-4-5",
  max_tokens: 1,
  messages: [{ role: "user", content: "x" }],
  // @ts-expect-error — thinking "enabled" requires budget_tokens.
  thinking: { type: "enabled" },
});

chat({
  model: "claude-sonnet-4-5",
  max_tokens: 1,
  messages: [{ role: "user", content: "x" }],
  // @ts-expect-error — typo'd top-level keys are compile errors (ExactKeys).
  temprature: 0.2,
});

// `display` is accepted on both the enabled and adaptive thinking variants,
// and top-level cache_control (automatic prompt caching) is a GA body param.
chat({
  model: "claude-sonnet-4-5",
  max_tokens: 2048,
  messages: [{ role: "user", content: "x" }],
  thinking: { type: "enabled", budget_tokens: 1024, display: "omitted" },
  cache_control: { type: "ephemeral", ttl: "5m" },
});
chat({
  model: "claude-opus-5",
  max_tokens: 2048,
  messages: [{ role: "user", content: "x" }],
  thinking: { type: "adaptive", display: "summarized" },
});

// ---------------------------------------------------------------------------
// `checkChat`'s report: `finishReason` carries anthropic's own stop reasons
// ---------------------------------------------------------------------------

declare const runtimeReason: string;

function anthropicReportTypeTests(): void {
  const report = checkChat({ stop_reason: "end_turn" });

  // The report is narrowed to anthropic's vocabulary, so the value every
  // caller branches on compares against its own literals.
  //
  // `HasLiteralMember`, not an equality check: a `(string & {})`-tailed union
  // and bare `string` are MUTUALLY ASSIGNABLE, so a two-way `extends` test
  // passes even against a fully widened type. The exact completion list is
  // pinned by `test/unified/completions.test.ts`, which asks the language
  // service — the only thing that can see a completion list die.
  expectTrue<HasLiteralMember<typeof report.finishReason, "end_turn">>();
  expectTrue<HasLiteralMember<typeof report.finishReason, "model_context_window_exceeded">>();
  expectTrue<HasLiteralMember<AnthropicStopReason, "refusal">>();
  if (report.finishReason === "tool_use") void 0;
  if (report.finishReason === "pause_turn") void 0;
  if (report.finishReason === "model_context_window_exceeded") void 0;

  // BACKWARD COMPATIBILITY. The `Reason` parameter DEFAULTS to `string`, and
  // these three are the whole reason that default is not decoration: a
  // narrowed report must stay usable everywhere a bare one was. If any of them
  // ever fails, the generic became a breaking change.
  const asString: string | undefined = report.finishReason;
  void asString;
  const asWideReport: ResponseReport = report;
  void asWideReport;
  const takesWideReport = (_rep: ResponseReport): void => {};
  takesWideReport(report);

  // …and comparing against a run-time string still compiles, which a closed
  // union would forbid.
  void (report.finishReason === runtimeReason);

  // THE `(string & {})` TAIL, pinned. This checker never refuses an off-list
  // stop reason — it passes `response.stop_reason` straight through — so a
  // reason Anthropic ships tomorrow must stay both assignable and comparable.
  // The deliberate price is that the tail cannot catch a typo either: the line
  // below is NOT an error, and must not be "fixed" by dropping the tail unless
  // the checker starts rejecting unknown stop reasons. See the tail decision
  // recorded on `AssemblyaiTranscriptStatus` in
  // src/providers/assemblyai/check.ts.
  const shipped: AnthropicStopReason = "some_reason_shipped_after_this_release";
  void shipped;
  void (report.finishReason === "end_tuurn");
}

void anthropicReportTypeTests;

// ---------------------------------------------------------------------------
// Tier A: three per-model facts, moved from call time to compile time
//
// Each of the three is something `chat.safe` already refuses at run time
// (src/providers/anthropic/chat.test.ts asserts all three); what is new is that
// the editor refuses it first. The keying is DERIVED — `top_k` off the deny
// table, `temperature` off the catalog flag — so the union below is the guard
// that makes a catalog regen visible: if `bun run codegen` flips a flag, this
// file stops compiling instead of a caller's code silently breaking.
// ---------------------------------------------------------------------------

/** Exact type equality (invariant both ways), for asserting resolved unions. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

declare const runtimeModel: string;

/** The resolved fixed-sampling generation, pinned. */
type FixedSampling = ModelsWhereFalse<typeof anthropicModels, "temperature">;
expectTrue<
  Equals<
    FixedSampling,
    | "claude-fable-5"
    | "claude-fable-5-1"
    | "claude-opus-4-7"
    | "claude-opus-4-8"
    | "claude-opus-5"
    | "claude-sonnet-5"
  >
>();
/** …and the deny table resolves to exactly the same six ids. */
expectTrue<Equals<FixedSampling, Extract<keyof typeof anthropicChatConstraints, string>>>();

function anthropicPerModelTypeTests(): void {
  // The default is the only accepted temperature on this generation…
  chat({ model: "claude-opus-5", max_tokens: 16, messages: [], temperature: 1 });
  // …and the previous generation is untouched.
  chat({ model: "claude-sonnet-4-5", max_tokens: 16, messages: [], temperature: 0.7, top_k: 40 });

  // @ts-expect-error — `unsupported_param` at call time; a compile error now.
  chat({ model: "claude-opus-5", max_tokens: 16, messages: [], temperature: 0.7 });
  // @ts-expect-error — `top_k` returns a 400 on this generation, at any value.
  chat({ model: "claude-opus-5", max_tokens: 16, messages: [], top_k: 40 });
  // @ts-expect-error — fable-5 always thinks; `disabled` is excluded.
  chat({ model: "claude-fable-5", max_tokens: 16, messages: [], thinking: { type: "disabled" } });

  // @ts-expect-error — fable-5.1 always thinks too.
  chat({ model: "claude-fable-5-1", max_tokens: 16, messages: [], thinking: { type: "disabled" } });
  // @ts-expect-error — fable-5.1 removed forced tool use; any/tool return a 400.
  chat({ model: "claude-fable-5-1", max_tokens: 16, messages: [], tool_choice: { type: "any" } });

  // …while the unforced choices stay, and the previous release is untouched.
  chat({ model: "claude-fable-5-1", max_tokens: 16, messages: [], tool_choice: { type: "auto" } });
  chat({ model: "claude-fable-5", max_tokens: 16, messages: [], tool_choice: { type: "any" } });

  // The other two thinking modes stay, on fable-5 and everywhere else.
  chat({ model: "claude-fable-5", max_tokens: 16, messages: [], thinking: { type: "adaptive" } });
  chat({
    model: "claude-opus-4-5",
    max_tokens: 16,
    messages: [],
    thinking: { type: "disabled" },
  });

  // `top_p` is NOT narrowed — the rule is `>= 0.99`, and a numeric lower bound
  // has no honest literal type; `0.99 | 1` would refuse documented values.
  chat({ model: "claude-opus-5", max_tokens: 16, messages: [], top_p: 0.995 });

  // Degraded arms stay callable: a model id that only exists at run time, and
  // a model released after this build.
  chat({ model: runtimeModel, max_tokens: 16, messages: [], temperature: 0.7, top_k: 40 });
  chat({ model: "claude-opus-9", max_tokens: 16, messages: [], temperature: 0.7, top_k: 40 });

  // A ref union distributes rather than collapsing to `never`.
  const branch = Math.random() > 0.5 ? ("claude-opus-5" as const) : ("claude-sonnet-4-5" as const);
  chat({ model: branch, max_tokens: 16, messages: [] });

  // The literal still reaches the result — the arm must not eat it.
  const v = chat({ model: "claude-opus-5", max_tokens: 16, messages: [] });
  expectAssignable<"claude-opus-5">(v.model);
  expectAssignable<MessageCreateParams>(v.toSdk("anthropic"));
}

void anthropicPerModelTypeTests;
