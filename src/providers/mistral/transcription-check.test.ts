import { describe, expect, test } from "bun:test";
import { checkTranscription } from "./transcription-check";

describe("mistral.checkTranscription", () => {
  test("prices from prompt_audio_seconds and maps token usage", () => {
    const report = checkTranscription({
      model: "voxtral-mini-2602",
      text: "This week, I traveled to Chicago",
      language: "en",
      usage: {
        prompt_tokens: 4,
        completion_tokens: 635,
        total_tokens: 3264,
        prompt_audio_seconds: 600,
      },
    });
    expect(report.warnings).toEqual([]);
    // 10 minutes x $0.003/min.
    expect(report.costUSD).toBeCloseTo(0.03, 10);
    expect(report.usage).toEqual({ inputTokens: 4, outputTokens: 635, totalTokens: 3264 });
  });

  test("the -latest alias prices at the Voxtral Mini Transcribe 2 rate", () => {
    const report = checkTranscription({
      model: "voxtral-mini-latest",
      text: "hi",
      usage: { prompt_audio_seconds: 60 },
    });
    expect(report.costUSD).toBeCloseTo(0.003, 10);
  });

  test("an empty transcript warns", () => {
    const report = checkTranscription({
      model: "voxtral-mini-2602",
      text: "",
      usage: { prompt_audio_seconds: 30 },
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_transcript");
  });

  test("unknown models, unpriced models and missing audio length yield no cost", () => {
    expect(
      checkTranscription({ model: "voxtral-mini-2699", usage: { prompt_audio_seconds: 60 } }).costUSD,
    ).toBeUndefined();
    // voxtral-mini-2507 carries no published rate.
    expect(
      checkTranscription({ model: "voxtral-mini-2507", usage: { prompt_audio_seconds: 60 } }).costUSD,
    ).toBeUndefined();
    expect(checkTranscription({ model: "voxtral-mini-2602", text: "hi" }).costUSD).toBeUndefined();
  });

  test("never throws on an empty object", () => {
    const report = checkTranscription({});
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({});
    expect(report.costUSD).toBeUndefined();
  });
});
