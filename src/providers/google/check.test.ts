import { describe, expect, test } from "bun:test";
import { checkChat } from "./check";
import { models } from "../../catalog/google.gen";

describe("finish reasons", () => {
  test("STOP produces no warnings", () => {
    const report = checkChat({ candidates: [{ finishReason: "STOP" }] });
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("STOP");
  });

  test("MAX_TOKENS -> truncated warning", () => {
    const report = checkChat({ candidates: [{ finishReason: "MAX_TOKENS" }] });
    expect(report.finishReason).toBe("MAX_TOKENS");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.meta?.kind).toBe("truncated");
  });

  test.each([
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
  ])("%s -> content_filtered warning", (reason) => {
    const report = checkChat({ candidates: [{ finishReason: reason }] });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.code).toBe("unsupported_capability");
    expect(report.warnings[0]!.meta?.kind).toBe("content_filtered");
    expect(report.warnings[0]!.meta?.finishReason).toBe(reason);
  });

  test("an unrecognized finishReason is not treated as filtering", () => {
    const report = checkChat({ candidates: [{ finishReason: "OTHER" }] });
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("OTHER");
  });

  test("promptFeedback.blockReason -> content_filtered (prompt blocked, empty candidates)", () => {
    const report = checkChat({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] });
    expect(report.finishReason).toBeUndefined();
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.meta?.kind).toBe("content_filtered");
    expect(report.warnings[0]!.path).toEqual(["promptFeedback", "blockReason"]);
  });

  test("BLOCK_REASON_UNSPECIFIED is not a block", () => {
    const report = checkChat({
      candidates: [{ finishReason: "STOP" }],
      promptFeedback: { blockReason: "BLOCK_REASON_UNSPECIFIED" },
    });
    expect(report.warnings).toEqual([]);
  });
});

describe("usage mapping", () => {
  test("wire field names map onto UsageReport", () => {
    const report = checkChat({
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 100,
        thoughtsTokenCount: 50,
        cachedContentTokenCount: 400,
        totalTokenCount: 1150,
      },
    });
    expect(report.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      reasoningTokens: 50,
      cachedInputTokens: 400,
      totalTokens: 1150,
    });
  });

  test("missing usageMetadata yields an empty usage report", () => {
    const report = checkChat({ candidates: [{ finishReason: "STOP" }] });
    expect(report.usage).toEqual({});
    expect(report.costUSD).toBeUndefined();
  });
});

describe("costUSD", () => {
  const cost = models["gemini-2.5-flash"].cost!;

  test("prices via exact modelVersion; cached re-rated, thoughts billed as output", () => {
    const report = checkChat({
      modelVersion: "gemini-2.5-flash",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 100,
        thoughtsTokenCount: 50,
        cachedContentTokenCount: 400,
        totalTokenCount: 1150,
      },
    });
    const expected =
      (600 * cost.input! + 400 * cost.cacheRead! + 150 * cost.output!) / 1_000_000;
    expect(report.costUSD).toBeCloseTo(expected, 12);
  });

  test("prefix fallback: dated preview version resolves to the catalog id", () => {
    const report = checkChat({
      modelVersion: "gemini-2.5-flash-preview-05-20",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    });
    // Must resolve to "gemini-2.5-flash" ($0.3/1M input), not miss the catalog.
    expect(report.costUSD).toBeCloseTo(cost.input!, 12);
  });

  test("models/ prefix is stripped", () => {
    const report = checkChat({
      modelVersion: "models/gemini-2.5-flash",
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    });
    expect(report.costUSD).toBeCloseTo(cost.input!, 12);
  });

  test("unknown modelVersion -> costUSD undefined", () => {
    const report = checkChat({
      modelVersion: "gemini-unreleased-42",
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 10 },
    });
    expect(report.costUSD).toBeUndefined();
  });
});

describe("per-modality prompt tokens", () => {
  /**
   * The shape below is a real response, not a sketch: a one-second WAV plus a
   * five-token prompt came back with `promptTokenCount: 6` and a
   * `promptTokensDetails` of TEXT 5 + AUDIO 1 — the entries SUM to the total,
   * which is what makes re-rating (rather than adding) the right arithmetic.
   */
  const LIVE_PROBE = {
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 10,
      totalTokenCount: 16,
      promptTokensDetails: [
        { modality: "TEXT", tokenCount: 5 },
        { modality: "AUDIO", tokenCount: 1 },
      ],
    },
    modelVersion: "gemini-2.5-flash",
  };

  test("the AUDIO slice is billed at the model's inputAudio rate", () => {
    const cost = models["gemini-2.5-flash"].cost!;
    expect(cost.inputAudio).toBeDefined();
    const report = checkChat(LIVE_PROBE);
    // 5 text tokens at $0.30/M + 1 audio token at $1.00/M + 10 output at $2.50/M
    expect(report.costUSD).toBeCloseTo(
      (5 * cost.input!) / 1_000_000 + (1 * cost.inputAudio!) / 1_000_000 + (10 * cost.output!) / 1_000_000,
      15,
    );
    // The raw usage stays raw: the breakdown is a pricing input, not a report field.
    expect(report.usage.inputTokens).toBe(6);
  });

  test("re-rating is visibly different from ignoring the breakdown", () => {
    const withDetails = checkChat(LIVE_PROBE);
    const { promptTokensDetails: _dropped, ...flat } = LIVE_PROBE.usageMetadata;
    const withoutDetails = checkChat({ ...LIVE_PROBE, usageMetadata: flat });
    expect(withDetails.costUSD).toBeGreaterThan(withoutDetails.costUSD!);
  });

  test("a response with no breakdown prices exactly as it always did", () => {
    const report = checkChat({
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 10 },
      modelVersion: "gemini-2.5-flash",
    });
    const cost = models["gemini-2.5-flash"].cost!;
    expect(report.costUSD).toBeCloseTo(
      (6 * cost.input!) / 1_000_000 + (10 * cost.output!) / 1_000_000,
      15,
    );
  });

  test("a TEXT-only breakdown adds no audio bill", () => {
    const report = checkChat({
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 6,
        candidatesTokenCount: 10,
        promptTokensDetails: [{ modality: "TEXT", tokenCount: 6 }],
      },
      modelVersion: "gemini-2.5-flash",
    });
    const cost = models["gemini-2.5-flash"].cost!;
    expect(report.costUSD).toBeCloseTo(
      (6 * cost.input!) / 1_000_000 + (10 * cost.output!) / 1_000_000,
      15,
    );
  });
});
