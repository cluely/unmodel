import { describe, expect, test } from "bun:test";

import type { ChatIR, DecodeContext } from "../../core/translate/ir";
import type { TranslationWarning } from "../../core/translate/warnings";
import { createWarningSink } from "../../core/translate/warnings";
import { INVENTED_MAX_TOKENS, decodeAnthropic, encodeAnthropic } from "./interop";
import type { MessagesBody } from "./wire";

/**
 * The Anthropic-only surface and the two mappings that carry real risk: the
 * 0–1 temperature scale and the invented `max_tokens`.
 */

function encode(body: MessagesBody): { ir: ChatIR; warnings: TranslationWarning[] } {
  const sink = createWarningSink("anthropic.messages", "x");
  return { ir: encodeAnthropic(body, sink.warn), warnings: sink.warnings };
}

function decode(ir: ChatIR, ctx?: DecodeContext): {
  body: MessagesBody;
  warnings: TranslationWarning[];
} {
  const sink = createWarningSink("x", "anthropic.messages");
  return { body: decodeAnthropic(ir, sink.warn, ctx), warnings: sink.warnings };
}

const IR: ChatIR = {
  source: "openai-chat",
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  settings: { maxOutputTokens: 256 },
};

const claudeBody = (extra: Partial<MessagesBody> = {}): MessagesBody => ({
  model: "claude-opus-5",
  max_tokens: 256,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  ...extra,
});

describe("temperature", () => {
  test("is carried on the source's scale, with the scale as the discriminant", () => {
    expect(encode(claudeBody({ temperature: 0.7 })).ir.settings).toMatchObject({
      temperature: 0.7,
      temperatureMax: 1,
    });
  });

  test("clamps rather than rescales when a 0–2 source exceeds Anthropic's 1", () => {
    const { body, warnings } = decode({
      ...IR,
      settings: { ...IR.settings, temperature: 1.6, temperatureMax: 2 },
    });

    expect(body.temperature).toBe(1);
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "approximated_param", path: ["temperature"] },
    ]);
    expect(warnings[0]?.message).toContain("clamped to 1 rather than rescaled");
  });

  test("says nothing at all when the value already fits — the common case", () => {
    const { body, warnings } = decode({
      ...IR,
      settings: { ...IR.settings, temperature: 0.7, temperatureMax: 2 },
    });

    expect(body.temperature).toBe(0.7);
    expect(warnings).toEqual([]);
  });
});

describe("max_tokens", () => {
  test("is invented, named and bounded when the source set no output cap", () => {
    const { body, warnings } = decode({ ...IR, settings: {} });

    expect(body.max_tokens).toBe(INVENTED_MAX_TOKENS);
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "approximated_param", path: ["max_tokens"] },
    ]);
    expect(warnings[0]?.meta).toEqual({ max_tokens: INVENTED_MAX_TOKENS });
  });

  test("is bounded by the generated narrowing metadata when there is any", () => {
    const { body, warnings } = decode({ ...IR, settings: {} }, { narrows: { context: 1024 } });

    expect(body.max_tokens).toBe(1024);
    expect(warnings[0]?.message).toContain("1024-token window");
  });

  test("is left alone when the source did ask for one", () => {
    expect(decode(IR).warnings).toEqual([]);
    expect(decode(IR).body.max_tokens).toBe(256);
  });
});

describe("content", () => {
  test("a plain-text document survives the base64 round-trip the other dialects need", () => {
    const { ir } = encode(
      claudeBody({
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "text", media_type: "text/plain", data: "héllo" } },
            ],
          },
        ],
      }),
    );

    expect(ir.messages[0]?.content[0]).toMatchObject({ type: "media", mediaType: "text/plain" });
    expect(decode(ir).body.messages[0]?.content).toEqual([
      { type: "document", source: { type: "text", media_type: "text/plain", data: "héllo" } },
    ]);
  });

  test("tool results learn their tool's name from the call they answer", () => {
    const { ir } = encode(
      claudeBody({
        messages: [
          { role: "user", content: [{ type: "text", text: "weather?" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_weather", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "18C" }] },
        ],
      }),
    );

    expect(ir.messages[2]?.content[0]).toEqual({
      type: "tool-result",
      id: "t1",
      name: "get_weather",
      output: { kind: "text", text: "18C" },
    });
  });

  test("a reasoning block without its signature cannot be replayed, and says why", () => {
    const { body, warnings } = decode({
      ...IR,
      messages: [{ role: "assistant", content: [{ type: "reasoning", text: "thinking out loud" }] }],
    });

    expect(body.messages[0]?.content).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
    expect(warnings[0]?.message).toContain("signature");
  });

  test("a signed thinking block is replayed verbatim", () => {
    const { body } = decode({
      ...IR,
      messages: [
        { role: "assistant", content: [{ type: "reasoning", text: "17*23 = 391", signature: "sig" }] },
      ],
    });

    expect(body.messages[0]?.content).toEqual([
      { type: "thinking", thinking: "17*23 = 391", signature: "sig" },
    ]);
  });
});

describe("settings with no Anthropic equivalent", () => {
  test("are dropped one warning at a time, each naming the param", () => {
    const { body, warnings } = decode({
      ...IR,
      settings: { ...IR.settings, seed: 7, presencePenalty: 0.5, candidates: 3 },
    });

    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "dropped_param", path: ["seed"] },
      { code: "dropped_param", path: ["presence_penalty"] },
      { code: "dropped_param", path: ["n"] },
    ]);
  });

  test("JSON mode without a schema is not silently downgraded", () => {
    const { body, warnings } = decode({ ...IR, settings: { ...IR.settings, responseFormat: { kind: "json" } } });

    expect(body.output_config).toBeUndefined();
    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    expect(warnings[0]?.message).toContain("require a schema");
  });

  test("an effort bucket lands on Anthropic's own vocabulary when it is one of theirs", () => {
    expect(decode({ ...IR, settings: { ...IR.settings, reasoning: { mode: "effort", effort: "high" } } }).body
      .output_config).toEqual({ effort: "high" });

    const foreign = decode({
      ...IR,
      settings: { ...IR.settings, reasoning: { mode: "effort", effort: "minimal" } },
    });
    expect(foreign.body.output_config).toBeUndefined();
    expect(foreign.warnings.map((w) => w.code)).toEqual(["approximated_param"]);
  });

  test("`parallel_tool_calls: false` needs a tool_choice to hang off, and says so", () => {
    const { warnings } = decode({ ...IR, settings: { ...IR.settings, parallelToolCalls: false } });

    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "dropped_param", path: ["parallel_tool_calls"] },
    ]);
    expect(
      decode({
        ...IR,
        toolChoice: { mode: "auto" },
        settings: { ...IR.settings, parallelToolCalls: false },
      }).body.tool_choice,
    ).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });
});

describe("passthrough", () => {
  test("Anthropic-only params round-trip through the IR untouched", () => {
    const { ir } = encode(claudeBody({ container: "c-1", inference_geo: "us" }));

    expect(ir.passthrough?.["anthropic-messages"]).toMatchObject({
      container: "c-1",
      inference_geo: "us",
    });
    expect(decode(ir)).toMatchObject({ body: { container: "c-1", inference_geo: "us" } });
  });

  test("adaptive thinking is Anthropic-only and rides as such", () => {
    const { ir } = encode(claudeBody({ thinking: { type: "adaptive" } }));

    expect(ir.settings.reasoning).toBeUndefined();
    expect(ir.passthrough?.["anthropic-messages"]?.["thinking"]).toEqual({ type: "adaptive" });
  });
});
