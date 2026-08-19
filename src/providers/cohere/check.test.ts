import { describe, expect, test } from "bun:test";
import { checkChat } from "./check";

// command-r-08-2024 catalog rates (USD per 1M): input 0.15, output 0.6.
const COMMAND_R = "command-r-08-2024";

describe("cohere.checkChat", () => {
  test("clean response: usage from tokens, cost from billed_units", () => {
    const report = checkChat(
      {
        finish_reason: "COMPLETE",
        usage: {
          billed_units: { input_tokens: 1000, output_tokens: 500 },
          tokens: { input_tokens: 1200, output_tokens: 510 },
        },
      },
      COMMAND_R,
    );
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("COMPLETE");
    expect(report.usage).toEqual({ inputTokens: 1200, outputTokens: 510, totalTokens: 1710 });
    // billed: 1000 * $0.15/M + 500 * $0.6/M
    expect(report.costUSD).toBeCloseTo(0.00045, 10);
  });

  test("MAX_TOKENS warns over_output_limit", () => {
    const report = checkChat({ finish_reason: "MAX_TOKENS" }, COMMAND_R);
    expect(report.warnings.map((w) => w.code)).toEqual(["over_output_limit"]);
    expect(report.warnings[0]?.model).toBe(COMMAND_R);
  });

  test("ERROR and TIMEOUT warn that the content is unreliable", () => {
    expect(checkChat({ finish_reason: "ERROR" }).warnings[0]?.code).toBe("invalid_shape");
    expect(checkChat({ finish_reason: "TIMEOUT" }).warnings[0]?.code).toBe("invalid_shape");
    expect(checkChat({ finish_reason: "TOOL_CALL" }).warnings).toEqual([]);
  });

  test("falls back to raw tokens for cost when billed_units is absent", () => {
    const report = checkChat(
      { usage: { tokens: { input_tokens: 1_000_000, output_tokens: 0 } } },
      COMMAND_R,
    );
    expect(report.costUSD).toBeCloseTo(0.15, 8);
  });

  test("cached_tokens maps to cachedInputTokens", () => {
    const report = checkChat({
      usage: { tokens: { input_tokens: 100, output_tokens: 10 }, cached_tokens: 40 },
    });
    expect(report.usage.cachedInputTokens).toBe(40);
  });

  test("no model → usage but no costUSD; never throws on junk", () => {
    const report = checkChat({
      usage: { tokens: { input_tokens: 10, output_tokens: 5 } },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeUndefined();
    expect(checkChat({}).usage).toEqual({});
    expect(checkChat({ finish_reason: null, usage: null }).warnings).toEqual([]);
  });
});

describe("unmodel/cohere export naming contract", () => {
  test("every `check*` export is a response helper: takes a response and never throws", async () => {
    const subpath = (await import("./index")) as unknown as Record<string, unknown>;
    const checks = Object.entries(subpath).filter(
      ([name, value]) => name.startsWith("check") && typeof value === "function",
    ) as Array<[string, (res: unknown) => unknown]>;

    expect(checks.map(([name]) => name)).toEqual(["checkChat"]);
    for (const [, fn] of checks) {
      // (response) or (response, modelId?) — never the 3-arg pipeline shape.
      expect(fn.length).toBeLessThanOrEqual(2);
      // A response helper is total: junk in, report out, no throw.
      expect(() => fn({})).not.toThrow();
    }
  });

  test("request-side pipeline checks are exported as `validate*`", async () => {
    const subpath = (await import("./index")) as unknown as Record<string, unknown>;
    for (const name of [
      "validateCapabilities",
      "validateResponseFormatCompatibility",
      "validateImages",
    ]) {
      expect(typeof subpath[name]).toBe("function");
      // (params, info, ctx) — not the response-helper shape.
      expect((subpath[name] as (...args: unknown[]) => unknown).length).toBe(3);
    }
  });
});
