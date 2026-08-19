import { describe, expect, test } from "bun:test";
import { stt, toFormData, STT_TRANSCRIBE_URL, CARTESIA_STT_LANGUAGES } from "./stt";
import { CARTESIA_VERSION } from "./tts";
import { checkStt } from "./check";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = stt.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const AUDIO = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/wav" });

describe("cartesia.stt happy path", () => {
  test("returns validated form fields with hidden toSdk/request", () => {
    const params = {
      file: AUDIO,
      model: "ink-whisper" as const,
      language: "en",
      timestamp_granularities: ["word" as const],
    };
    const v = stt(params);

    expect(Object.keys(v)).toEqual(["file", "model", "language", "timestamp_granularities"]);
    expect(v.file).toBe(AUDIO);

    expect(v.request.url).toBe(STT_TRANSCRIBE_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must set the boundary itself — no content-type here.
    expect(v.request.headers["content-type"]).toBeUndefined();
    expect(v.request.headers["Cartesia-Version"]).toBe(CARTESIA_VERSION);
    expect(v.toSdk("cartesia")).toEqual(params);
  });

  test("raw PCM fields validate", () => {
    const r = stt.safe({
      file: AUDIO,
      model: "ink-whisper",
      encoding: "pcm_s16le",
      sample_rate: 16000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a string file (caller-resolved) is accepted", () => {
    const r = stt.safe({ file: "resolved-elsewhere", model: "ink-whisper" });
    expect(r.ok).toBe(true);
  });
});

describe("cartesia.stt batch model enforcement", () => {
  test("ink-2 is rejected — realtime WebSocket only", () => {
    const r = stt.safe({ file: AUDIO, model: "ink-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["model"]);
      expect(r.errors[0]?.message).toContain("ink-whisper");
      expect(r.errors[0]?.message).toContain("WebSocket");
    }
  });

  test("an unknown non-ink model is rejected and warned as unknown", () => {
    const r = safeUnchecked({ file: AUDIO, model: "sonic-3.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("an ink id the catalog does not know warns but validates", () => {
    const r = safeUnchecked({ file: AUDIO, model: "ink-whisper-9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("invalid encoding is invalid_shape", () => {
    const r = safeUnchecked({ file: AUDIO, model: "ink-whisper", encoding: "mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("timestamp_granularities only accepts \"word\"", () => {
    const r = safeUnchecked({
      file: AUDIO,
      model: "ink-whisper",
      timestamp_granularities: ["sentence"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("cartesia.stt toFormData", () => {
  test("maps fields to the multipart wire names", () => {
    const form = toFormData({
      file: AUDIO,
      model: "ink-whisper",
      language: "en",
      timestamp_granularities: ["word"],
      encoding: "pcm_s16le",
      sample_rate: 16000,
    });

    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("model")).toBe("ink-whisper");
    expect(form.get("language")).toBe("en");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word"]);
    // encoding/sample_rate are QUERY params, never form fields.
    expect(form.get("encoding")).toBeNull();
    expect(form.get("sample_rate")).toBeNull();
    // The bracket-less params key never leaks onto the wire.
    expect(form.get("timestamp_granularities")).toBeNull();
  });

  test("encoding/sample_rate ride on the request URL as query params", () => {
    const v = stt({
      file: AUDIO,
      model: "ink-whisper",
      encoding: "pcm_s16le",
      sample_rate: 16000,
    });
    expect(v.request.url).toBe("https://api.cartesia.ai/stt?encoding=pcm_s16le&sample_rate=16000");
    // And they are stripped from the enumerable (form-field) surface.
    expect(Object.keys(v)).not.toContain("encoding");
    expect(Object.keys(v)).not.toContain("sample_rate");

    const plain = stt({ file: AUDIO, model: "ink-whisper" });
    expect(plain.request.url).toBe("https://api.cartesia.ai/stt");
  });

  test("omits absent optional fields", () => {
    const form = toFormData({ file: AUDIO, model: "ink-whisper" });
    expect(form.get("language")).toBeNull();
    expect(form.get("encoding")).toBeNull();
    expect(form.getAll("timestamp_granularities[]")).toEqual([]);
  });
});

describe("cartesia.stt estimation", () => {
  test("declared duration yields no costUSD — Cartesia publishes no USD rate", () => {
    const r = stt.safe(
      { file: AUDIO, model: "ink-whisper" },
      { media: [{ path: ["file"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("cartesia.checkStt", () => {
  test("empty transcript warns", () => {
    const report = checkStt({ type: "transcript", text: "  ", duration: 12.5 });
    expect(report.warnings.map((w) => w.meta?.kind)).toEqual(["empty_transcript"]);
    expect(report.costUSD).toBeUndefined();
  });

  test("non-empty transcript produces no warnings and no cost without a rate", () => {
    const report = checkStt(
      { type: "transcript", text: "hello world", duration: 60, language: "en" },
      "ink-whisper",
    );
    expect(report.warnings).toEqual([]);
    // No USD rate in the catalog (credits-only pricing) — cost stays undefined.
    expect(report.costUSD).toBeUndefined();
  });

  test("never throws on malformed responses", () => {
    expect(() => checkStt({} as never)).not.toThrow();
    expect(checkStt({}).warnings.length).toBe(1);
  });
});

describe("cartesia.stt language allow-list (doc audit 2026-08-13)", () => {
  test("the documented set has 100 codes and every one passes", () => {
    expect(new Set(CARTESIA_STT_LANGUAGES).size).toBe(CARTESIA_STT_LANGUAGES.length);
    for (const language of CARTESIA_STT_LANGUAGES) {
      const r = stt.safe({ file: AUDIO, model: "ink-whisper", language });
      expect(r.ok).toBe(true);
    }
  });

  test("an undocumented code is invalid_enum_value with the doc source", () => {
    const r = stt.safe({ file: AUDIO, model: "ink-whisper", language: "klingon" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["language"]);
      expect(String(issue?.meta?.source)).toContain("stt/transcribe");
    }
  });
});
