import { describe, expect, test } from "bun:test";
import { checkConverse } from "./check";

// anthropic.claude-sonnet-4-5-20250929-v1:0 catalog rates (USD per 1M):
//   input 3, output 15, cacheRead 0.3, cacheWrite 3.75
const SONNET = "anthropic.claude-sonnet-4-5-20250929-v1:0";

describe("amazon-bedrock.checkConverse", () => {
  test("clean response: usage mapped, no warnings, cost from catalog", () => {
    const report = checkConverse(
      {
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
      SONNET,
    );
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("end_turn");
    expect(report.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    // 100 * $3/M + 50 * $15/M
    expect(report.costUSD).toBeCloseTo(0.00105, 8);
  });

  test("max_tokens stopReason warns over_output_limit", () => {
    const report = checkConverse({ stopReason: "max_tokens" });
    expect(report.warnings.map((w) => w.code)).toEqual(["over_output_limit"]);
    expect(report.finishReason).toBe("max_tokens");
  });

  test("guardrail_intervened and content_filtered warn", () => {
    expect(checkConverse({ stopReason: "guardrail_intervened" }).warnings[0]?.code).toBe(
      "unsupported_capability",
    );
    expect(checkConverse({ stopReason: "content_filtered" }).warnings[0]?.code).toBe(
      "unsupported_capability",
    );
  });

  test("model_context_window_exceeded warns over_context", () => {
    const report = checkConverse({ stopReason: "model_context_window_exceeded" });
    expect(report.warnings[0]?.code).toBe("over_context");
  });

  test("malformed output stopReasons warn invalid_shape", () => {
    expect(checkConverse({ stopReason: "malformed_model_output" }).warnings[0]?.code).toBe(
      "invalid_shape",
    );
    expect(checkConverse({ stopReason: "malformed_tool_use" }).warnings[0]?.code).toBe(
      "invalid_shape",
    );
  });

  test("cache reads are folded back into inputTokens and re-rated", () => {
    const report = checkConverse(
      {
        stopReason: "end_turn",
        usage: {
          // Bedrock's inputTokens is the NON-cached remainder only.
          inputTokens: 100,
          cacheReadInputTokens: 700,
          cacheWriteInputTokens: 200,
          outputTokens: 50,
          totalTokens: 1050,
        },
      },
      SONNET,
    );
    expect(report.usage).toEqual({
      inputTokens: 800,
      outputTokens: 50,
      cachedInputTokens: 700,
      cacheWriteTokens: 200,
      totalTokens: 1050,
    });
    // 100*$3/M fresh + 700*$0.3/M cacheRead + 200*$3.75/M cacheWrite + 50*$15/M output
    expect(report.costUSD).toBeCloseTo((300 + 210 + 750 + 750) / 1_000_000, 10);
  });

  test("regional-prefix and ARN model ids still price via resolution", () => {
    const report = checkConverse(
      { usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 } },
      `arn:aws:bedrock:us-east-1::foundation-model/${SONNET}`,
    );
    expect(report.costUSD).toBeCloseTo(3, 6);
  });

  test("no modelId → usage but no costUSD; never throws on junk", () => {
    const report = checkConverse({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    expect(report.costUSD).toBeUndefined();
    expect(checkConverse({}).usage).toEqual({});
    expect(checkConverse({ stopReason: null, usage: null }).warnings).toEqual([]);
  });
});
