import { describe, expect, test } from "bun:test";
import { checkChat, checkImages } from "./check";
import { models } from "../../catalog/openai.gen";

describe("checkChat", () => {
  test("maps usage (incl. cached + reasoning tokens) and prices the cost", () => {
    const cost = models["gpt-4o"].cost;
    const report = checkChat({
      model: "gpt-4o",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        total_tokens: 1100,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 40 },
      },
    });

    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cachedInputTokens: 200,
      reasoningTokens: 40,
    });
    // 800 fresh input at input rate, 200 cached at cacheRead, 100 output.
    const expected =
      (800 * (cost?.input ?? 0) + 200 * (cost?.cacheRead ?? 0) + 100 * (cost?.output ?? 0)) / 1e6;
    expect(report.costUSD).toBeCloseTo(expected, 10);
  });

  test("finish_reason length warns about truncation and mentions max tokens", () => {
    const report = checkChat({
      model: "gpt-4o",
      choices: [{ finish_reason: "length" }],
    });
    expect(report.finishReason).toBe("length");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.code).toBe("over_output_limit");
    expect(report.warnings[0]?.severity).toBe("warning");
    expect(report.warnings[0]?.message).toContain("max_completion_tokens");
    expect(report.warnings[0]?.meta?.kind).toBe("truncated");
  });

  test("finish_reason content_filter warns", () => {
    const report = checkChat({ choices: [{ finish_reason: "content_filter" }] });
    expect(report.warnings[0]?.meta?.kind).toBe("content_filtered");
  });

  test("message.refusal warns with the refusal text", () => {
    const report = checkChat({
      choices: [{ finish_reason: "stop", message: { refusal: "I can't help with that." } }],
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("refusal");
    expect(report.warnings[0]?.message).toContain("I can't help with that.");
    expect(report.warnings[0]?.path).toEqual(["choices", 0, "message", "refusal"]);
  });

  test("cache-written tokens are billed at the cacheWrite rate INSTEAD of the input rate", () => {
    // prompt_tokens INCLUDES cache_write_tokens on this API; billing them at
    // input + cacheWrite would double-charge (2.25x instead of 1.25x).
    const cost = models["gpt-5.6"].cost;
    expect(cost?.input).toBe(4);
    expect(cost?.cacheWrite).toBe(5);
    const report = checkChat({
      model: "gpt-5.6",
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1_000_000 },
      },
    });
    expect(report.usage.cacheWriteTokens).toBe(1_000_000);
    expect(report.costUSD).toBeCloseTo(5, 10);
  });

  test("mixed fresh + cached + cache-written prompt tokens price each bucket once", () => {
    const cost = models["gpt-5.6"].cost;
    const report = checkChat({
      model: "gpt-5.6",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 },
      },
    });
    // 500 fresh at input, 200 at cacheRead, 300 at cacheWrite.
    const expected =
      (500 * (cost?.input ?? 0) + 200 * (cost?.cacheRead ?? 0) + 300 * (cost?.cacheWrite ?? 0)) /
      1e6;
    expect(report.costUSD).toBeCloseTo(expected, 10);
  });

  test("dated snapshot ids fall back to the catalog prefix for pricing", () => {
    const rate = models["gpt-5.2"].cost;
    const report = checkChat({
      model: "gpt-5.2-2026-01-15",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    });
    expect(report.costUSD).toBeCloseTo(rate.input, 10);
  });

  test("unknown model leaves costUSD undefined", () => {
    const report = checkChat({
      model: "totally-unknown-model",
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
    expect(report.costUSD).toBeUndefined();
  });

  test("missing usage and choices produce an empty report, never a throw", () => {
    const report = checkChat({});
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({});
    expect(report.finishReason).toBeUndefined();
    expect(report.costUSD).toBeUndefined();
  });
});

describe("checkImages", () => {
  test("maps gpt-image usage fields", () => {
    const report = checkImages({
      data: [{ b64_json: "aGVsbG8=" }],
      usage: { input_tokens: 120, output_tokens: 4160, total_tokens: 4280 },
    });
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 120, outputTokens: 4160, totalTokens: 4280 });
  });

  test("empty data warns", () => {
    const report = checkImages({ data: [] });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.severity).toBe("warning");
    expect(report.warnings[0]?.path).toEqual(["data"]);
  });

  test("missing data warns too (dall-e responses without images)", () => {
    const report = checkImages({});
    expect(report.warnings).toHaveLength(1);
  });
});
