import { describe, expect, test } from "bun:test";

import type { ChatIR, DecodeContext } from "../../core/translate/ir";
import type { TranslationWarning } from "../../core/translate/warnings";
import { createWarningSink } from "../../core/translate/warnings";
import { INVENTED_MAX_TOKENS, decodeAnthropic, encodeAnthropic } from "./interop";
import type { MessagesBody, TextBlock } from "./wire";

/**
 * The Anthropic-only surface and the two mappings that carry real risk: the
 * 0–1 temperature scale and the invented `max_tokens`.
 */

function encode(body: MessagesBody): { ir: ChatIR; warnings: TranslationWarning[] } {
  const sink = createWarningSink("anthropic.chat", "x");
  return { ir: encodeAnthropic(body, sink.warn), warnings: sink.warnings };
}

function decode(ir: ChatIR, ctx?: DecodeContext): {
  body: MessagesBody;
  warnings: TranslationWarning[];
} {
  const sink = createWarningSink("x", "anthropic.chat");
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

describe("mid-conversation system messages", () => {
  test("are appended to the system prompt, and the lost position is named", () => {
    const { ir, warnings } = encode(
      claudeBody({
        system: "You are helpful.",
        messages: [
          { role: "user", content: "Bonjour" },
          { role: "system", content: "Answer in French from here on." },
          { role: "user", content: "Quelle heure est-il ?" },
        ],
      }),
    );

    // Appended, not prepended: later system instructions take precedence.
    expect(ir.system).toEqual([{ text: "You are helpful." }, { text: "Answer in French from here on." }]);
    expect(ir.messages.map((m) => m.role)).toEqual(["user", "user"]);
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "approximated_param", path: ["messages", 1] },
    ]);
    expect(warnings[0]?.message).toContain("applies from the start of the conversation");
  });

  test("carry text blocks with their cache breakpoint; any other block is dropped by name", () => {
    const { ir, warnings } = encode(
      claudeBody({
        messages: [
          { role: "user", content: "Bonjour" },
          {
            role: "system",
            content: [
              { type: "text", text: "Answer in French.", cache_control: { type: "ephemeral" } },
              // `tool_addition` is a beta block the wire types leave open.
              { type: "tool_addition" } as unknown as TextBlock,
            ],
          },
          { role: "user", content: "Quelle heure est-il ?" },
        ],
      }),
    );

    expect(ir.system).toEqual([{ text: "Answer in French.", cache: { kind: "ephemeral" } }]);
    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "dropped_content", path: ["messages", 1, "content", 1] },
      { code: "approximated_param", path: ["messages", 1] },
    ]);
  });
});

describe("reasoning is spelled per target model", () => {
  const budget = (extra: { effort?: string } = {}): ChatIR => ({
    ...IR,
    settings: { maxOutputTokens: 4096, reasoning: { mode: "budget", budgetTokens: 2048, ...extra } },
  });

  test("a budget stays a budget on a model that takes one, the carried effort unused", () => {
    const { body, warnings } = decode(budget({ effort: "high" }), { targetModelId: "claude-sonnet-4-6" });

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(body.output_config).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("Claude 4.7+ takes the carried effort with adaptive thinking, warning-free", () => {
    for (const targetModelId of ["claude-opus-4-7", "claude-opus-5", "claude-opus-5-5-20261101"]) {
      const { body, warnings } = decode(budget({ effort: "max" }), { targetModelId });
      expect(body.thinking, targetModelId).toEqual({ type: "adaptive" });
      expect(body.output_config, targetModelId).toEqual({ effort: "max" });
      expect(warnings, targetModelId).toEqual([]);
    }
  });

  test("a bare budget on Claude 4.7+ is bucketed, and the bucket is named", () => {
    const { body, warnings } = decode(budget(), { targetModelId: "claude-sonnet-5" });

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(warnings.map((w) => ({ code: w.code, path: w.path, meta: w.meta }))).toEqual([
      {
        code: "approximated_param",
        path: ["thinking", "budget_tokens"],
        meta: { budgetTokens: 2048, effort: "low" },
      },
    ]);
  });

  test("`display` survives onto adaptive thinking", () => {
    const { ir } = encode(
      claudeBody({ model: "claude-sonnet-4-6", thinking: { type: "enabled", budget_tokens: 2048, display: "summarized" } }),
    );
    expect(decode(ir, { targetModelId: "claude-opus-5" }).body.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    });
  });

  test('"off" is `between_tools` on Sonnet 5.5 and `disabled` everywhere else', () => {
    const off: ChatIR = { ...IR, settings: { maxOutputTokens: 64, reasoning: { mode: "off" } } };

    const sonnet = decode(off, { targetModelId: "claude-sonnet-5-5" });
    expect(sonnet.body.thinking).toEqual({ type: "between_tools" });
    expect(sonnet.warnings.map((w) => ({ code: w.code, path: w.path, meta: w.meta }))).toEqual([
      { code: "approximated_param", path: ["thinking"], meta: { from: "disabled", to: "between_tools" } },
    ]);

    for (const targetModelId of ["claude-haiku-5-5", "claude-sonnet-5", "claude-opus-4-5"]) {
      const other = decode(off, { targetModelId });
      expect(other.body.thinking, targetModelId).toEqual({ type: "disabled" });
      expect(other.warnings, targetModelId).toEqual([]);
    }
  });
});
