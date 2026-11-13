/**
 * Type-level tests for `unmodel/cohere`. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit).
 *
 * What is pinned here is the SDK handoff. `chat(...).toSdk("cohere")` returned
 * `Record<string, unknown>` — the only `toSdk` in the library that was a bag —
 * so the params you hand to `client.v2.chat()` completed nothing, every read
 * was `unknown`, and `sdk.maxTokenz` produced no diagnostic at all. The shape
 * is hand-mirrored from `cohere-ai`'s `V2ChatRequest` (the package is not a
 * dependency, so assignability against the real SDK is not compiler-checked);
 * these assertions are what keeps the transcription honest about the shape
 * `toSdkParams` actually builds.
 */
import { chat } from "../../src/providers/cohere";
import type {
  ChatBody,
  CohereChatModelId,
  CohereModelId,
  CohereSdkMessage,
  CohereTextModelId,
  CohereV2ChatRequest,
} from "../../src/providers/cohere";
import { expectAssignable, expectTrue } from "./helpers";

function cohereSdkTypeTests(): void {
  const v = chat({
    model: "command-a-03-2025",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    stop_sequences: ["END"],
    strict_tools: true,
    frequency_penalty: 0.1,
    thinking: { type: "enabled", token_budget: 1024 },
  });

  const sdk = v.toSdk("cohere");
  expectAssignable<CohereV2ChatRequest>(sdk);
  expectAssignable<number | undefined>(sdk.maxTokens);
  expectAssignable<string[] | undefined>(sdk.stopSequences);
  expectAssignable<boolean | undefined>(sdk.strictTools);
  expectAssignable<number | undefined>(sdk.frequencyPenalty);
  expectAssignable<CohereSdkMessage[]>(sdk.messages);

  // The rename is in the type, not just the runtime: the wire spelling is gone.
  // @ts-expect-error — `max_tokens` is the wire key; the SDK takes `maxTokens`.
  sdk.max_tokens;
  // @ts-expect-error — and a typo now suggests the right key instead of `unknown`.
  sdk.maxTokenz;

  // The nested renames are typed too, which is where a hand-written mirror
  // usually drifts first.
  const message = sdk.messages[0];
  if (message !== undefined && message.role === "assistant") {
    expectAssignable<string | undefined>(message.toolPlan);
    // @ts-expect-error — `tool_plan` is the wire spelling.
    message.tool_plan;
  }
  if (message !== undefined && message.role === "tool") {
    expectAssignable<string>(message.toolCallId);
    // @ts-expect-error — `tool_call_id` is the wire spelling.
    message.tool_call_id;
  }
}

// The ids `cohere.chat` completes are the overlay's, not models.dev's: Cohere's
// own `north-small-translate-1.0` and `north-mini-code-1.0` replace the
// generated `north-small-translate-09-2026` and `north-mini-code-1-0`. Pinned
// whole, so a regen that moves an id in or out surfaces here.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
expectTrue<
  Equals<
    CohereChatModelId,
    | "c4ai-aya-expanse-32b"
    | "c4ai-aya-vision-32b"
    | "command-a-03-2025"
    | "command-a-plus-05-2026"
    | "command-a-reasoning-08-2025"
    | "command-a-translate-08-2025"
    | "command-a-vision-07-2025"
    | "command-r-08-2024"
    | "command-r-plus-08-2024"
    | "command-r7b-12-2024"
    | "command-r7b-arabic-02-2025"
    | "north-mini-code-1.0"
    | "north-small-translate-1.0"
    | "tiny-aya-earth"
    | "tiny-aya-fire"
    | "tiny-aya-global"
    | "tiny-aya-water"
  >
>();
expectTrue<Equals<ChatBody["model"], CohereChatModelId | (string & {})>>();

// The models.dev unions stay exported beside `CohereChatModelId`, and their
// JSDoc names every id in them that `cohere.chat` does not know. Pinned
// exactly, so an id joining or leaving that set fails here before the doc
// goes stale.
expectTrue<
  Equals<Exclude<CohereTextModelId, CohereChatModelId>, "north-mini-code-1-0" | "north-small-translate-09-2026">
>();
expectTrue<
  Equals<Exclude<CohereModelId, CohereChatModelId>, "north-mini-code-1-0" | "north-small-translate-09-2026">
>();

export { cohereSdkTypeTests };
