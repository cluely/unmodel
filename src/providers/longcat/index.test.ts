import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL, models } from "./index";

describe("unmodel/longcat", () => {
  test("chat URL is the documented OpenAI-compatible endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.longcat.chat/openai/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "LongCat-2.0" as const,
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

  test("unknown model warns and names the longcat catalog", () => {
    const r = chat.safe({
      model: "LongCat-99-Flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("longcat");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "LongCat-2.0",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });

  test("LongCat-2.5-Preview validates with an image part and prices from the catalog", () => {
    const r = chat.safe({
      model: "LongCat-2.5-Preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is in this picture?" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);

    // $0.30 / 1M uncached input + $1.20 / 1M output, the "Discounted Price
    // $/1M Tokens (limited-time)" column of
    // https://web.archive.org/web/20261018115714/https://longcat.chat/platform/docs/pricing/longcat-2.5
    const report = checkChat({
      model: "LongCat-2.5-Preview",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(1.5, 10);
  });

  // https://longcat.chat/platform/docs/api/model-params (2026-11-12): "Other
  // values are not rejected — they are overridden with the default for the
  // current thinking state."
  for (const model of ["LongCat-2.0", "LongCat-2.5-Preview"] as const) {
    test(`${model}: a fixed temperature is overridden, never refused, and top_p stays adjustable`, () => {
      expect(models[model].temperature).toBe(false);
      const r = chat.safe({
        model,
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.7,
        top_p: 0.95,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => [w.code, w.severity, w.path])).toEqual([
          ["unsupported_param", "warning", ["temperature"]],
        ]);
        expect(r.warnings[0]?.message).toContain("overridden");
      }
    });
  }
});
