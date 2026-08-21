import { describe, expect, test } from "bun:test";
import {
  computeAudioMinutesCostUSD,
  computeCharacterCostUSD,
  computeCostUSD,
  minutes,
  minutesFromMilliseconds,
  minutesFromSeconds,
} from "./cost";

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

  test("audio input tokens are re-rated at inputAudio", () => {
    const cost = computeCostUSD(
      { input: 0.3, inputAudio: 1 },
      { inputTokens: 1_000_000, audioInputTokens: 400_000 },
    );
    // 600k text at $0.30/M + 400k audio at $1.00/M
    expect(cost).toBeCloseTo(0.18 + 0.4, 10);
  });

  test("audio tokens fall back to the text rate when no inputAudio is published", () => {
    // The fallback matters: without it, a model whose catalog row has no audio
    // rate would bill its audio at ZERO once the caller starts reporting the
    // slice — a regression dressed up as a feature.
    const withFallback = computeCostUSD(
      { input: 1.25 },
      { inputTokens: 1_000_000, audioInputTokens: 400_000 },
    );
    const ignoringTheSlice = computeCostUSD({ input: 1.25 }, { inputTokens: 1_000_000 });
    expect(withFallback).toBeCloseTo(1.25, 10);
    expect(withFallback).toBe(ignoringTheSlice);
  });

  test("audio and cached slices come out of the same input total", () => {
    const cost = computeCostUSD(
      { input: 10, cacheRead: 1, inputAudio: 20 },
      { inputTokens: 1_000_000, cachedInputTokens: 300_000, audioInputTokens: 200_000 },
    );
    // 500k fresh at $10/M + 300k cached at $1/M + 200k audio at $20/M
    expect(cost).toBeCloseTo(5 + 0.3 + 4, 10);
  });

  test("slices that over-sum the total floor the fresh bill at zero, never a credit", () => {
    const cost = computeCostUSD(
      { input: 10, inputAudio: 20 },
      { inputTokens: 100, audioInputTokens: 400 },
    );
    expect(cost).toBeCloseTo((400 * 20) / 1_000_000, 12);
  });

  test("no audio tokens leaves the arithmetic exactly as it was", () => {
    expect(
      computeCostUSD({ input: 3, inputAudio: 9 }, { inputTokens: 1_000_000, audioInputTokens: 0 }),
    ).toBe(3);
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
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, minutes(10))).toBeCloseTo(0.06, 10);
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, minutes(0.5))).toBeCloseTo(
      0.003,
      10,
    );
  });

  test("zero minutes price to zero, not undefined", () => {
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, minutes(0))).toBe(0);
  });

  test("undefined when no per-minute rate is known", () => {
    expect(computeAudioMinutesCostUSD(undefined, minutes(10))).toBeUndefined();
    expect(computeAudioMinutesCostUSD({}, minutes(10))).toBeUndefined();
    expect(computeAudioMinutesCostUSD({ inputAudio: 100 }, minutes(10))).toBeUndefined();
  });
});

describe("the minutes unit", () => {
  test("the two conversions are the two the call sites were spelling by hand", () => {
    expect(minutesFromSeconds(90)).toBeCloseTo(1.5, 10);
    expect(minutesFromMilliseconds(90_000)).toBeCloseTo(1.5, 10);
    expect(minutes(1.5)).toBeCloseTo(1.5, 10);
    // Branded values are still numbers, so arithmetic at a call site works.
    expect(minutesFromSeconds(90) * 2).toBeCloseTo(3, 10);
  });

  test("a seconds value cannot reach the per-minute rate", () => {
    const seconds = 600;
    // @ts-expect-error — the 60x overcharge this brand exists to prevent.
    computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, seconds);
    // @ts-expect-error — and untagged arithmetic is caught too, which is what
    // makes the brand worth more than a rename: `seconds / 60` is right here
    // and wrong three lines later, and only one of them is reviewable.
    computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, seconds / 60);
    // The conversion is the way through, and it is the same number.
    expect(computeAudioMinutesCostUSD({ perAudioMinute: 0.006 }, minutesFromSeconds(seconds))).toBe(
      0.06,
    );
  });
});
