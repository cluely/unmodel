import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat } from "./index";

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("unmodel/moonshotai", () => {
  test("CHAT_COMPLETIONS_URL targets Moonshot AI's chat completions endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.moonshot.ai/v1/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "kimi-k3.1-pro" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the moonshotai catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the moonshotai catalog");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "kimi-k3.1-pro",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });
});

describe("Kimi K3.1 Pro", () => {
  // https://platform.kimi.ai/docs/pricing/chat (2026-11-12): kimi-k3.1-pro
  // "$2.00 / MTok" input, "$10.00 / MTok" output, "$0.20 / MTok" cached input,
  // "$2.00 / MTok" 5m cache write; kimi-k3.1-pro-highspeed "$4.00 / MTok",
  // "$20.00 / MTok", "$0.20 / MTok", "$4.00 / MTok".
  test.each([
    ["kimi-k3.1-pro", 12],
    ["kimi-k3.1-pro-highspeed", 24],
  ] as const)("%s validates clean and prices a million tokens each way at $%d", (model, usd) => {
    const r = chat.safe({ model, messages: [{ role: "user", content: "hi" }], max_completion_tokens: 1024 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeGreaterThan(0);
    }
    const report = checkChat({
      model,
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(usd, 9);
  });

  test("cache reads and 5m cache writes price at their own rates", () => {
    const report = checkChat({
      model: "kimi-k3.1-pro",
      choices: [{ finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        total_tokens: 1_100_000,
        prompt_tokens_details: { cached_tokens: 400_000, cache_write_tokens: 200_000 },
      },
    });
    // 400k fresh × $2 + 400k cached × $0.20 + 200k written × $2 + 100k out × $10
    expect(report.costUSD).toBeCloseTo(0.8 + 0.08 + 0.4 + 1, 9);
  });

  test("max_completion_tokens reaches the documented 1048576 ceiling", () => {
    // openapi.json: "for Kimi K3-series models (kimi-k3.1-pro,
    // kimi-k3.1-pro-highspeed, kimi-k3) it defaults to 131072 and can be set
    // up to 1048576."
    for (const model of ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"] as const) {
      const at = chat.safe({ model, messages: [{ role: "user", content: "hi" }], max_completion_tokens: 1_048_576 });
      expect(at.ok).toBe(true);
      const over = chat.safe({ model, messages: [{ role: "user", content: "hi" }], max_completion_tokens: 1_048_577 });
      expect(over.ok).toBe(false);
      if (!over.ok) expect(over.errors.map((e) => e.code)).toEqual(["over_output_limit"]);
    }
  });
});

describe("fixed sampling (Model Parameter Reference)", () => {
  const base = { messages: [{ role: "user" as const, content: "hi" }] };

  test.each([
    "kimi-k3.1-pro",
    "kimi-k3.1-pro-highspeed",
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
    "kimi-k2.6",
  ] as const)("%s accepts the fixed values themselves", (model) => {
    const r = chat.safe({ ...base, model, top_p: 0.95, n: 1, presence_penalty: 0, frequency_penalty: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("top_p is pinned at 0.95, so the dialect's default 1 is refused", () => {
    const r = chat.safe({ ...base, model: "kimi-k3.1-pro", top_p: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([["invalid_enum_value", ["top_p"]]]);
      expect(r.errors[0]?.message).toContain("0.95");
    }
  });

  test("n other than 1 is refused", () => {
    const r = chat.safe({ ...base, model: "kimi-k3.1-pro", n: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => [e.code, e.path])).toEqual([["invalid_enum_value", ["n"]]]);
  });

  test("presence_penalty and frequency_penalty other than 0 are refused", () => {
    const r = chat.safe({ ...base, model: "kimi-k3.1-pro-highspeed", presence_penalty: 0.5, frequency_penalty: -0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual([["presence_penalty"], ["frequency_penalty"]]);
    }
  });

  test("temperature stays fixed at 1.0", () => {
    expect(chat.safe({ ...base, model: "kimi-k3.1-pro", temperature: 1 }).ok).toBe(true);
    const r = chat.safe({ ...base, model: "kimi-k3.1-pro", temperature: 0.7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["temperature"]]]);
  });

  test("kimi-k2.6 takes 1.0 with thinking on and 0.6 with thinking off, nothing else", () => {
    for (const temperature of [1, 0.6]) {
      const r = chat.safe({ ...base, model: "kimi-k2.6", temperature });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    const r = chat.safe({ ...base, model: "kimi-k2.6", temperature: 0.7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([["invalid_enum_value", ["temperature"]]]);
      expect(r.errors[0]?.message).toContain("0.6");
    }
  });

  test("kimi-k2.7-code keeps temperature fixed at 1.0", () => {
    const r = chat.safe({ ...base, model: "kimi-k2.7-code", temperature: 0.6 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["temperature"]]]);
  });
});

describe("tool_choice (tool-choice guide + Model Parameter Reference)", () => {
  const tools = [
    { type: "function" as const, function: { name: "get_weather", parameters: { type: "object" } } },
  ];
  const base = { messages: [{ role: "user" as const, content: "weather?" }], tools };

  test.each(["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"] as const)(
    "%s always thinks, so it refuses a forced function and points at \"required\"",
    (model) => {
      const r = chat.safe({
        ...base,
        model,
        tool_choice: { type: "function", function: { name: "get_weather" } },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["tool_choice"]]]);
        expect(r.errors[0]?.message).toContain('"required"');
      }
    },
  );

  test.each(["kimi-k2.7-code", "kimi-k2.7-code-highspeed"] as const)(
    "%s always thinks, so it refuses a forced function and offers only \"auto\" / \"none\"",
    (model) => {
      const r = chat.safe({
        ...base,
        model,
        tool_choice: { type: "function", function: { name: "get_weather" } },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["tool_choice"]]]);
        expect(r.errors[0]?.message).not.toContain('"required"');
        expect(r.errors[0]?.message).toContain('"auto"');
      }
    },
  );

  test("kimi-k2.6 can turn thinking off, so a forced function stays valid", () => {
    const r = chat.safe({
      ...base,
      model: "kimi-k2.6",
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(r.ok).toBe(true);
  });

  test.each(["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"] as const)(
    '%s refuses "required"',
    (model) => {
      const r = chat.safe({ ...base, model, tool_choice: "required" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["tool_choice"]]]);
        expect(r.errors[0]?.meta?.source).toContain("platform.kimi.ai/docs/api/models-overview");
        expect(r.errors[0]?.message).toContain("kimi-k3");
      }
    },
  );

  test.each(["auto", "none"] as const)('kimi-k2.6 accepts "%s"', (tool_choice) => {
    const r = chat.safe({ ...base, model: "kimi-k2.6", tool_choice });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test.each(["kimi-k3.1-pro", "kimi-k3"] as const)('%s keeps "required" valid', (model) => {
    const r = chat.safe({ ...base, model, tool_choice: "required" });
    expect(r.ok).toBe(true);
  });
});

describe("prompt_cache_breakpoint", () => {
  test("is refused on any content part", () => {
    const r = chat.safe({
      model: "kimi-k3.1-pro",
      messages: [
        { role: "system", content: [{ type: "text", text: "be brief", prompt_cache_breakpoint: { mode: "explicit" } }] },
        { role: "user", content: "hi" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([
        ["unsupported_param", ["messages", 0, "content", 0, "prompt_cache_breakpoint"]],
      ]);
    }
  });

  test("plain content parts pass", () => {
    const r = chat.safe({
      model: "kimi-k3.1-pro",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("image formats", () => {
  test("an SVG data URL is refused, naming the formats Kimi takes", () => {
    const r = chat.safe({
      model: "kimi-k3.1-pro",
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/svg+xml;base64,PHN2Zy8+" } }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([
        ["media_unsupported_format", ["messages", 0, "content", 0]],
      ]);
      expect(r.errors[0]?.message).toContain("jpeg, png, gif, webp, bmp, heic, heif");
    }
  });

  test("a PNG data URL passes", () => {
    const r = chat.safe({
      model: "kimi-k3.1-pro",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: PNG_1X1 } }] }],
    });
    expect(r.ok).toBe(true);
  });
});
