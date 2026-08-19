import { describe, expect, test } from "bun:test";

import { createAiSdkChat, toAiSdkChat, aiSdkProviderKey } from "./ai-sdk";
import type { ChatIR } from "./ir";
import type { TranslationWarning, Warn } from "./warnings";
import { createWarningSink } from "./warnings";

function ir(partial: Partial<ChatIR> = {}): ChatIR {
  return {
    source: "anthropic-messages",
    model: "claude-opus-5",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    settings: {},
    ...partial,
  };
}

function decode(
  input: ChatIR,
  provider = "anthropic",
): { options: ReturnType<typeof toAiSdkChat>; warnings: TranslationWarning[] } {
  const sink = createWarningSink("anthropic.messages", "ai-sdk");
  const options = toAiSdkChat(input, { provider, endpoint: "anthropic.messages" }, sink.warn as Warn);
  return { options, warnings: sink.warnings };
}

describe("shape", () => {
  test("emits `messages` and never `model`, `prompt` or `instructions`", () => {
    const { options } = decode(ir({ system: [{ text: "Be terse." }] }));

    expect(Object.keys(options)).toEqual(["messages"]);
    expect(options.messages).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  test("joins multiple system blocks into the one system message the SDK takes", () => {
    const { options } = decode(ir({ system: [{ text: "Be terse." }, { text: "Cite sources." }] }));

    expect(options.messages[0]).toEqual({ role: "system", content: "Be terse.\n\nCite sources." });
  });

  test("media becomes a file part with `mediaType`, not the legacy image part", () => {
    const { options } = decode(
      ir({
        messages: [
          {
            role: "user",
            content: [
              { type: "media", mediaType: "image/png", data: { kind: "base64", base64: "iVBOR" } },
              { type: "media", data: { kind: "url", url: "https://example.com/a.pdf" }, filename: "a.pdf" },
            ],
          },
        ],
      }),
    );

    expect(options.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "file", mediaType: "image/png", data: "iVBOR" },
        { type: "file", mediaType: "application/pdf", data: "https://example.com/a.pdf", filename: "a.pdf" },
      ],
    });
  });

  test("a provider file handle is dropped and named — file-id namespaces do not travel", () => {
    const { options, warnings } = decode(
      ir({
        messages: [
          {
            role: "user",
            content: [{ type: "media", data: { kind: "file", dialect: "anthropic-messages", ref: "file_123" } }],
          },
        ],
      }),
    );

    expect(options.messages).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
    expect(warnings[0]?.message).toContain("file_123");
  });
});

describe("tools", () => {
  const toolIR = ir({
    tools: [
      {
        kind: "function",
        name: "get_weather",
        description: "Look up the weather.",
        parameters: { type: "object", properties: { location: { type: "string" } } },
      },
    ],
    toolChoice: { mode: "tool", name: "get_weather" },
  });

  test("tools are a record keyed by name, carrying plain JSON Schema", () => {
    const { options } = decode(toolIR);

    expect(options.tools).toEqual({
      get_weather: {
        description: "Look up the weather.",
        inputSchema: { type: "object", properties: { location: { type: "string" } } },
      },
    });
    expect(options.toolChoice).toEqual({ type: "tool", toolName: "get_weather" });
  });

  test("tool-call input stays an OBJECT — the classic bug when adapting from OpenAI chat", () => {
    const { options } = decode(
      ir({
        messages: [
          {
            role: "assistant",
            content: [{ type: "tool-call", id: "call_1", name: "get_weather", input: { location: "Paris" } }],
          },
        ],
      }),
    );

    expect(options.messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { location: "Paris" } },
      ],
    });
  });

  test("tool results become a tool-role message with the SDK's discriminated output union", () => {
    const { options } = decode(
      ir({
        messages: [
          {
            role: "user",
            content: [
              { type: "tool-result", id: "call_1", name: "get_weather", output: { kind: "text", text: "18C" } },
              { type: "tool-result", id: "call_2", name: "lookup", output: { kind: "json", value: { ok: true } } },
              { type: "tool-result", id: "call_3", name: "boom", output: { kind: "text", text: "503" }, isError: true },
              { type: "text", text: "and now?" },
            ],
          },
        ],
      }),
    );

    expect(options.messages).toEqual([
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_1", toolName: "get_weather", output: { type: "text", value: "18C" } },
          { type: "tool-result", toolCallId: "call_2", toolName: "lookup", output: { type: "json", value: { ok: true } } },
          { type: "tool-result", toolCallId: "call_3", toolName: "boom", output: { type: "error-text", value: "503" } },
        ],
      },
      { role: "user", content: [{ type: "text", text: "and now?" }] },
    ]);
  });

  test("a provider-defined tool is dropped by name — there is no portable ToolSet form", () => {
    const { options, warnings } = decode(
      ir({ nativeTools: [{ kind: "native", dialect: "anthropic-messages", name: "web_search", raw: {} }] }),
    );

    expect(options.tools).toBeUndefined();
    expect(warnings.map((w) => w.code)).toEqual(["dropped_tool"]);
    expect(warnings[0]?.message).toContain("web_search");
  });
});

describe("settings", () => {
  test("portable sampling settings map straight through", () => {
    const { options, warnings } = decode(
      ir({
        settings: {
          maxOutputTokens: 1024,
          temperature: 0.4,
          temperatureMax: 1,
          topP: 0.9,
          topK: 40,
          presencePenalty: 0.1,
          frequencyPenalty: 0.2,
          stopSequences: ["STOP"],
          seed: 7,
        },
      }),
    );

    expect(options).toMatchObject({
      maxOutputTokens: 1024,
      temperature: 0.4,
      topP: 0.9,
      topK: 40,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      stopSequences: ["STOP"],
      seed: 7,
    });
    expect(warnings).toEqual([]);
  });

  test("a reasoning budget becomes the provider's own option shape", () => {
    expect(decode(ir({ settings: { reasoning: { mode: "budget", budgetTokens: 2048 } } })).options
      .providerOptions).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } });

    expect(decode(ir({ settings: { reasoning: { mode: "budget", budgetTokens: 2048 } } }), "google").options
      .providerOptions).toEqual({ google: { thinkingConfig: { thinkingBudget: 2048 } } });

    expect(decode(ir({ settings: { reasoning: { mode: "effort", effort: "high" } } }), "openai").options
      .providerOptions).toEqual({ openai: { reasoningEffort: "high" } });
  });

  test("what generateText cannot express is dropped and named, never faked", () => {
    const { options, warnings } = decode(
      ir({
        settings: {
          stream: true,
          candidates: 3,
          user: "user-42",
          responseFormat: { kind: "json-schema", schema: { type: "object" } },
        },
      }),
    );

    expect(options.messages).toHaveLength(1);
    expect(warnings.map((w) => `${w.code}:${w.path.join(".")}`).sort()).toEqual([
      "dropped_param:n",
      "dropped_param:response_format",
      "dropped_param:stream",
      "dropped_param:user",
    ]);
    expect(warnings.find((w) => w.path[0] === "response_format")?.message).toContain("generateObject");
    expect(warnings.find((w) => w.path[0] === "stream")?.message).toContain("streamText");
  });

  test("the source dialect's own params ride in providerOptions under its key", () => {
    const { options } = decode(
      ir({ passthrough: { "anthropic-messages": { container: "c-1", __internal: "hidden" } } }),
    );

    expect(options.providerOptions).toEqual({ anthropic: { container: "c-1" } });
  });

  test("another dialect's params cannot apply and are dropped by name", () => {
    const { options, warnings } = decode(ir({ passthrough: { "openai-chat": { logit_bias: { "1": 2 } } } }));

    expect(options.providerOptions).toBeUndefined();
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "dropped_param", path: ["logit_bias"] },
    ]);
  });

  test("providerOptions keys are the AI SDK's, not always the catalog's", () => {
    expect(aiSdkProviderKey("google-vertex")).toBe("vertex");
    expect(aiSdkProviderKey("amazon-bedrock")).toBe("bedrock");
    expect(aiSdkProviderKey("fireworks-ai")).toBe("fireworks");
    // The Vercel AI *Gateway*, which is a different thing from the AI SDK.
    expect(aiSdkProviderKey("vercel")).toBe("gateway");
    expect(aiSdkProviderKey("groq")).toBe("groq");
  });
});

describe("createAiSdkChat", () => {
  const format = createAiSdkChat<{ text: string }>({
    endpoint: "anthropic.messages",
    provider: "anthropic",
    encode: (body, warn) => {
      warn({ code: "dropped_param", path: ["demo"], message: "the encoder can report losses too" });
      return ir({ messages: [{ role: "user", content: [{ type: "text", text: body.text }] }] });
    },
  });

  test("carries encoder and decoder warnings, non-enumerably", () => {
    const options = format({ text: "Hello" }) as ReturnType<typeof format> & {
      warnings: readonly TranslationWarning[];
    };

    expect(Object.keys(options)).toEqual(["messages"]);
    expect(Object.getOwnPropertyDescriptor(options, "warnings")?.enumerable).toBe(false);
    expect(options.warnings.map((w) => w.code)).toEqual(["dropped_param"]);
    expect(options.warnings[0]?.to).toBe("ai-sdk");
    // Spreading into generateText carries the options and nothing else.
    expect(Object.keys({ ...options })).toEqual(["messages"]);
  });
});
