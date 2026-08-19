import { describe, expect, test } from "bun:test";
import { checkPreRecorded } from "./check";

describe("gladia.checkPreRecorded", () => {
  test("error status yields a transcription_failed warning", () => {
    const report = checkPreRecorded({
      id: "6c09400e",
      status: "error",
      error_code: 400,
    });
    expect(report.finishReason).toBe("error");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("transcription_failed");
    expect(report.warnings[0]?.message).toContain("400");
  });

  test("a finished job is priced from billing_time", () => {
    const report = checkPreRecorded({
      status: "done",
      request_params: { model: "solaria-1" },
      result: {
        metadata: { audio_duration: 3600, billing_time: 1800 },
        transcription: { full_transcript: "hello" },
      },
    });
    expect(report.warnings).toEqual([]);
    // billing_time wins: 30 minutes x ($0.61/hr ÷ 60).
    expect(report.costUSD).toBeCloseTo(30 * (0.61 / 60), 10);
    expect(report.usage).toEqual({});
  });

  test("audio_duration is the fallback and the default model still prices", () => {
    const report = checkPreRecorded({
      status: "done",
      result: { metadata: { audio_duration: 600 }, transcription: { full_transcript: "hi" } },
    });
    expect(report.costUSD).toBeCloseTo(10 * (0.61 / 60), 10);
  });

  test("an empty transcript warns", () => {
    const report = checkPreRecorded({
      status: "done",
      file: { audio_duration: 60 },
      result: { transcription: { full_transcript: "" } },
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_transcript");
  });

  test("unknown models and missing durations yield no cost", () => {
    expect(
      checkPreRecorded({
        status: "done",
        request_params: { model: "solaria-9" },
        result: { metadata: { audio_duration: 60 } },
      }).costUSD,
    ).toBeUndefined();
    expect(checkPreRecorded({ status: "done" }).costUSD).toBeUndefined();
  });

  test("never throws on an empty object", () => {
    const report = checkPreRecorded({});
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBeUndefined();
  });
});
