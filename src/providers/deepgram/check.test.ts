import { describe, expect, test } from "bun:test";
import { checkListen } from "./check";
import { NOVA_3_USD_PER_MINUTE } from "./models";

describe("deepgram.checkListen", () => {
  test("prices metadata.duration against the requested model", () => {
    const report = checkListen(
      { metadata: { duration: 60 }, results: { channels: [{ alternatives: [{ transcript: "hi" }] }] } },
      "nova-3",
    );
    expect(report.warnings).toEqual([]);
    // 1 minute x the pre-recorded $0.0077/min rate.
    expect(report.costUSD).toBeCloseTo(NOVA_3_USD_PER_MINUTE, 10);
  });

  test("falls back to metadata.model_info arch when no model id is passed", () => {
    const report = checkListen({
      metadata: {
        duration: 120,
        model_info: { "uuid-1": { name: "general-nova-3", version: "2026.1", arch: "nova-3" } },
      },
    });
    expect(report.costUSD).toBeCloseTo(2 * NOVA_3_USD_PER_MINUTE, 10);
  });

  test("empty transcript yields an empty_transcript warning", () => {
    const report = checkListen({
      metadata: { duration: 5 },
      results: { channels: [{ alternatives: [{ transcript: "" }] }] },
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_transcript");
  });

  test("unknown model or missing duration yields no cost; never throws", () => {
    expect(checkListen({ metadata: { duration: 60 } }, "base-general").costUSD).toBeUndefined();
    expect(checkListen({}, "nova-3").costUSD).toBeUndefined();
    expect(checkListen({}).warnings).toEqual([]);
  });
});
