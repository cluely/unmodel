import { describe, expect, test } from "bun:test";
import { computeAudioMinutesCostUSD, computeCharacterCostUSD, computeCostUSD } from "./cost";

describe("computeCostUSD", () => {
  test("flat input/output pricing", () => {
    expect(computeCostUSD({ input: 3, output: 15 }, { inputTokens: 1_000_000, outputTokens: 500_000 })).toBe(
      3 + 7.5,
    );
  });

  test("cached input tokens are re-rated at cacheRead", () => {
    const cost = computeCostUSD(
      { input: 10, cacheRead: 1 },
      { inputTokens: 1_000_000, cachedInputTokens: 400_000 },
    );
    // 600k fresh at $10/M + 400k cached at $1/M
    expect(cost).toBeCloseTo(6 + 0.4, 10);
  });

  test("cache write tokens billed at cacheWrite rate", () => {
    expect(computeCostUSD({ cacheWrite: 3.75 }, { cacheWriteTokens: 1_000_000 })).toBe(3.75);
  });

  test("reasoning tokens billed only with an explicit reasoning rate", () => {
    expect(computeCostUSD({ output: 10 }, { outputTokens: 0, reasoningTokens: 1_000_000 })).toBe(0);
    expect(computeCostUSD({ reasoning: 5 }, { reasoningTokens: 1_000_000 })).toBe(5);
  });

  test("undefined when no pricing is known", () => {
    expect(computeCostUSD(undefined, { inputTokens: 100 })).toBeUndefined();
    expect(computeCostUSD({}, { inputTokens: 100 })).toBeUndefined();
  });
});

describe("computeCharacterCostUSD", () => {
  test("prices by USD per 1M input characters", () => {
    expect(computeCharacterCostUSD({ perMillionCharacters: 15 }, 1_000_000)).toBe(15);
    expect(computeCharacterCostUSD({ perMillionCharacters: 15 }, 200)).toBeCloseTo(0.003, 10);
  });

  test("zero characters price to zero, not undefined", () => {
    expect(computeCharacterCostUSD({ perMillionCharacters: 15 }, 0)).toBe(0);
  });

  test("undefined when no character rate is known", () => {
    expect(computeCharacterCostUSD(undefined, 100)).toBeUndefined();
    expect(computeCharacterCostUSD({}, 100)).toBeUndefined();
    expect(computeCharacterCostUSD({ input: 3, output: 15 }, 100)).toBeUndefined();
  });
});

describe("computeAudioMinutesCostUSD", () => {
  test("prices by USD per minute of audio", () => {
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, 10)).toBeCloseTo(0.06, 10);
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, 0.5)).toBeCloseTo(0.003, 10);
  });

  test("zero minutes price to zero, not undefined", () => {
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, 0)).toBe(0);
  });

  test("undefined when no per-minute rate is known", () => {
    expect(computeAudioMinutesCostUSD(undefined, 10)).toBeUndefined();
    expect(computeAudioMinutesCostUSD({}, 10)).toBeUndefined();
    expect(computeAudioMinutesCostUSD({ inputAudio: 100 }, 10)).toBeUndefined();
  });
});
