import { describe, expect, test } from "bun:test";
import { checkTranscription } from "./check";

describe("elevenlabs.checkTranscription", () => {
  test("prices actual usage from audio_duration_secs at $0.22/hour", () => {
    const report = checkTranscription(
      {
        language_code: "en",
        language_probability: 0.99,
        text: "hello world",
        audio_duration_secs: 3600,
      },
      { model: "scribe_v2" },
    );
    expect(report.warnings).toEqual([]);
    expect(report.costUSD).toBeCloseTo(0.22, 10);
  });

  test("one minute of audio costs 0.22/60", () => {
    const report = checkTranscription(
      { text: "hi", audio_duration_secs: 60 },
      { model: "scribe_v2" },
    );
    expect(report.costUSD).toBeCloseTo(0.22 / 60, 10);
  });

  test("multi-channel responses are billed per channel", () => {
    const report = checkTranscription(
      {
        transcripts: [{ text: "channel one" }, { text: "channel two" }],
        audio_duration_secs: 60,
      },
      { model: "scribe_v2" },
    );
    expect(report.costUSD).toBeCloseTo((0.22 / 60) * 2, 10);
  });

  test("no model means no cost", () => {
    const report = checkTranscription({ text: "hi", audio_duration_secs: 60 });
    expect(report.costUSD).toBeUndefined();
  });

  test("unknown model means no cost", () => {
    const report = checkTranscription(
      { text: "hi", audio_duration_secs: 60 },
      { model: "scribe_v9" },
    );
    expect(report.costUSD).toBeUndefined();
  });

  test("an empty transcription warns", () => {
    const report = checkTranscription({ text: "", audio_duration_secs: 1 }, { model: "scribe_v2" });
    expect(report.warnings.map((w) => w.code)).toEqual(["invalid_shape"]);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_text");
  });

  test("all-empty multi-channel transcripts warn", () => {
    const report = checkTranscription({ transcripts: [{ text: "" }, {}] });
    expect(report.warnings.map((w) => w.code)).toEqual(["invalid_shape"]);
  });

  test("a 202 webhook acceptance does not warn about missing text", () => {
    const report = checkTranscription({
      message: "Request accepted. Transcription result will be sent to the webhook.",
      request_id: "req_123",
      transcription_id: "tr_456",
    });
    expect(report.warnings).toEqual([]);
    expect(report.costUSD).toBeUndefined();
  });

  test("never throws on junk", () => {
    expect(() => checkTranscription({} as never)).not.toThrow();
  });
});
