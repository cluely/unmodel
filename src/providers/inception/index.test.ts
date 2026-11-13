import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL } from "./index";

describe("unmodel/inception", () => {
  test("chat URL is the documented OpenAI-compatible endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.inceptionlabs.ai/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "mercury-3" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const r = chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(Object.keys(r.params)).toEqual(["model", "messages"]);
      expect(JSON.parse(JSON.stringify(r.params))).toEqual(params);
      expect(r.params.request.url).toBe(CHAT_COMPLETIONS_URL);
      expect(r.params.request.method).toBe("POST");
    }
  });

  test("unknown model warns and names the inception catalog", () => {
    const r = chat.safe({
      model: "mercury-ultra-99",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("inception");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "mercury-3",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });

  // ChatCompletionResponse.warning, {"anyOf": [{"type": "string"}, {"type": "null"}]}
  // (https://api.inceptionlabs.ai/openapi.json, 2026-11-12) — what the API
  // fills when it resets an out-of-range temperature.
  describe("checkChat reports the response's own `warning`", () => {
    const base = {
      model: "mercury-3",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    test("a non-empty string is one provider_warning at [\"warning\"]", () => {
      const report = checkChat({ ...base, warning: "temperature reset to 1" });
      expect(report.warnings).toHaveLength(1);
      const [warning] = report.warnings;
      expect(warning?.severity).toBe("warning");
      expect(warning?.code).toBe("invalid_shape");
      expect(warning?.path).toEqual(["warning"]);
      expect(warning?.model).toBe("mercury-3");
      expect(warning?.message).toContain("temperature reset to 1");
      expect(warning?.meta).toEqual({ kind: "provider_warning", warning: "temperature reset to 1" });
      expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    });

    test.each([
      ["null", { warning: null }],
      ["absent", {}],
      ["empty", { warning: "" }],
    ] as const)("%s is no warning", (_label, extra) => {
      expect(checkChat({ ...base, ...extra }).warnings).toEqual([]);
    });
  });

  // mercury-edit-2 is text-out in models.dev but Inception serves it only on
  // /v1/fim/completions and /v1/edit/completions; POST /v1/chat/completions
  // answers 400 "Model must be one of the following: mercury, mercury-2,
  // mercury-2.5, mercury-3, …" (2026-11-13). The request still validates —
  // the warning is the signpost.
  describe("mercury-edit-2 is not served on the chat endpoint", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    test("validates ok with exactly one route warning at [\"model\"]", () => {
      const r = chat.safe({ model: "mercury-edit-2", messages });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toHaveLength(1);
      const [warning] = r.warnings;
      expect(warning?.code).toBe("unsupported_capability");
      expect(warning?.severity).toBe("warning");
      expect(warning?.path).toEqual(["model"]);
      expect(warning?.model).toBe("mercury-edit-2");
      expect(warning?.message).toContain("/v1/fim/completions");
      expect(warning?.message).toContain("/v1/edit/completions");
      expect(warning?.message).toContain("400");
      expect(warning?.meta).toMatchObject({
        route: "POST /v1/fim/completions, POST /v1/edit/completions",
      });
      expect(Object.keys(r.params)).toEqual(["model", "messages"]);
    });

    test.each(["mercury-3", "mercury-2.5", "mercury-2"] as const)(
      "%s carries no route warning",
      (model) => {
        const r = chat.safe({ model, messages });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.warnings.filter((w) => w.code === "unsupported_capability")).toEqual([]);
        }
      },
    );
  });

  // https://api.inceptionlabs.ai/v1/models (2026-11-12): mercury-3
  // "max_output_length":131072, mercury-2.5 "max_output_length":65536.
  test.each([
    ["mercury-3", 131_072],
    ["mercury-2.5", 65_536],
  ] as const)("%s validates clean up to its %d-token output cap, then refuses", (model, cap) => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const atCap = chat.safe({ model, messages, max_completion_tokens: cap });
    expect(atCap.ok).toBe(true);
    if (atCap.ok) {
      expect(atCap.warnings).toEqual([]);
      expect(atCap.estimate.costUSD).toBeGreaterThan(0);
    }
    const overCap = chat.safe({ model, messages, max_completion_tokens: cap + 1 });
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.errors.map((e) => e.code)).toEqual(["over_output_limit"]);
  });

  // Live pricing (https://api.inceptionlabs.ai/v1/models, 2026-11-12):
  // mercury-3 "prompt":"0.0000001","completion":"0.00000035","input_cache_reads":"0.00000001";
  // mercury-2.5 "prompt":"0.0000002","completion":"0.00000075","input_cache_reads":"0.00000002".
  test.each([
    ["mercury-3", 0.5 * 0.1 + 0.5 * 0.01 + 0.35],
    ["mercury-2.5", 0.5 * 0.2 + 0.5 * 0.02 + 0.75],
  ] as const)("checkChat prices %s at the rates the API bills", (model, expected) => {
    const report = checkChat({
      model,
      choices: [{ finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
        prompt_tokens_details: { cached_tokens: 500_000 },
      },
    });
    expect(report.costUSD).toBeCloseTo(expected, 10);
    expect(report.warnings).toEqual([]);
  });

  describe("temperature outside 0.5–1 is reset by the API, so it warns", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    test.each(["mercury-3", "mercury-2.5", "mercury-2"] as const)(
      "%s accepts the documented bounds without a warning",
      (model) => {
        for (const temperature of [0.5, 1]) {
          const r = chat.safe({ model, messages, temperature });
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.warnings).toEqual([]);
        }
      },
    );

    test.each([
      ["mercury-3", 0.2, 1],
      ["mercury-2.5", 1.5, 1],
      ["mercury-2", 0, 0.75],
    ] as const)(
      "%s at %s still validates, warning that it runs at %s",
      (model, temperature, fallback) => {
        const r = chat.safe({ model, messages, temperature });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.warnings).toHaveLength(1);
        const [warning] = r.warnings;
        expect(warning?.code).toBe("invalid_shape");
        expect(warning?.severity).toBe("warning");
        expect(warning?.path).toEqual(["temperature"]);
        expect(warning?.message).toContain(`runs at ${fallback}`);
        expect(warning?.meta).toMatchObject({
          min: 0.5,
          max: 1,
          value: temperature,
          default: fallback,
        });
        expect(Object.keys(r.params)).toEqual(["model", "messages", "temperature"]);
      },
    );

    test("a model with no documented default is left to the shared dialect", () => {
      const r = chat.safe({ model: "mercury-ultra-99", messages, temperature: 0.2 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    });
  });
});
