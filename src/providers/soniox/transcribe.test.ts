import { describe, expect, test } from "bun:test";
import {
  transcribe,
  toUploadFormData,
  TRANSCRIPTIONS_URL,
  MAX_AUDIO_DURATION_SECONDS,
} from "./transcribe";
import { models, ASYNC_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";

describe("soniox.transcribe happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model: "stt-async-v5" as const,
      audio_url: "https://example.com/audio.mp3",
      language_hints: ["en", "fr"],
      enable_speaker_diarization: true,
    };
    const v = transcribe(params);

    expect(Object.keys(v)).toEqual([
      "model",
      "audio_url",
      "language_hints",
      "enable_speaker_diarization",
    ]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TRANSCRIPTIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No official JS SDK for this REST endpoint — toSdk is identity.
    expect(v.toSdk("soniox")).toEqual(params);
  });

  test("file_id source and structured context validate", () => {
    const r = transcribe.safe({
      model: "stt-async-v5",
      file_id: "0190dcd1-2c3a-7a8b-9c0d-112233445566",
      context: {
        general: [{ key: "Domain", value: "medicine" }],
        terms: ["ibuprofen"],
      },
      translation: { type: "one_way", target_language: "fr" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns, deprecated v4 alias warns", () => {
    const unknown = transcribe.safe({ model: "stt-async-v9", audio_url: "https://a.com/x" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    expect(models["stt-async-v4"].status).toBe("deprecated");
    const v4 = transcribe.safe({ model: "stt-async-v4", audio_url: "https://a.com/x" });
    expect(v4.ok).toBe(true);
    if (v4.ok) expect(v4.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });
});

describe("soniox.transcribe audio source rules", () => {
  test("audio_url and file_id together is an error", () => {
    const r = transcribe.safe({
      model: "stt-async-v5",
      audio_url: "https://a.com/x.mp3",
      file_id: "abc",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.message).toContain("mutually exclusive");
    }
  });

  test("neither audio_url nor file_id is an error", () => {
    const r = transcribe.safe({ model: "stt-async-v5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("no audio source");
  });

  test("a non-http audio_url is rejected", () => {
    const r = transcribe.safe({ model: "stt-async-v5", audio_url: "ftp://a.com/x.mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("two_way translation missing language_b is rejected", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => { ok: boolean };
    const r = bad({
      model: "stt-async-v5",
      audio_url: "https://a.com/x.mp3",
      translation: { type: "two_way", language_a: "ja" },
    });
    expect(r.ok).toBe(false);
  });
});

describe("soniox.transcribe duration + cost", () => {
  // `as const`: a hoisted path infers `string[]`, and the media coordinate is a
  // tuple whose first segment is a key of the params — see `MediaPathFor`.
  const hourOfAudio = {
    media: [{ path: ["audio_url"] as const, durationSeconds: 3600 }],
  };

  test("declared duration over 5 hours is media_duration_exceeded", () => {
    const r = transcribe.safe(
      { model: "stt-async-v5", audio_url: "https://a.com/x.mp3" },
      { media: [{ path: ["audio_url"], durationSeconds: MAX_AUDIO_DURATION_SECONDS + 1 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_duration_exceeded");
      expect(r.errors[0]?.meta?.limit).toBe(MAX_AUDIO_DURATION_SECONDS);
    }
  });

  test("cost: 1 hour of async audio ≈ $0.10 (pricing page rate)", () => {
    const r = transcribe.safe(
      { model: "stt-async-v5", audio_url: "https://a.com/x.mp3" },
      hourOfAudio,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.1, 10);
  });

  test("over_budget fires against the estimated cost", () => {
    const r = transcribe.safe(
      { model: "stt-async-v5", audio_url: "https://a.com/x.mp3" },
      { ...hourOfAudio, maxCostUSD: 0.05 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("no declaration → empty estimate, no errors", () => {
    const r = transcribe.safe({ model: "stt-async-v5", audio_url: "https://a.com/x.mp3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("the throwing form throws UnmodelValidationError", () => {
    let caught: unknown;
    try {
      transcribe({ model: "stt-async-v5" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("soniox toUploadFormData", () => {
  test("builds the multipart body with file and client_reference_id", () => {
    const blob = new Blob(["abc"], { type: "audio/mpeg" });
    const form = toUploadFormData({
      file: blob,
      filename: "call.mp3",
      client_reference_id: "job-1",
    });
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("call.mp3");
    expect(form.get("client_reference_id")).toBe("job-1");
  });

  test("omits client_reference_id when absent", () => {
    const form = toUploadFormData({ file: new Blob(["abc"]) });
    expect(form.get("client_reference_id")).toBeNull();
  });
});

describe("soniox.transcribe realtime gating (doc audit 2026-08-13)", () => {
  test("a realtime model on the async endpoint is unsupported_capability", () => {
    for (const model of ["stt-rt-v5", "stt-rt-v4"]) {
      const r = transcribe.safe({ model, audio_url: "https://example.com/a.mp3" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "unsupported_capability");
        expect(issue?.path).toEqual(["model"]);
        expect(issue?.message).toContain("WebSocket");
        expect(String(issue?.meta?.source)).toContain("soniox.com/docs/stt/models");
      }
    }
  });

  test("async ids still pass, and unknown ids stay a warning", () => {
    for (const model of ASYNC_MODEL_IDS) {
      const r = transcribe.safe({ model, audio_url: "https://example.com/a.mp3" });
      expect(r.ok).toBe(true);
    }
    const unknown = transcribe.safe({
      model: "stt-async-v9",
      audio_url: "https://example.com/a.mp3",
    });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});
