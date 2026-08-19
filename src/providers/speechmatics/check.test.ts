import { describe, expect, test } from "bun:test";
import { checkJob } from "./check";

describe("speechmatics.checkJob", () => {
  test("a rejected job yields a transcription_failed warning carrying every error", () => {
    const report = checkJob({
      job: {
        id: "a81ko4eqjl",
        status: "rejected",
        duration: 0,
        errors: [
          { message: "unable to fetch audio: http status code 404" },
          { message: "unable to fetch audio: http status code 404" },
        ],
      },
    });
    expect(report.finishReason).toBe("rejected");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("transcription_failed");
    expect(report.warnings[0]?.message).toContain("http status code 404");
    expect(report.costUSD).toBeUndefined();
  });

  test("a done job is priced from duration seconds and the echoed model", () => {
    const report = checkJob({
      job: {
        status: "done",
        duration: 3600,
        config: { type: "transcription", transcription_config: { model: "enhanced", language: "en" } },
      },
    });
    expect(report.warnings).toEqual([]);
    // 60 minutes x ($0.40/hr ÷ 60) = $0.40.
    expect(report.costUSD).toBeCloseTo(0.4, 10);
    expect(report.usage).toEqual({});
  });

  test("a config without a model prices at the documented standard default", () => {
    const report = checkJob({
      job: { status: "done", duration: 600, config: { transcription_config: { language: "en" } } },
    });
    // 10 minutes x ($0.24/hr ÷ 60).
    expect(report.costUSD).toBeCloseTo((600 / 60) * (0.24 / 60), 10);
  });

  test("the deprecated operating_point still resolves a rate", () => {
    const report = checkJob({
      job: {
        status: "done",
        duration: 60,
        config: { transcription_config: { operating_point: "melia-1", language: "multi" } },
      },
    });
    expect(report.costUSD).toBeCloseTo(0.129 / 60, 10);
  });

  test("unknown models and missing durations yield no cost", () => {
    expect(
      checkJob({
        job: { status: "done", duration: 60, config: { transcription_config: { model: "ultra-9" } } },
      }).costUSD,
    ).toBeUndefined();
    expect(
      checkJob({ job: { status: "done", config: { transcription_config: { model: "enhanced" } } } })
        .costUSD,
    ).toBeUndefined();
  });

  test("never throws on an empty object", () => {
    const report = checkJob({});
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBeUndefined();
    expect(report.costUSD).toBeUndefined();
  });
});
