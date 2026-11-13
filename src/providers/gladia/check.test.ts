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

  test("a finished job carries no costUSD: Gladia prices in EUR only", () => {
    const report = checkPreRecorded({
      status: "done",
      request_params: { model: "solaria-1" },
      result: {
        metadata: { audio_duration: 3600, billing_time: 1800 },
        transcription: { full_transcript: "hello" },
      },
    });
    expect(report.warnings).toEqual([]);
    expect(report.costUSD).toBeUndefined();
    expect(report.usage).toEqual({});
  });

  test("the default model and solaria-3 carry no costUSD either", () => {
    for (const request_params of [undefined, { model: "solaria-3" }]) {
      const report = checkPreRecorded({
        status: "done",
        request_params,
        result: { metadata: { audio_duration: 600 }, transcription: { full_transcript: "hi" } },
      });
      expect(report.costUSD).toBeUndefined();
    }
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
