import { describe, expect, test } from "bun:test";
import { checkGenerateContent } from "./check";
import { models } from "../../catalog/google.gen";

describe("finish reasons", () => {
  test("STOP produces no warnings", () => {
    const report = checkGenerateContent({ candidates: [{ finishReason: "STOP" }] });
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("STOP");
  });

  test("MAX_TOKENS -> truncated warning", () => {
    const report = checkGenerateContent({ candidates: [{ finishReason: "MAX_TOKENS" }] });
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
    const report = checkGenerateContent({ candidates: [{ finishReason: reason }] });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.code).toBe("unsupported_capability");
    expect(report.warnings[0]!.meta?.kind).toBe("content_filtered");
    expect(report.warnings[0]!.meta?.finishReason).toBe(reason);
  });

  test("an unrecognized finishReason is not treated as filtering", () => {
    const report = checkGenerateContent({ candidates: [{ finishReason: "OTHER" }] });
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("OTHER");
  });

  test("promptFeedback.blockReason -> content_filtered (prompt blocked, empty candidates)", () => {
    const report = checkGenerateContent({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] });
    expect(report.finishReason).toBeUndefined();
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.meta?.kind).toBe("content_filtered");
    expect(report.warnings[0]!.path).toEqual(["promptFeedback", "blockReason"]);
  });

  test("BLOCK_REASON_UNSPECIFIED is not a block", () => {
    const report = checkGenerateContent({
      candidates: [{ finishReason: "STOP" }],
      promptFeedback: { blockReason: "BLOCK_REASON_UNSPECIFIED" },
    });
    expect(report.warnings).toEqual([]);
  });
});

describe("usage mapping", () => {
  test("wire field names map onto UsageReport", () => {
    const report = checkGenerateContent({
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
    const report = checkGenerateContent({ candidates: [{ finishReason: "STOP" }] });
    expect(report.usage).toEqual({});
    expect(report.costUSD).toBeUndefined();
  });
});

describe("costUSD", () => {
  const cost = models["gemini-2.5-flash"].cost!;

  test("prices via exact modelVersion; cached re-rated, thoughts billed as output", () => {
    const report = checkGenerateContent({
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
    const report = checkGenerateContent({
      modelVersion: "gemini-2.5-flash-preview-05-20",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    });
    // Must resolve to "gemini-2.5-flash" ($0.3/1M input), not miss the catalog.
    expect(report.costUSD).toBeCloseTo(cost.input!, 12);
  });

  test("models/ prefix is stripped", () => {
    const report = checkGenerateContent({
      modelVersion: "models/gemini-2.5-flash",
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    });
    expect(report.costUSD).toBeCloseTo(cost.input!, 12);
  });

  test("unknown modelVersion -> costUSD undefined", () => {
    const report = checkGenerateContent({
      modelVersion: "gemini-unreleased-42",
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 10 },
    });
    expect(report.costUSD).toBeUndefined();
  });
});
