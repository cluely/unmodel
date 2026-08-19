import { describe, expect, test } from "bun:test";
import { checkTranscript } from "./check";

describe("assemblyai.checkTranscript", () => {
  test("error status yields a transcription_failed warning", () => {
    const report = checkTranscript({
      id: "t1",
      status: "error",
      error: "Download error: unable to download audio_url",
    });
    expect(report.finishReason).toBe("error");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("transcription_failed");
    expect(report.warnings[0]?.message).toContain("Download error");
  });

  test("completed transcript is priced from audio_duration + speech_model", () => {
    const report = checkTranscript({
      status: "completed",
      speech_model: "universal-2",
      audio_duration: 1800,
      text: "hello world",
    });
    expect(report.warnings).toEqual([]);
    // 30 minutes x ($0.15/hr ÷ 60) = $0.075.
    expect(report.costUSD).toBeCloseTo(0.075, 10);
    expect(report.usage).toEqual({});
  });

  test("completed with empty text warns empty_transcript", () => {
    const report = checkTranscript({ status: "completed", text: "" });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_transcript");
  });

  test("unknown model or missing duration yields no cost; never throws", () => {
    expect(
      checkTranscript({ status: "completed", speech_model: "best", audio_duration: 60, text: "x" })
        .costUSD,
    ).toBeUndefined();
    expect(checkTranscript({}).warnings).toEqual([]);
    expect(checkTranscript({}).finishReason).toBeUndefined();
  });
});
