import { describe, expect, test } from "bun:test";
import { checkJob } from "./check";

describe("revai.checkJob", () => {
  test("a failed job yields a transcription_failed warning", () => {
    const report = checkJob({
      id: "Umx5c6F7pH7r",
      status: "failed",
      failure: "invalid_media",
      failure_detail: "speaker_channels_count exceeds the channels in the audio",
    });
    expect(report.finishReason).toBe("failed");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("transcription_failed");
    expect(report.warnings[0]?.message).toContain("invalid_media");
  });

  test("a transcribed job is priced from duration_seconds", () => {
    const report = checkJob({ status: "transcribed", duration_seconds: 3600, transcriber: "machine" });
    expect(report.warnings).toEqual([]);
    // 60 minutes x ($0.20/hr ÷ 60) = $0.20.
    expect(report.costUSD).toBeCloseTo(0.2, 10);
    expect(report.usage).toEqual({});
  });

  test("an omitted transcriber prices at the machine default", () => {
    const report = checkJob({ status: "transcribed", duration_seconds: 600 });
    expect(report.costUSD).toBeCloseTo(10 * (0.2 / 60), 10);
  });

  test("the 15-second minimum and channel multiplier apply", () => {
    expect(checkJob({ status: "transcribed", duration_seconds: 2 }).costUSD).toBeCloseTo(
      (15 / 60) * (0.2 / 60),
      12,
    );
    expect(
      checkJob({ status: "transcribed", duration_seconds: 3600, speaker_channels_count: 2 }).costUSD,
    ).toBeCloseTo(0.4, 10);
  });

  test("human jobs price at the per-minute human rate", () => {
    const report = checkJob({ status: "transcribed", duration_seconds: 120, transcriber: "human" });
    expect(report.costUSD).toBeCloseTo(2 * 1.99, 10);
  });

  test("unknown transcribers and missing durations yield no cost", () => {
    expect(
      checkJob({ status: "transcribed", duration_seconds: 60, transcriber: "reverb-3" }).costUSD,
    ).toBeUndefined();
    expect(checkJob({ status: "in_progress" }).costUSD).toBeUndefined();
  });

  test("never throws on an empty object", () => {
    const report = checkJob({});
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBeUndefined();
  });
});
