import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat, models } from "./index";
import { MINIMAX_FLASH_REASONING_EFFORTS } from "./constraints";

const hi = [{ role: "user" as const, content: "hi" }];

describe("unmodel/minimax", () => {
  test("CHAT_COMPLETIONS_URL targets MiniMax's OpenAI-compatible endpoint, not the Anthropic route", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.minimax.io/v1/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "MiniMax-M3" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the minimax catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the minimax catalog");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "MiniMax-M3",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });

  test("MiniMax-M3 takes the documented 524,288-token completion maximum", () => {
    // "For MiniMax-M3.1-Flash and MiniMax-M3 the recommended value is 131072
    // (128K) and the maximum is 524288 (512K)." (openapi-chat-openai.json)
    for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const) {
      expect(chat.safe({ model, messages: hi, max_completion_tokens: 524288 }).ok).toBe(true);
      const over = chat.safe({ model, messages: hi, max_completion_tokens: 524289 });
      expect(over.ok).toBe(false);
      if (!over.ok) expect(over.errors[0]?.code).toBe("over_output_limit");
    }
  });
});

describe("minimax.chat — MiniMax-M3.1-Flash", () => {
  test("validates warning-free and prices at $0.15 / $0.60 per 1M tokens", () => {
    const r = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);

    expect(models["MiniMax-M3.1-Flash"].cost).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.015 });
    const report = checkChat({
      model: "MiniMax-M3.1-Flash",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(0.75, 10);
  });

  test("reasoning_effort takes low … max and refuses none", () => {
    for (const effort of MINIMAX_FLASH_REASONING_EFFORTS) {
      const r = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, reasoning_effort: effort });
      expect(r.ok, `reasoning_effort ${effort}`).toBe(true);
    }
    const none = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, reasoning_effort: "none" });
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.errors[0]?.code).toBe("invalid_enum_value");
      expect(none.errors[0]?.path).toEqual(["reasoning_effort"]);
      expect(none.errors[0]?.message).toContain('"xhigh", "max"');
    }
  });

  test("the reasoning_effort ladder is Flash's alone: MiniMax-M3 is not refused for none", () => {
    // The 400 is documented for MiniMax-M3.1-Flash only ("`MiniMax-M3.1-Flash`
    // always thinks"); MiniMax-M3 turns thinking off through `thinking`.
    expect(chat.safe({ model: "MiniMax-M3", messages: hi, reasoning_effort: "none" }).ok).toBe(true);
  });

  test("n is pinned to 1", () => {
    expect(chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, n: 1 }).ok).toBe(true);
    const two = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, n: 2 });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0]?.path).toEqual(["n"]);
  });

  test("the deprecated function_call is refused and points at tools", () => {
    const r = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, function_call: "auto" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["function_call"]);
      expect(r.errors[0]?.message).toContain("`tools`");
    }
  });

  test("the penalties and logit_bias are ignored: a warning, never a refusal", () => {
    const r = chat.safe({
      model: "MiniMax-M3.1-Flash",
      messages: hi,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      logit_bias: { "1": 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => [w.code, w.path[0]])).toEqual([
        ["unsupported_param", "presence_penalty"],
        ["unsupported_param", "frequency_penalty"],
        ["unsupported_param", "logit_bias"],
      ]);
      expect(r.warnings.every((w) => w.meta?.["ignored"] === true)).toBe(true);
    }
  });

  test("structured outputs are refused (no response_format on the OpenAI-compatible body)", () => {
    const r = chat.safe({
      model: "MiniMax-M3.1-Flash",
      messages: hi,
      response_format: { type: "json_schema", json_schema: { name: "x", schema: {} } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });
});

describe("minimax.chat — the M3 generation's sampling parameters", () => {
  test("temperature and top_p are accepted and ignored on both models", () => {
    for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const) {
      const r = chat.safe({ model, messages: hi, temperature: 0.2, top_p: 0.5 });
      expect(r.ok, model).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => w.path[0])).toEqual(["temperature", "top_p"]);
        expect(r.warnings.every((w) => w.meta?.["ignored"] === true)).toBe(true);
      }
    }
  });

  test("top_p must still be within (0, 1]", () => {
    for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const) {
      expect(chat.safe({ model, messages: hi, top_p: 1 }).ok, model).toBe(true);
      for (const topP of [0, 1.5]) {
        const r = chat.safe({ model, messages: hi, top_p: topP });
        expect(r.ok, `${model} top_p ${topP}`).toBe(false);
        if (!r.ok) {
          expect(r.errors[0]?.path).toEqual(["top_p"]);
          expect(r.errors[0]?.message).toContain("(0, 1]");
        }
      }
    }
  });
});
