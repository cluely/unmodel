import { describe, expect, test } from "bun:test";
import { checkChat } from "./check";

describe("anthropic.checkChat", () => {
  test("clean end_turn response has no warnings", () => {
    const report = checkChat({
      model: "claude-sonnet-4-5",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("end_turn");
  });

  test("max_tokens stop reason warns about truncation", () => {
    const report = checkChat({ model: "claude-sonnet-4-5", stop_reason: "max_tokens" });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.severity).toBe("warning");
    expect(report.warnings[0]?.code).toBe("over_output_limit");
    expect(report.warnings[0]?.message).toContain("truncated");
  });

  test("refusal stop reason warns", () => {
    const report = checkChat({ model: "claude-opus-5", stop_reason: "refusal" });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.message).toContain("refusal");
    expect(report.warnings[0]?.meta?.stopReason).toBe("refusal");
  });

  test("model_context_window_exceeded warns as over_context", () => {
    const report = checkChat({ stop_reason: "model_context_window_exceeded" });
    expect(report.warnings[0]?.code).toBe("over_context");
  });

  test("usage folds cache reads into inputTokens (Anthropic reports them separately)", () => {
    const report = checkChat({
      model: "claude-sonnet-4-5",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 3000,
      },
    });
    expect(report.usage.inputTokens).toBe(3000); // 1000 fresh + 2000 cache reads
    expect(report.usage.cachedInputTokens).toBe(2000);
    expect(report.usage.cacheWriteTokens).toBe(3000);
    expect(report.usage.outputTokens).toBe(500);
    expect(report.usage.totalTokens).toBe(6500);
  });

  test("costUSD prices each bucket at its own rate", () => {
    // claude-sonnet-4-5: input $3/M, output $15/M, cacheRead $0.3/M, cacheWrite $3.75/M
    const report = checkChat({
      model: "claude-sonnet-4-5",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 3000,
      },
    });
    // 1000*3/1M + 2000*0.3/1M + 3000*3.75/1M + 500*15/1M
    expect(report.costUSD).toBeCloseTo(0.003 + 0.0006 + 0.01125 + 0.0075, 10);
  });

  test("dated model ids fall back to their catalog prefix", () => {
    // Not in the catalog verbatim; strips to claude-opus-4-6 (input $5/M, output $25/M).
    const report = checkChat({
      model: "claude-opus-4-6-20260204",
      stop_reason: "end_turn",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    expect(report.costUSD).toBeCloseTo(5, 10);
  });

  test("unknown model yields no cost", () => {
    const report = checkChat({
      model: "totally-unknown",
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 100 },
    });
    expect(report.costUSD).toBeUndefined();
    expect(report.usage.inputTokens).toBe(100);
  });

  test("never throws on empty responses", () => {
    const report = checkChat({});
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBeUndefined();
    expect(report.usage.inputTokens).toBeUndefined();
    expect(report.costUSD).toBeUndefined();
  });

  test("absent fields are absent KEYS, not explicit undefined (parity with other providers)", () => {
    const report = checkChat({});
    expect(Object.keys(report)).toEqual(["warnings", "usage"]);
    expect(Object.keys(report.usage)).toEqual([]);
    expect("finishReason" in report).toBe(false);
    expect("costUSD" in report).toBe(false);
  });

  test("dated -YYYY-MM-DD model ids also resolve via the shared catalog lookup", () => {
    const report = checkChat({
      model: "claude-opus-4-6-2026-02-04",
      stop_reason: "end_turn",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    expect(report.costUSD).toBeCloseTo(5, 10);
  });
});
