import { describe, expect, test } from "bun:test";
import {
  transcription,
  toFormData,
  AUDIO_TRANSCRIPTIONS_URL,
  MAX_KNOWN_SPEAKERS,
} from "./transcription";
import { TRANSCRIPTION_MAX_FILE_BYTES } from "./constraints";
import { transcriptionModels } from "./audio-models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the Tier-A compile-time surface so runtime enforcement of
// type-blocked params can be exercised.
const safeUnchecked = transcription.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const audio = (bytes = 1024): Blob => new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });

describe("openai.transcription happy path", () => {
  test("returns the multipart params with hidden toSdk/request", () => {
    const file = audio();
    const v = transcription({ model: "gpt-transcribe", file, language: "en" });

    expect(Object.keys(v)).toEqual(["model", "file", "language"]);
    expect(v.request.url).toBe(AUDIO_TRANSCRIPTIONS_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary, so no content-type is set.
    expect(v.request.headers).toEqual({});
  });

  test("unknown model falls back to the escape arm with a warning", () => {
    const r = transcription.safe({ model: "whisper-9", file: audio() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
  });

  test("every documented model id is in the hand catalog", () => {
    expect(Object.keys(transcriptionModels).sort()).toEqual([
      "gpt-4o-mini-transcribe",
      "gpt-4o-mini-transcribe-2025-12-15",
      "gpt-4o-transcribe",
      "gpt-4o-transcribe-diarize",
      "gpt-transcribe",
      "whisper-1",
    ]);
  });
});

describe("openai.transcription per-model rules", () => {
  test("response_format is narrowed to json on the gpt-4o-transcribe family", () => {
    const r = safeUnchecked({
      model: "gpt-4o-transcribe",
      file: audio(),
      response_format: "verbose_json",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["response_format"]);
    }
    expect(transcription.safe({ model: "gpt-4o-transcribe", file: audio(), response_format: "json" }).ok).toBe(true);
  });

  test("verbose_json + timestamp_granularities pass on whisper-1", () => {
    const r = transcription.safe({
      model: "whisper-1",
      file: audio(),
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("timestamp_granularities is denied outside whisper-1", () => {
    const r = safeUnchecked({
      model: "gpt-4o-transcribe",
      file: audio(),
      timestamp_granularities: ["word"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["timestamp_granularities"]);
      expect(String(issue?.meta?.source)).toContain("guides/speech-to-text");
    }
  });

  test("timestamp_granularities without verbose_json is a pairing error", () => {
    const r = safeUnchecked({
      model: "whisper-1",
      file: audio(),
      response_format: "srt",
      timestamp_granularities: ["word"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["timestamp_granularities"]);
    }
  });

  test("streaming on whisper-1 warns (the docs say it is ignored, not rejected)", () => {
    const r = safeUnchecked({ model: "whisper-1", file: audio(), stream: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["stream"]);
      expect(issue?.message).toContain("silently ignored by the API");
    }
  });

  test("include is denied outside the gpt-4o-transcribe family", () => {
    const denied = safeUnchecked({ model: "whisper-1", file: audio(), include: ["logprobs"] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.errors[0]?.path).toEqual(["include"]);

    const allowed = transcription.safe({
      model: "gpt-4o-mini-transcribe",
      file: audio(),
      include: ["logprobs"],
      response_format: "json",
    });
    expect(allowed.ok).toBe(true);
  });

  test("include with a non-json response_format is a pairing error", () => {
    const r = safeUnchecked({
      model: "gpt-4o-transcribe-diarize",
      file: audio(),
      include: ["logprobs"],
      response_format: "diarized_json",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Denied for diarize AND unpaired with response_format: json.
      expect(r.errors.map((e) => e.code)).toContain("invalid_shape");
    }
  });

  test("prompt is denied on gpt-4o-transcribe-diarize", () => {
    const r = safeUnchecked({
      model: "gpt-4o-transcribe-diarize",
      file: audio(),
      prompt: "hello",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });

  test("keywords/languages are denied outside gpt-transcribe", () => {
    const r = safeUnchecked({ model: "whisper-1", file: audio(), keywords: ["unmodel"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["keywords"]);

    expect(
      transcription.safe({ model: "gpt-transcribe", file: audio(), keywords: ["unmodel"], languages: ["en"] }).ok,
    ).toBe(true);
  });

  test("known speakers are diarize-only, paired, and capped at 4", () => {
    const denied = safeUnchecked({
      model: "whisper-1",
      file: audio(),
      known_speaker_names: ["agent"],
      known_speaker_references: ["data:audio/wav;base64,AA"],
    });
    expect(denied.ok).toBe(false);

    const unpaired = safeUnchecked({
      model: "gpt-4o-transcribe-diarize",
      file: audio(),
      known_speaker_names: ["agent"],
    });
    expect(unpaired.ok).toBe(false);
    if (!unpaired.ok) expect(unpaired.errors[0]?.path).toEqual(["known_speaker_references"]);

    const tooMany = safeUnchecked({
      model: "gpt-4o-transcribe-diarize",
      file: audio(),
      known_speaker_names: ["a", "b", "c", "d", "e"],
      known_speaker_references: ["1", "2", "3", "4", "5"],
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.errors[0]?.message).toContain(`at most ${MAX_KNOWN_SPEAKERS}`);
    }
  });

  test("diarize needs chunking_strategy past 30 declared seconds", () => {
    const r = transcription.safe(
      { model: "gpt-4o-transcribe-diarize", file: audio() },
      { media: [{ path: ["file"], durationSeconds: 45 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["chunking_strategy"]);
    }

    const withStrategy = transcription.safe(
      { model: "gpt-4o-transcribe-diarize", file: audio(), chunking_strategy: "auto" },
      { media: [{ path: ["file"], durationSeconds: 45 }] },
    );
    expect(withStrategy.ok).toBe(true);

    const shortClip = transcription.safe(
      { model: "gpt-4o-transcribe-diarize", file: audio() },
      { media: [{ path: ["file"], durationSeconds: 10 }] },
    );
    expect(shortClip.ok).toBe(true);
  });
});

describe("openai.transcription upload limits and cost", () => {
  test("a file over 25MB is media_too_large", () => {
    expect(TRANSCRIPTION_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    const r = transcription.safe({
      model: "gpt-transcribe",
      file: audio(TRANSCRIPTION_MAX_FILE_BYTES + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "media_too_large");
      expect(issue?.path).toEqual(["file"]);
    }
  });

  test("a labeled audio Blob is never format-checked (mime vs extension list)", () => {
    const r = transcription.safe({
      model: "gpt-transcribe",
      file: new Blob([new Uint8Array(8)], { type: "audio/aiff" }),
    });
    expect(r.ok).toBe(true);
  });

  test("declared duration drives the per-minute cost estimate", () => {
    const r = transcription.safe(
      { model: "gpt-transcribe", file: audio() },
      { media: [{ path: ["file"], durationSeconds: 120 }] },
    );
    expect(r.ok).toBe(true);
    // $0.0045 / minute × 2 minutes.
    if (r.ok) expect(r.estimate?.costUSD).toBeCloseTo(0.009, 10);
  });

  test("no declared duration means no estimate", () => {
    const r = transcription.safe({ model: "whisper-1", file: audio() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate?.costUSD).toBeUndefined();
  });
});

describe("openai.transcription toFormData", () => {
  test("arrays ride as repeated name[] parts and objects as JSON", () => {
    const form = toFormData({
      model: "gpt-4o-transcribe-diarize",
      file: audio(),
      known_speaker_names: ["agent", "customer"],
      known_speaker_references: ["data:audio/wav;base64,AA", "data:audio/wav;base64,BB"],
      chunking_strategy: { type: "server_vad", threshold: 0.5 },
      temperature: 0,
    });

    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.getAll("known_speaker_names[]")).toEqual(["agent", "customer"]);
    expect(form.getAll("known_speaker_references[]").length).toBe(2);
    expect(form.get("chunking_strategy")).toBe('{"type":"server_vad","threshold":0.5}');
    expect(form.get("temperature")).toBe("0");
  });

  test("null values are dropped", () => {
    const form = toFormData({ model: "whisper-1", file: audio(), stream: null });
    expect(form.get("stream")).toBeNull();
    expect(form.get("model")).toBe("whisper-1");
  });
});
