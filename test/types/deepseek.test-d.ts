/**
 * Type-level tests for the deepseek provider. NOT run by `bun test` — this
 * file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * `deepseek.chat` is composed around its own wire leaf rather than built by
 * `createOpenAICompatible`, so the fleet assertion in ./groq.test-d.ts does
 * not cover it: what DeepSeek documents beyond the dialect — `thinking`,
 * `user_id`, `safety_check`, `title`, its `reasoning_effort` values and its
 * content parts — is pinned here, on both `chat()` and `ChatBody`.
 */
import { chat, checkChat, type ChatFinishReason } from "../../src/providers/deepseek";
import type { ChatBody, ChatUserContentPart } from "../../src/providers/deepseek/types";
import type { ChatCompletionsBodyBase } from "../../src/providers/openai-compatible";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

function deepseekChatTypeTests(): void {
  const hi = [{ role: "user" as const, content: "hi" }];

  // DeepSeek's top-level extensions compile, on the validator and on ChatBody.
  const v = chat({
    model: "deepseek-flash",
    messages: hi,
    thinking: { type: "disabled" },
    user_id: "user_123",
    safety_check: { level: "high" },
    title: { enabled: true },
    reasoning_effort: "max",
  });
  expectAssignable<"deepseek-flash">(v.model);
  expectAssignable<{ type: "disabled" }>(v.thinking);
  expectTrue<IsNever<KeyIn<typeof v, "notAParam">>>();
  ({
    model: "deepseek-v4-pro",
    messages: hi,
    thinking: null,
    user_id: null,
    safety_check: { level: "low" },
    title: { enabled: false },
  }) satisfies ChatBody;

  // @ts-expect-error — `thinking.type` is "enabled" | "disabled"
  chat({ model: "deepseek-flash", messages: hi, thinking: { type: "off" } });
  // @ts-expect-error — `safety_check.level` is "low" | "high"
  chat({ model: "deepseek-flash", messages: hi, safety_check: { level: "max" } });
  // @ts-expect-error — `title` is an object, not a boolean
  chat({ model: "deepseek-flash", messages: hi, title: true });

  // `reasoning_effort` is DeepSeek's set: none/low/high/max, the compatibility
  // aliases, and the thinking guide's `ultra`.
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", null] as const) {
    chat({ model: "deepseek-flash", messages: hi, reasoning_effort: effort });
  }
  // @ts-expect-error — not a DeepSeek effort
  chat({ model: "deepseek-flash", messages: hi, reasoning_effort: "maximum" });

  // Content parts: `detail: "original"`, the flat `file` part, and images in
  // system and tool messages.
  const parts: ChatUserContentPart[] = [
    { type: "text", text: "describe" },
    { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "original" } },
    { type: "file", file_id: "file-api-1" },
    { type: "file", file_data: "data:image/png;base64,AAAA", filename: "a.png" },
  ];
  chat({
    model: "deepseek-flash",
    messages: [
      { role: "system", content: parts },
      { role: "user", content: parts },
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: parts },
    ],
  });
  // @ts-expect-error — DeepSeek's file part is flat; the nested `file` object is OpenAI's
  const nested: ChatUserContentPart = { type: "file", file: { file_id: "file-api-1" } };
  // @ts-expect-error — DeepSeek documents no audio part
  const audio: ChatUserContentPart = { type: "input_audio", input_audio: { data: "AAAA", format: "wav" } };
  void nested;
  void audio;
  chat({
    model: "deepseek-flash",
    // @ts-expect-error — assistant messages take no image parts
    messages: [...hi, { role: "assistant", content: [{ type: "image_url", image_url: { url: "x" } }] }],
  });

  // The registry result kind stays on the dialect body: `unmodel/chat`
  // compiles that, and a deepseek result is still one.
  expectAssignable<ChatCompletionsBodyBase>(chat({ model: "deepseek-flash", messages: hi }));

  // checkChat's finish reasons complete DeepSeek's two interruptions.
  const report = checkChat({ model: "deepseek-flash", choices: [{ finish_reason: "aborted" }] });
  expectAssignable<ChatFinishReason | undefined>(report.finishReason);
  expectAssignable<ChatFinishReason>("insufficient_system_resource");
  expectAssignable<ChatFinishReason>("aborted");
}

export { deepseekChatTypeTests };
