import { describe, expect, test } from "bun:test";
import { checkTranscription } from "./check";

describe("soniox.checkTranscription", () => {
  test("error status yields a transcription_failed warning", () => {
    const report = checkTranscription({
      id: "t1",
      status: "error",
      error_type: "audio_download_failed",
      error_message: "could not fetch audio_url",
    });
    expect(report.finishReason).toBe("error");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("transcription_failed");
    expect(report.warnings[0]?.message).toContain("audio_download_failed");
  });

  test("completed transcription is priced from audio_duration_ms", () => {
    const report = checkTranscription({
      id: "t2",
      status: "completed",
      model: "stt-async-v5",
      audio_duration_ms: 3_600_000,
    });
    expect(report.warnings).toEqual([]);
    // 60 minutes x ($0.10/hr ÷ 60) = $0.10.
    expect(report.costUSD).toBeCloseTo(0.1, 10);
    expect(report.usage).toEqual({});
  });

  test("unknown model or missing duration yields no cost", () => {
    expect(
      checkTranscription({ status: "completed", model: "stt-async-v9", audio_duration_ms: 60000 })
        .costUSD,
    ).toBeUndefined();
    expect(checkTranscription({ status: "completed", model: "stt-async-v5" }).costUSD).toBeUndefined();
  });

  test("realtime ids price at the published $0.12/hr streaming rate", () => {
    // 60 minutes x ($0.12/hr ÷ 60) = $0.12.
    const report = checkTranscription({
      status: "completed",
      model: "stt-rt-v5",
      audio_duration_ms: 3_600_000,
    });
    expect(report.costUSD).toBeCloseTo(0.12, 10);
  });

  test("never throws on an empty object", () => {
    const report = checkTranscription({});
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBeUndefined();
  });
});
