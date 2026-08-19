import { describe, expect, test } from "bun:test";

import type { ChatIR, DecodeContext } from "../../core/translate/ir";
import type { TranslationWarning } from "../../core/translate/warnings";
import { createWarningSink } from "../../core/translate/warnings";
import { decodeOpenAIChat, encodeOpenAIChat } from "./interop";
import type { ChatCompletionsBodyBase } from "./wire";

/**
 * The cases the golden fixtures cannot carry, because a golden fixture must
 * be expressible in *every* dialect it names. Everything here is either
 * openai-chat-only surface or a target-conditional mapping.
 */

function encode(body: ChatCompletionsBodyBase): {
  ir: ChatIR;
  warnings: TranslationWarning[];
} {
  const sink = createWarningSink("openai.chat", "x");
  return { ir: encodeOpenAIChat(body, sink.warn), warnings: sink.warnings };
}

function decode(ir: ChatIR, ctx?: DecodeContext): {
  body: ChatCompletionsBodyBase;
  warnings: TranslationWarning[];
} {
  const sink = createWarningSink("x", "openai.chat");
  return { body: decodeOpenAIChat(ir, sink.warn, ctx), warnings: sink.warnings };
}

const USER = { role: "user" as const, content: "hi" };

describe("encode", () => {
  test("`developer` is the system role, and the spelling survives a round-trip", () => {
    const { ir, warnings } = encode({
      model: "gpt-5.4",
      messages: [{ role: "developer", content: "Be terse." }, USER],
    });

    expect(ir.system).toEqual([{ text: "Be terse." }]);
    expect(warnings).toEqual([]);
    expect(decode(ir).body.messages[0]).toEqual({ role: "developer", content: "Be terse." });
  });

  test("a system message after a turn is moved to the front, and says so", () => {
    const { ir, warnings } = encode({
      model: "gpt-5.4",
      messages: [USER, { role: "system", content: "Actually, be terse." }],
    });

    expect(ir.system).toEqual([{ text: "Actually, be terse." }]);
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "approximated_param", path: ["messages", 1] },
    ]);
  });

  test("audio parts carry their container as a MIME type", () => {
    const { ir } = encode({
      model: "gpt-4o-audio-preview",
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: "UklGRg==", format: "wav" } }],
        },
      ],
    });

    expect(ir.messages[0]?.content[0]).toEqual({
      type: "media",
      mediaType: "audio/wav",
      data: { kind: "base64", base64: "UklGRg==" },
    });
    // …and back again, so `format` is not lost on a same-dialect round-trip.
    expect(decode(ir).body.messages[0]).toEqual({
      role: "user",
      content: [{ type: "input_audio", input_audio: { data: "UklGRg==", format: "wav" } }],
    });
  });

  test("an uploaded file id is recorded with the dialect that minted it", () => {
    const { ir } = encode({
      model: "gpt-5.4",
      messages: [{ role: "user", content: [{ type: "file", file: { file_id: "file-abc" } }] }],
    });

    expect(ir.messages[0]?.content[0]).toEqual({
      type: "media",
      data: { kind: "file", dialect: "openai-chat", ref: "file-abc" },
    });
  });

  test("tool-call arguments that are not JSON are carried verbatim, with a warning", () => {
    const { ir, warnings } = encode({
      model: "gpt-5.4",
      messages: [
        USER,
        {
          role: "assistant",
          tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "not json" } }],
        },
      ],
    });

    expect(ir.messages[1]?.content[0]).toMatchObject({ type: "tool-call", input: "not json" });
    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    // Verbatim really means verbatim: the string comes back unchanged.
    expect(decode(ir).body.messages[1]).toMatchObject({
      tool_calls: [{ function: { arguments: "not json" } }],
    });
  });

  test("params with no IR home are recorded by name, not discarded", () => {
    const { ir } = encode({
      model: "gpt-5.4",
      messages: [USER],
      logprobs: true,
      top_logprobs: 5,
      logit_bias: { "50256": -100 },
      // An OpenAI-only param this codec has never heard of.
      prompt_cache_key: "session-1",
    } as ChatCompletionsBodyBase);

    expect(ir.passthrough?.["openai-chat"]).toEqual({
      logprobs: true,
      top_logprobs: 5,
      logit_bias: { "50256": -100 },
      prompt_cache_key: "session-1",
    });
  });

  test("a `top_k` extension is lifted into the IR, because two dialects have a real one", () => {
    const { ir } = encode({
      model: "anthropic/claude-opus-5",
      messages: [USER],
      top_k: 40,
    } as unknown as ChatCompletionsBodyBase);

    expect(ir.settings.topK).toBe(40);
    expect(ir.passthrough?.["openai-chat"]?.["top_k"]).toBeUndefined();
  });
});

describe("decode", () => {
  const base: ChatIR = {
    source: "anthropic-messages",
    model: "claude-opus-5",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    settings: {},
  };

  test("the target's spelling of the model wins over the source's", () => {
    expect(decode(base, { targetModelId: "anthropic/claude-opus-5" }).body.model).toBe(
      "anthropic/claude-opus-5",
    );
    expect(decode(base).body.model).toBe("claude-opus-5");
  });

  test("`top_k` is dropped on the way in — it is not in the Chat Completions API", () => {
    const { body, warnings } = decode({ ...base, settings: { topK: 40 } });

    expect((body as unknown as Record<string, unknown>)["top_k"]).toBeUndefined();
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "dropped_param", path: ["top_k"] },
    ]);
  });

  test("a cache breakpoint survives to OpenAI itself and is dropped elsewhere", () => {
    const cached: ChatIR = {
      ...base,
      messages: [{ role: "user", content: [{ type: "text", text: "hi", cache: { kind: "ephemeral" } }] }],
    };

    const toOpenAI = decode(cached, { provider: "openai" });
    expect(toOpenAI.body.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "hi", prompt_cache_breakpoint: { mode: "explicit" } }],
    });
    expect(toOpenAI.warnings).toEqual([]);

    const toGateway = decode(cached, { provider: "openrouter" });
    expect(toGateway.body.messages[0]).toEqual({ role: "user", content: "hi" });
    expect(toGateway.warnings.map((w) => w.code)).toEqual(["dropped_param"]);
  });

  test("an Anthropic-only cache TTL is reported even when the breakpoint survives", () => {
    const { warnings } = decode(
      {
        ...base,
        messages: [
          { role: "user", content: [{ type: "text", text: "hi", cache: { kind: "ephemeral", ttl: "1h" } }] },
        ],
      },
      { provider: "openai" },
    );

    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    expect(warnings[0]?.message).toContain("1h");
  });

  test("a reasoning budget is bucketed to an effort, and the bucket is stated", () => {
    for (const [budgetTokens, effort] of [
      [1024, "low"],
      [4096, "medium"],
      [32000, "high"],
    ] as const) {
      const { body, warnings } = decode({ ...base, settings: { reasoning: { mode: "budget", budgetTokens } } });
      expect(body.reasoning_effort).toBe(effort);
      expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    }
  });

  test("reasoning off is `none`, not a dropped param", () => {
    const { body, warnings } = decode({ ...base, settings: { reasoning: { mode: "off" } } });
    expect(body.reasoning_effort).toBe("none");
    expect(warnings).toEqual([]);
  });

  test("assistant reasoning blocks are dropped with an explanation", () => {
    const { body, warnings } = decode({
      ...base,
      messages: [
        { role: "assistant", content: [{ type: "reasoning", text: "…", signature: "s" }, { type: "text", text: "42" }] },
      ],
    });

    expect(body.messages).toEqual([{ role: "assistant", content: "42" }]);
    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
    expect(warnings[0]?.message).toContain("chain of thought");
  });

  test("a provider file handle cannot cross, and the message says what to do", () => {
    const { warnings } = decode({
      ...base,
      messages: [
        {
          role: "user",
          content: [{ type: "media", data: { kind: "file", dialect: "anthropic-messages", ref: "file_1" } }],
        },
      ],
    });

    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
    expect(warnings[0]?.message).toMatch(/Re-upload the file/);
  });
});
