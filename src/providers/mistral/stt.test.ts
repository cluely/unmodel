import { describe, expect, test } from "bun:test";
import {
  stt,
  toFormData,
  AUDIO_TRANSCRIPTIONS_URL,
  MAX_CONTEXT_BIAS_TERMS,
} from "./stt";
import { TRANSCRIPTION_MAX_AUDIO_SECONDS, transcriptionModels } from "./audio-models";
import { UnmodelValidationError } from "../../core/issues";

const audio = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });

describe("mistral.stt happy path", () => {
  test("returns wire-shaped params with hidden toSdk/request", () => {
    const file = audio();
    const params = { model: "voxtral-mini-latest", file, diarize: true };
    const v = stt(params);

    expect(Object.keys(v)).toEqual(["model", "file", "diarize"]);
    expect(v.file).toBe(file);

    expect(v.request.url).toBe(AUDIO_TRANSCRIPTIONS_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary, so no content-type is set.
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("mistral")).toEqual(v as unknown as typeof params);
  });

  test("file_url and file_id are accepted audio sources", () => {
    expect(
      stt.safe({ model: "voxtral-mini-2602", file_url: "https://example.com/a.mp3" }).ok,
    ).toBe(true);
    expect(stt.safe({ model: "voxtral-mini-2602", file_id: "file-abc" }).ok).toBe(true);
  });

  test("timestamps, diarization and context bias validate together", () => {
    const r = stt.safe({
      model: "voxtral-mini-latest",
      file: audio(),
      diarize: true,
      timestamp_granularities: ["segment", "word"],
      context_bias: ["Voxtral", "Mistral_AI"],
      temperature: 0.2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown models warn and name the mistral catalog", () => {
    const r = stt.safe({ model: "voxtral-mini-2699", file: audio() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the mistral catalog");
    }
  });
});

describe("mistral.stt audio source rules", () => {
  test("two sources are mutually exclusive", () => {
    const r = stt.safe({
      model: "voxtral-mini-latest",
      file: audio(),
      file_url: "https://example.com/a.mp3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("mutually exclusive");
  });

  test("no source at all is an error", () => {
    const r = stt.safe({ model: "voxtral-mini-latest" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("no audio source");
  });

  test("unknown top-level keys pass through with a warning", () => {
    const r = stt.safe({
      model: "voxtral-mini-latest",
      file_id: "file-abc",
      // @ts-expect-error ExactKeys rejects params outside the wire shape.
      response_format: "verbose_json",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("file_url must be an http(s) URL", () => {
    const r = stt.safe({ model: "voxtral-mini-latest", file_url: "s3://bucket/a.mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("http(s) URL");
  });
});

describe("mistral.stt documented pairings", () => {
  test("timestamp_granularities and language are incompatible", () => {
    const r = stt.safe({
      model: "voxtral-mini-latest",
      file: audio(),
      language: "en",
      timestamp_granularities: ["word"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["timestamp_granularities"]);
      expect(r.errors[0]?.message).toContain("not compatible with `language`");
    }
  });

  test("language alone and granularities alone both validate", () => {
    expect(stt.safe({ model: "voxtral-mini-latest", file: audio(), language: "fr" }).ok).toBe(
      true,
    );
    expect(
      stt.safe({
        model: "voxtral-mini-latest",
        file: audio(),
        timestamp_granularities: ["segment"],
      }).ok,
    ).toBe(true);
  });

  test("language must be a two-letter code", () => {
    const r = stt.safe({ model: "voxtral-mini-latest", file: audio(), language: "eng" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("two-letter code");
  });

  test("context_bias caps at 100 terms and rejects whitespace/commas", () => {
    const tooMany = stt.safe({
      model: "voxtral-mini-latest",
      file: audio(),
      context_bias: Array.from({ length: MAX_CONTEXT_BIAS_TERMS + 1 }, (_, i) => `term_${i}`),
    });
    expect(tooMany.ok).toBe(false);

    const spaced = stt.safe({
      model: "voxtral-mini-latest",
      file: audio(),
      context_bias: ["American people"],
    });
    expect(spaced.ok).toBe(false);
    if (!spaced.ok) expect(spaced.errors[0]?.message).toContain("whitespace");
  });

  test("stream: true is rejected — that is the SSE operation", () => {
    const r = stt.safe({
      model: "voxtral-mini-latest",
      file: audio(),
      // @ts-expect-error the non-streaming endpoint pins stream to false.
      stream: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("different operation");
  });
});

describe("mistral.stt model gating", () => {
  test("the realtime model is rejected as websocket-only", () => {
    const r = stt.safe({
      model: "voxtral-mini-transcribe-realtime-2602",
      file: audio(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.message).toContain("WebSocket");
    }
  });

  test("a chat-only catalog model is rejected", () => {
    const r = stt.safe({ model: "mistral-small-latest", file: audio() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("not a Mistral transcription model");
  });

  test("the dated transcribe ids resolve to catalog entries", () => {
    expect(transcriptionModels["voxtral-mini-2602"]?.cost?.perAudioMinute).toBe(0.003);
    expect(transcriptionModels["voxtral-small-2507"]?.cost?.perAudioMinute).toBe(0.004);
    // voxtral-mini-2507 is no longer priced by Mistral: no guessed rate.
    expect(transcriptionModels["voxtral-mini-2507"]?.cost).toBeUndefined();
  });
});

describe("mistral.stt media + cost", () => {
  test("declared duration prices at the per-minute rate", () => {
    const r = stt.safe(
      { model: "voxtral-mini-latest", file: audio() },
      { media: [{ path: ["file"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    // 10 minutes x $0.003/min.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.03, 10);
  });

  test("per-model audio caps are enforced", () => {
    const miniLimit = TRANSCRIPTION_MAX_AUDIO_SECONDS["voxtral-mini-2507"] ?? 0;
    const tooLong = stt.safe(
      { model: "voxtral-mini-2507", file_url: "https://example.com/a.mp3" },
      { media: [{ path: ["file_url"], durationSeconds: miniLimit + 1 }] },
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.errors[0]?.code).toBe("media_duration_exceeded");
      expect(tooLong.errors[0]?.message).toContain("15 minutes");
    }

    // The same audio fits Voxtral Mini Transcribe 2's ~3 hour window.
    const fits = stt.safe(
      { model: "voxtral-mini-2602", file_url: "https://example.com/a.mp3" },
      { media: [{ path: ["file_url"], durationSeconds: miniLimit + 1 }] },
    );
    expect(fits.ok).toBe(true);
  });

  test("maxCostUSD is enforced and no declaration means no estimate", () => {
    const over = stt.safe(
      { model: "voxtral-mini-latest", file: audio() },
      { media: [{ path: ["file"], durationSeconds: 3600 }], maxCostUSD: 0.01 },
    );
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.code).toBe("over_budget");

    const bare = stt.safe({ model: "voxtral-mini-latest", file: audio() });
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.estimate.costUSD).toBeUndefined();
  });

  test("throwing form raises UnmodelValidationError", () => {
    expect(() => stt({ model: "voxtral-mini-latest" })).toThrow(UnmodelValidationError);
  });
});

describe("mistral.toFormData", () => {
  test("repeats array fields under their plain name and drops nulls", () => {
    const file = audio();
    const form = toFormData({
      model: "voxtral-mini-latest",
      file,
      diarize: true,
      language: null,
      timestamp_granularities: ["segment", "word"],
      context_bias: ["Voxtral"],
    });

    expect(form.get("model")).toBe("voxtral-mini-latest");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("diarize")).toBe("true");
    expect(form.getAll("timestamp_granularities")).toEqual(["segment", "word"]);
    expect(form.getAll("context_bias")).toEqual(["Voxtral"]);
    // null means "provider default", which multipart expresses by omission.
    expect(form.has("language")).toBe(false);
  });
});
