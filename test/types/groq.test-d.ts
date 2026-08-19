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
import { chat } from "../../src/providers/groq";
import type { GroqTextModelId } from "../../src/providers/groq";
import { chat as cerebrasChat } from "../../src/providers/cerebras";
import type { GroqAvailability } from "../../src/catalog/availability/groq.gen";
import type {
  ChatCompletionsBodyBase,
  OpenAICompatibleChat,
} from "../../src/providers/openai-compatible";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

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

  // `.toApi(provider)`: the same-dialect fleet hop, which is 84.8% of every
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
  // @ts-expect-error groq is the source; its own table never names it
  oss.toApi("groq");
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
  // everywhere else in this library, not an error.
  const unlisted = chat({ model: "llama-3.3-70b-versatile", messages: [] as never });
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

export { groqChatTypeTests };
