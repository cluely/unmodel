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
import { models, TTS_MODEL_IDS, S2_MODEL_IDS, MULTI_SPEAKER_MODEL_IDS } from "./models";
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

  // "S1 is deprecated and will be retired on December 31, 2026" — still served.
  test("s1 validates with a deprecated_model warning", () => {
    expect(models.s1.status).toBe("deprecated");
    const r = tts.safe({ model: "s1", text: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("s2-pro and drama-3 are open-weights; s1 and the S2.1 rows are not", () => {
    expect(models["s2-pro"].openWeights).toBe(true);
    expect(models["drama-3"].openWeights).toBe(true);
    expect(models.s1.openWeights).toBe(false);
    expect(models["s2.1-pro"].openWeights).toBe(false);
  });

  test("S2_MODEL_IDS is the s2 family and excludes s1", () => {
    expect([...S2_MODEL_IDS].sort()).toEqual(["s2-pro", "s2.1-pro", "s2.1-pro-free"]);
  });

  test("MULTI_SPEAKER_MODEL_IDS is the S2 family plus drama-3, never s1", () => {
    expect([...MULTI_SPEAKER_MODEL_IDS].sort()).toEqual([
      "drama-3",
      "s2-pro",
      "s2.1-pro",
      "s2.1-pro-free",
    ]);
  });

  test("drama-3 validates clean and rides the model header", () => {
    const r = tts.safe({ model: "drama-3", text: "[calm] The ship had been silent." });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.params.request.headers.model).toBe("drama-3");
    }
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

describe("fish-audio.tts language", () => {
  test("a BCP-47 tag, `auto` and the empty string pass", () => {
    for (const language of ["es-MX", "zh_CN", "auto", ""]) {
      const r = tts.safe({ text: "It costs $5.", language });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a tag over 35 characters or with other characters is rejected", () => {
    expect(safeUnchecked({ text: "hi", language: "a".repeat(36) }).ok).toBe(false);
    const r = safeUnchecked({ text: "hi", language: "en US" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["language"]);
  });
});

describe("fish-audio.tts pronunciation_dictionary", () => {
  const ref = { id: "brand-names", version: "v3" };
  const phoneme = { items: [{ key: "Nguyen", value: "w i n" }] };
  const alias = { items: [{ key: "NASA", value: "N A S A", type: "alias" as const }] };
  function textWith(pronunciation_dictionary: unknown): Record<string, unknown> {
    return { text: "hi", pronunciation_dictionary };
  }

  test("references and inline dictionaries each validate clean", () => {
    for (const pronunciation_dictionary of [[ref], [phoneme, alias]]) {
      const r = tts.safe({ text: "hi", pronunciation_dictionary });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("mixing the two forms is rejected naming the rule", () => {
    const r = safeUnchecked(textWith([ref, phoneme]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.path[0] === "pronunciation_dictionary");
      expect(err?.code).toBe("invalid_shape");
      expect(err?.message).toContain("mutually exclusive");
    }
  });

  test("schema bounds: at most 3 dictionaries, ref pattern, item lengths, closed objects", () => {
    expect(safeUnchecked(textWith([ref, ref, ref, ref])).ok).toBe(false);
    expect(safeUnchecked(textWith([{ id: "a b", version: "1" }])).ok).toBe(false);
    expect(safeUnchecked(textWith([{ id: "a" }])).ok).toBe(false);
    expect(safeUnchecked(textWith([{ items: [{ key: "", value: "x" }] }])).ok).toBe(false);
    expect(safeUnchecked(textWith([{ items: [{ key: "k", value: "v", type: "regex" }] }])).ok).toBe(
      false,
    );
    expect(safeUnchecked(textWith([{ items: [{ key: "k", value: "v", lang: "en" }] }])).ok).toBe(
      false,
    );
  });

  test("a phoneme-only inline dictionary keeps the byte-count estimate", () => {
    const text = "a".repeat(1000);
    const r = tts.safe({ model: "s2.1-pro", text, pronunciation_dictionary: [phoneme] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((1000 * 15) / 1_000_000, 12);
  });

  test("an alias entry or a reference leaves the request without an estimate", () => {
    for (const pronunciation_dictionary of [[alias], [ref]]) {
      const r = tts.safe({ model: "s2.1-pro", text: "a".repeat(1000), pronunciation_dictionary });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
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
  test("a reference_id array on s1 is rejected, naming the multi-speaker models", () => {
    const r = tts.safe({ model: "s1", text: "hi", reference_id: ["a", "b"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "unsupported_capability");
      expect(err?.path).toEqual(["reference_id"]);
      expect(err?.meta?.allowed).toEqual([...MULTI_SPEAKER_MODEL_IDS]);
      expect(err?.message).toContain("drama-3");
    }
  });

  test("a reference_id array on the S2 family and drama-3 passes", () => {
    for (const model of MULTI_SPEAKER_MODEL_IDS) {
      expect(tts.safe({ model, text: "hi", reference_id: ["a", "b"] }).ok).toBe(true);
    }
  });

  // The drama-3 feature page's own curl: header `model: drama-3`, three voices.
  test("drama-3 accepts a multi-speaker scene", () => {
    const r = tts.safe({
      model: "drama-3",
      text: "<|speaker:0|>[calm] The ship had been silent.<|speaker:1|>[low] Status report.",
      reference_id: [
        "c70cfb98867a4bfb9ae20d2401257b92",
        "bf322df2096a46f18c579d0baa36f41d",
        "f3a2b90078d54a65af4b95f63bc7798e",
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a single reference_id string on s1 passes (warning only that s1 is deprecated)", () => {
    const r = tts.safe({ model: "s1", text: "hi", reference_id: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
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

  // The docs name `s1` as the only no-op; nothing is documented for drama-3.
  test("prosody.normalize_loudness on drama-3 is clean", () => {
    const r = tts.safe({ model: "drama-3", text: "hi", prosody: { normalize_loudness: false } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  // "`repetition_penalty` applies to S1 but has no effect on S2.1-Pro"
  // (developer-guide/models-pricing/migrate-from-s1, 2026-11-12).
  test("repetition_penalty on s2.1-pro, or with no model, warns as a silent no-op", () => {
    for (const model of ["s2.1-pro", undefined] as const) {
      const r = tts.safe(
        model === undefined
          ? { text: "hi", repetition_penalty: 1.5 }
          : { model, text: "hi", repetition_penalty: 1.5 },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]?.code).toBe("unsupported_param");
        expect(r.warnings[0]?.path).toEqual(["repetition_penalty"]);
        expect(r.warnings[0]?.meta?.ignored).toBe(true);
      }
    }
  });

  // The page names S2.1-Pro only; nothing is documented for the others.
  test("repetition_penalty on s1, s2-pro, s2.1-pro-free and drama-3 draws no no-op warning", () => {
    for (const model of ["s1", "s2-pro", "s2.1-pro-free", "drama-3"] as const) {
      const r = tts.safe({ model, text: "hi", repetition_penalty: 1.5 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.some((w) => w.path[0] === "repetition_penalty"), model).toBe(false);
      }
    }
  });

  test("an explicit null repetition_penalty on s2.1-pro is clean", () => {
    const r = tts.safe({ model: "s2.1-pro", text: "hi", repetition_penalty: null });
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

  test("nested references on drama-3 are accepted as multi-speaker", () => {
    const r = tts.safe({
      model: "drama-3",
      text: "hi",
      references: [
        [{ audio: new Uint8Array([1]), text: "a" }],
        [{ audio: new Uint8Array([2]), text: "b" }],
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.path[0])).toEqual(["references"]);
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

  test("drama-3 prices at its $50 / M UTF-8 bytes list rate", () => {
    const text = "a".repeat(1000);
    const r = tts.safe({ model: "drama-3", text });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((1000 * 50) / 1_000_000, 12);
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
