/**
 * Type-level tests for the anthropic provider. Not executed by `bun test`
 * (the filename avoids the *.test.* pattern); checked by `bun run check`.
 * The @anthropic-ai/sdk package is a devDependency used exclusively here;
 * src/ never imports it (its bundled types drag node:* into dist d.ts).
 */
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";
import { messages } from "../../src/providers/anthropic";
import type { MessagesBody } from "../../src/providers/anthropic";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import { expectAssignable } from "./helpers";

const validated = messages({
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
const result = messages.safe({
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

const opus = messages({
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
const opusSafe = messages.safe({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
if (opusSafe.ok) {
  const routed = opusSafe.params.toApiSafe("openrouter");
  if (routed.ok) expectAssignable<string>(routed.params.request.url);
}

expectAssignable<EndpointConstraints[]>(messages.constraintsFor("claude-opus-5"));

// @ts-expect-error — max_tokens is required on the wire.
messages({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] });

// Model id autocomplete sanity: strict catalog ids and free-form strings both work.
expectAssignable<MessagesBody["model"]>("claude-opus-4-6");
expectAssignable<MessagesBody["model"]>("claude-future-model");
messages({ model: "claude-opus-4-6", max_tokens: 1, messages: [{ role: "user", content: "x" }] });
messages({ model: "claude-future-model", max_tokens: 1, messages: [{ role: "user", content: "x" }] });

messages({
  model: "claude-sonnet-4-5",
  max_tokens: 1,
  // @ts-expect-error — role must be "user" | "assistant".
  messages: [{ role: "system", content: "x" }],
});

messages({
  model: "claude-sonnet-4-5",
  max_tokens: 1,
  messages: [{ role: "user", content: "x" }],
  // @ts-expect-error — thinking "enabled" requires budget_tokens.
  thinking: { type: "enabled" },
});

messages({
  model: "claude-sonnet-4-5",
  max_tokens: 1,
  messages: [{ role: "user", content: "x" }],
  // @ts-expect-error — typo'd top-level keys are compile errors (ExactKeys).
  temprature: 0.2,
});

// `display` is accepted on both the enabled and adaptive thinking variants,
// and top-level cache_control (automatic prompt caching) is a GA body param.
messages({
  model: "claude-sonnet-4-5",
  max_tokens: 2048,
  messages: [{ role: "user", content: "x" }],
  thinking: { type: "enabled", budget_tokens: 1024, display: "omitted" },
  cache_control: { type: "ephemeral", ttl: "5m" },
});
messages({
  model: "claude-opus-5",
  max_tokens: 2048,
  messages: [{ role: "user", content: "x" }],
  thinking: { type: "adaptive", display: "summarized" },
});
