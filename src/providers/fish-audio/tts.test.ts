import { describe, expect, test } from "bun:test";
import {
  tts,
  utf8ByteLength,
  TTS_URL,
  DEFAULT_TTS_MODEL,
  MSGPACK_CONTENT_TYPE,
  TTS_FORMATS,
  TTS_LATENCIES,
  MP3_BITRATES,
  OPUS_BITRATES,
} from "./tts";
import { models, TTS_MODEL_IDS, S2_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("fish-audio.tts happy path", () => {
  test("returns a wire-pure body with the model header stripped onto .request", () => {
    const v = tts({
      model: "s2.1-pro",
      text: "Hello world",
      reference_id: "802e3bc2b27e49c2995d23ef70e6ac89",
      format: "mp3",
      mp3_bitrate: 192,
    });

    // `model` is a header param, not a body field.
    expect(Object.keys(v)).toEqual(["text", "reference_id", "format", "mp3_bitrate"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      text: "Hello world",
      reference_id: "802e3bc2b27e49c2995d23ef70e6ac89",
      format: "mp3",
      mp3_bitrate: 192,
    });

    expect(v.request.url).toBe(TTS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.request.headers.model).toBe("s2.1-pro");
  });

  test("omitting model leaves the header off so the server default applies", () => {
    const v = tts({ text: "hi" });
    expect(v.request.headers.model).toBeUndefined();
    expect(Object.keys(v)).toEqual(["text"]);
  });

  test("toSdk returns the wire body unchanged", () => {
    const v = tts({ model: "s1", text: "hi", latency: "low" });
    expect(v.toSdk("fish-audio")).toEqual({ text: "hi", latency: "low" });
  });

  test("explicit null means provider default and passes clean", () => {
    const r = tts.safe({
      model: "s2-pro",
      text: "hi",
      reference_id: null,
      prosody: null,
      sample_rate: null,
      features: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns but validates", () => {
    const r = tts.safe({ model: "s3-pro", text: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ text: "hi", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["brand_new_param"]);
    }
  });

  test("headers are not shared between validations", () => {
    const a = tts({ model: "s1", text: "hi" });
    const b = tts({ model: "s2-pro", text: "hi" });
    expect(a.request.headers.model).toBe("s1");
    expect(b.request.headers.model).toBe("s2-pro");
  });
});

describe("fish-audio.tts model gate", () => {
  test("retired speech-* ids are rejected with the accepted list", () => {
    const r = tts.safe({ model: "speech-1.5", text: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "unsupported_capability");
      expect(err?.path).toEqual(["model"]);
      expect(err?.meta?.allowed).toEqual([...TTS_MODEL_IDS]);
      expect(r.warnings.map((w) => w.code)).toContain("deprecated_model");
    }
  });

  // `toHaveProperty` reads dots as path separators, and these ids contain one.
  test("every accepted model id is in the catalog", () => {
    for (const id of TTS_MODEL_IDS) expect(Object.hasOwn(models, id)).toBe(true);
    expect(TTS_MODEL_IDS).toContain(DEFAULT_TTS_MODEL);
  });

  test("S2_MODEL_IDS is the s2 family and excludes s1", () => {
    expect([...S2_MODEL_IDS].sort()).toEqual(["s2-pro", "s2.1-pro", "s2.1-pro-free"]);
  });
});

describe("fish-audio.tts enums", () => {
  test("bad format is invalid_enum_value with the allowed list", () => {
    const r = safeUnchecked({ text: "hi", format: "flac" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(err?.path).toEqual(["format"]);
      expect(err?.meta?.allowed).toEqual([...TTS_FORMATS]);
    }
  });

  test("bad latency is invalid_enum_value", () => {
    const r = safeUnchecked({ text: "hi", latency: "fast" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([
        ...TTS_LATENCIES,
      ]);
    }
  });

  test("bad mp3_bitrate is invalid_enum_value", () => {
    const r = safeUnchecked({ text: "hi", format: "mp3", mp3_bitrate: 320 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(err?.path).toEqual(["mp3_bitrate"]);
      expect(err?.meta?.allowed).toEqual([...MP3_BITRATES]);
    }
  });

  test("bad opus_bitrate is invalid_enum_value", () => {
    const r = safeUnchecked({ text: "hi", format: "opus", opus_bitrate: 96000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([
        ...OPUS_BITRATES,
      ]);
    }
  });

  test("documented numeric bounds are enforced by the schema", () => {
    expect(safeUnchecked({ text: "hi", temperature: 1.5 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", top_p: -0.1 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", chunk_length: 99 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", chunk_length: 301 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", min_chunk_length: 101 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", early_stop_threshold: 2 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", prosody: { speed: 2.5 } }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", prosody: { speed: 0.4 } }).ok).toBe(false);
    expect(safeUnchecked({ text: "" }).ok).toBe(false);
  });

  test("prosody.speed at the documented bounds passes", () => {
    expect(tts.safe({ text: "hi", prosody: { speed: 0.5 } }).ok).toBe(true);
    expect(tts.safe({ text: "hi", prosody: { speed: 2 } }).ok).toBe(true);
  });
});

describe("fish-audio.tts codec pairing", () => {
  test("mp3_bitrate against a non-mp3 format warns as ignored", () => {
    const r = tts.safe({ text: "hi", format: "wav", mp3_bitrate: 128 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.path[0] === "mp3_bitrate");
      expect(warn?.code).toBe("unsupported_param");
      expect(warn?.meta?.ignored).toBe(true);
    }
  });

  test("opus_bitrate against the default mp3 format warns as ignored", () => {
    const r = tts.safe({ text: "hi", opus_bitrate: 32000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.path[0])).toContain("opus_bitrate");
  });

  test("matching codec + bitrate is clean", () => {
    const r = tts.safe({ text: "hi", format: "opus", opus_bitrate: 32000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("fish-audio.tts multi-speaker and loudness gates", () => {
  test("a reference_id array on s1 is rejected as S2-only", () => {
    const r = tts.safe({ model: "s1", text: "hi", reference_id: ["a", "b"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "unsupported_capability");
      expect(err?.path).toEqual(["reference_id"]);
      expect(err?.meta?.allowed).toEqual([...S2_MODEL_IDS]);
    }
  });

  test("a reference_id array on the S2 family passes", () => {
    for (const model of S2_MODEL_IDS) {
      expect(tts.safe({ model, text: "hi", reference_id: ["a", "b"] }).ok).toBe(true);
    }
  });

  test("a single reference_id string on s1 passes", () => {
    const r = tts.safe({ model: "s1", text: "hi", reference_id: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("prosody.normalize_loudness on s1 warns as a silent no-op", () => {
    const r = tts.safe({ model: "s1", text: "hi", prosody: { normalize_loudness: true } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.code === "unsupported_param");
      expect(warn?.path).toEqual(["prosody", "normalize_loudness"]);
      expect(warn?.meta?.ignored).toBe(true);
    }
  });

  test("prosody.normalize_loudness on the S2 family is clean", () => {
    const r = tts.safe({ model: "s2.1-pro", text: "hi", prosody: { normalize_loudness: true } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("an unknown model does not trigger the family gates", () => {
    const r = tts.safe({ model: "s9-pro", text: "hi", reference_id: ["a", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("fish-audio.tts msgpack-only references", () => {
  test("references warns that the body must be MessagePack-encoded", () => {
    const r = tts.safe({
      model: "s2.1-pro",
      text: "hi",
      references: [{ audio: new Uint8Array([1, 2, 3]), text: "sample" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.path[0] === "references");
      expect(warn?.code).toBe("unsupported_param");
      expect(warn?.meta?.contentType).toBe(MSGPACK_CONTENT_TYPE);
    }
  });

  test("nested references on s1 are rejected as multi-speaker", () => {
    const r = tts.safe({
      model: "s1",
      text: "hi",
      references: [[{ audio: new Uint8Array([1]), text: "a" }]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path[0] === "references")).toBe(true);
  });
});

describe("fish-audio.tts cost estimation", () => {
  test("prices ASCII text at the per-UTF-8-byte rate", () => {
    const text = "a".repeat(1000);
    const r = tts.safe({ model: "s2.1-pro", text });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((1000 * 15) / 1_000_000, 12);
  });

  test("non-ASCII text is priced by bytes, not characters", () => {
    const text = "汉".repeat(100); // 3 UTF-8 bytes each
    expect(utf8ByteLength(text)).toBe(300);
    const r = tts.safe({ model: "s2-pro", text });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((300 * 15) / 1_000_000, 12);
  });

  test("the free tier prices at zero", () => {
    const r = tts.safe({ model: "s2.1-pro-free", text: "hello" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBe(0);
  });

  test("maxCostUSD turns an over-budget request into an error", () => {
    expect(() => tts({ model: "s1", text: "a".repeat(1_000_000) }, { maxCostUSD: 1 })).toThrow(
      UnmodelValidationError,
    );
  });
});
