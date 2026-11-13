import { describe, expect, test } from "bun:test";
import {
  tts,
  TTS_BYTES_URL,
  CARTESIA_VERSION,
  CARTESIA_EMOTIONS,
  CARTESIA_TTS_LANGUAGES,
  CARTESIA_TTS_3_6_LANGUAGES,
  CARTESIA_TTS_LOCALES,
  CARTESIA_TTS_LANGUAGES_BY_MODEL,
} from "./tts";
import { UnmodelValidationError, type IssueCode } from "../../core/issues";
import { models, TTS_MODEL_IDS } from "./models";
import { CARTESIA_TTS_MODEL_PARAMS } from "./tts-params";
import { tts as cartesiaAdapter } from "./unified-tts";
import { createTts } from "../../unified/tts";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VOICE = { mode: "id", id: "694f9389-aac1-45b6-b726-9d9369183238" } as const;

describe("cartesia.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model_id: "sonic-3.5" as const,
      transcript: "Hello from Cartesia.",
      voice: VOICE,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 } as const,
      language: "en" as const,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual([
      "model_id",
      "transcript",
      "voice",
      "output_format",
      "language",
    ]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TTS_BYTES_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.request.headers["Cartesia-Version"]).toBe(CARTESIA_VERSION);
    // The official JS SDK takes wire-shaped params — toSdk is the identity.
    expect(v.toSdk("cartesia")).toEqual(params);
  });

  test("mp3 and raw containers with required fields pass", () => {
    const mp3 = tts.safe({
      model_id: "sonic-3",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    });
    expect(mp3.ok).toBe(true);
    if (mp3.ok) expect(mp3.warnings).toEqual([]);

    const raw = tts.safe({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: 8000 },
    });
    expect(raw.ok).toBe(true);
  });

  test("generation_config within documented ranges passes", () => {
    const r = tts.safe({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      generation_config: { volume: 1.5, speed: 0.8, emotion: "happy" },
    });
    expect(r.ok).toBe(true);
  });

  test("unknown model warns; unknown top-level key warns", () => {
    const r = safeUnchecked({
      model_id: "sonic-99",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      brand_new_param: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });

  test("deprecated sonic-3-latest warns; beta sonic-preview does not", () => {
    expect(models["sonic-3-latest"].status).toBe("deprecated");
    const deprecated = tts.safe({
      model_id: "sonic-3-latest",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(deprecated.ok).toBe(true);
    if (deprecated.ok) {
      // Also off the endpoint's published model_id enum — see the gate test below.
      expect(deprecated.warnings.map((w) => w.code)).toEqual([
        "deprecated_model",
        "invalid_enum_value",
      ]);
    }

    const beta = tts.safe({
      model_id: "sonic-preview",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(beta.ok).toBe(true);
    if (beta.ok) expect(beta.warnings).toEqual([]);
  });

  test("every id in the published model_id enum validates clean", () => {
    for (const id of TTS_MODEL_IDS) {
      const r = tts.safe({
        model_id: id,
        transcript: "x",
        voice: VOICE,
        output_format: { container: "wav" },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a cataloged sonic id outside the published enum warns (not an error)", () => {
    const r = tts.safe({
      model_id: "sonic-3.5-2026-05-04",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["model_id"]);
      expect(issue?.meta?.allowed).toEqual([...TTS_MODEL_IDS]);
      expect(String(issue?.message)).toContain("2026-03-01");
    }
  });

  test("an Ink STT id is still an error, not a warning", () => {
    const r = safeUnchecked({
      model_id: "ink-whisper",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model_id"]);
    }
  });
});

describe("cartesia.tts schema enforcement", () => {
  const base = { model_id: "sonic-3.5", transcript: "x", voice: VOICE };

  test("mp3 without sample_rate is invalid_shape", () => {
    const r = safeUnchecked({ ...base, output_format: { container: "mp3" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("raw without encoding is invalid_shape", () => {
    const r = safeUnchecked({ ...base, output_format: { container: "raw", sample_rate: 44100 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("undocumented sample_rate is invalid_shape", () => {
    const r = safeUnchecked({
      ...base,
      output_format: { container: "wav", sample_rate: 11025 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("undocumented mp3 bit_rate is invalid_shape", () => {
    const r = safeUnchecked({
      ...base,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 12345 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("voice without mode 'id' is invalid_shape", () => {
    const r = safeUnchecked({
      ...base,
      voice: { mode: "embedding", embedding: [0.1] },
      output_format: { container: "wav" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("generation_config out of range is invalid_shape", () => {
    const r = safeUnchecked({
      ...base,
      output_format: { container: "wav" },
      generation_config: { volume: 3 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["generation_config", "volume"]);
    }
  });

  test("deprecated top-level speed only accepts the documented enum", () => {
    const ok = tts.safe({ ...base, output_format: { container: "wav" }, speed: "fast" });
    expect(ok.ok).toBe(true);
    const bad = safeUnchecked({ ...base, output_format: { container: "wav" }, speed: "faster" });
    expect(bad.ok).toBe(false);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const ttsUnchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      ttsUnchecked({ ...base, output_format: { container: "flac" } });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("cartesia.tts constraints", () => {
  test("pronunciation_dict_id on sonic-3.5 passes", () => {
    const r = tts.safe({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      pronunciation_dict_id: "dict_123",
    });
    expect(r.ok).toBe(true);
  });

  test("every cataloged sonic id is Sonic 3 or later, so no per-model deny remains", () => {
    const sonicIds = Object.keys(models).filter((id) => id.startsWith("sonic"));
    expect(sonicIds.length).toBeGreaterThan(0);
    for (const id of sonicIds) {
      expect(tts.constraintsFor(id)).toEqual([]);
      const r = tts.safe({
        model_id: id,
        transcript: "x",
        voice: VOICE,
        output_format: { container: "wav" },
        pronunciation_dict_id: "dict_123",
      });
      expect(r.ok).toBe(true);
    }
  });
});

describe("cartesia.tts estimation", () => {
  test("no costUSD is estimated — Cartesia publishes no USD rate (credits only)", () => {
    const r = tts.safe({
      model_id: "sonic-3.5",
      transcript: "a".repeat(10_000),
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeUndefined();
      expect(r.estimate.inputTokens).toBeUndefined();
    }
  });

  test("maxCostUSD never trips without a rate", () => {
    const r = tts.safe(
      {
        model_id: "sonic-3.5",
        transcript: "a".repeat(10_000),
        voice: VOICE,
        output_format: { container: "wav" },
      },
      { maxCostUSD: 0.000001 },
    );
    expect(r.ok).toBe(true);
  });
});

describe("cartesia catalog", () => {
  test("TTS models carry no character cap (none documented) and context 0", () => {
    expect(models["sonic-3.5"].limit.context).toBe(0);
    expect((models["sonic-3.5"].limit as { characters?: number }).characters).toBeUndefined();
  });

  test("no Cartesia model carries USD pricing", () => {
    for (const info of Object.values(models)) {
      expect((info as { cost?: unknown }).cost).toBeUndefined();
    }
  });
});

describe("cartesia.tts doc audit 2026-08-13", () => {
  test("mp3 without bit_rate is invalid_shape (the schema requires it)", () => {
    const r = safeUnchecked({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "mp3", sample_rate: 44100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("wav still accepts every documented encoding with both fields optional", () => {
    for (const encoding of ["pcm_f32le", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const) {
      const r = tts.safe({
        model_id: "sonic-3.5",
        transcript: "x",
        voice: VOICE,
        output_format: { container: "wav", encoding },
      });
      expect(r.ok).toBe(true);
    }
    const bare = tts.safe({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(bare.ok).toBe(true);
  });

  test("an undocumented emotion is invalid_enum_value with the doc source", () => {
    const r = safeUnchecked({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      generation_config: { emotion: "hangry" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["generation_config", "emotion"]);
      expect(String(issue?.meta?.source)).toContain("docs.cartesia.ai");
    }
  });

  test("every documented emotion passes", () => {
    for (const emotion of CARTESIA_EMOTIONS) {
      const r = tts.safe({
        model_id: "sonic-3.5",
        transcript: "x",
        voice: VOICE,
        output_format: { container: "wav" },
        generation_config: { emotion },
      });
      expect(r.ok).toBe(true);
    }
  });

  test("an undocumented language is invalid_enum_value; documented ones pass", () => {
    const bad = safeUnchecked({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      language: "xx",
    });
    expect(bad.ok).toBe(false);
    expect(CARTESIA_TTS_LANGUAGES).toHaveLength(42);
    for (const language of CARTESIA_TTS_LANGUAGES) {
      const r = tts.safe({
        model_id: "sonic-3.5",
        transcript: "x",
        voice: VOICE,
        output_format: { container: "wav" },
        language,
      });
      expect(r.ok).toBe(true);
    }
  });

  test("an Ink (STT) model on /tts/bytes is unsupported_capability", () => {
    const r = safeUnchecked({
      model_id: "ink-whisper",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model_id"]);
    }
  });
});

describe("cartesia.tts Sonic 3.6 and the deprecated aliases (2026-11-12)", () => {
  const WAV = { container: "wav" } as const;

  test("each new id validates, off the 2026-03-01 enum, with no USD estimate", () => {
    const expected: Record<string, IssueCode[]> = {
      "sonic-3.6": ["invalid_enum_value"],
      "sonic-3.6-2026-08-27": ["invalid_enum_value"],
      "sonic-3-latest": ["deprecated_model", "invalid_enum_value"],
      "sonic-3-preview": ["deprecated_model", "invalid_enum_value"],
    };
    for (const [id, codes] of Object.entries(expected)) {
      expect(models[id as keyof typeof models]).toBeDefined();
      const r = tts.safe({ model_id: id, transcript: "a".repeat(1000), voice: VOICE, output_format: WAV });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => w.code)).toEqual(codes);
        expect(r.estimate.costUSD).toBeUndefined();
      }
    }
  });

  test("the off-enum warning cites the 2026-03-01 page, whose enum lacks sonic-3.6", () => {
    // The unversioned reference renders 2026-08-14, where sonic-3.6 IS on the
    // enum — citing it would contradict the warning it is attached to.
    const r = tts.safe({ model_id: "sonic-3.6", transcript: "x", voice: VOICE, output_format: WAV });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings[0]?.meta?.source).toBe("https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes");
    }
  });

  test("the list sizes are the documented ones: 44 base codes, 56 locales", () => {
    expect(CARTESIA_TTS_3_6_LANGUAGES).toHaveLength(44);
    expect(CARTESIA_TTS_3_6_LANGUAGES.slice(-2)).toEqual(["or", "ur"]);
    expect(CARTESIA_TTS_LOCALES).toHaveLength(56);
    expect(CARTESIA_TTS_LANGUAGES_BY_MODEL["sonic-3.6"]).toHaveLength(100);
  });

  test("a Sonic 3.6 id takes Odia, Urdu and every regional locale, in either slot", () => {
    for (const model_id of ["sonic-3.6", "sonic-3.6-2026-08-27"] as const) {
      for (const value of CARTESIA_TTS_LANGUAGES_BY_MODEL[model_id]) {
        const base = { model_id, transcript: "x", voice: VOICE, output_format: WAV };
        for (const r of [tts.safe({ ...base, language: value }), tts.safe({ ...base, locale: value })]) {
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.warnings.map((w) => w.path[0])).toEqual(["model_id"]);
        }
      }
    }
  });

  test("a Sonic 3.6 id still refuses what is off its list — locale codes are case-sensitive", () => {
    for (const value of ["en-gb", "cy", "cy-GB", "en-"]) {
      const r = safeUnchecked({ model_id: "sonic-3.6", transcript: "x", voice: VOICE, output_format: WAV, language: value });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "invalid_enum_value");
        expect(issue?.path).toEqual(["language"]);
        expect(issue?.meta?.allowed).toHaveLength(100);
      }
    }
  });

  test("an unlisted regional code on a Sonic 3.6 base only warns — 56 listed, 61 counted", () => {
    // "44 languages / 61 locales" (changelog/2026) against the 56 codes the
    // locale table spells out: the other five are unnamed, so a well-formed
    // code on a 3.6 base may be one of them.
    for (const model_id of ["sonic-3.6", "sonic-3.6-2026-08-27"] as const) {
      for (const value of ["ar-SA", "zh-TW", "de-AT", "es-419"] as const) {
        const base = { model_id, transcript: "x", voice: VOICE, output_format: WAV };
        const results = [
          ["language", tts.safe({ ...base, language: value })],
          ["locale", tts.safe({ ...base, locale: value })],
        ] as const;
        for (const [field, r] of results) {
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          const issue = r.warnings.find((w) => w.path[0] === field);
          expect(issue?.code).toBe("invalid_enum_value");
          expect(issue?.meta?.source).toBe("https://docs.cartesia.ai/changelog/2026");
        }
      }
    }
  });

  test("an earlier model refuses a Sonic 3.6 value and names the model that takes it", () => {
    const odia = safeUnchecked({ model_id: "sonic-3.5", transcript: "x", voice: VOICE, output_format: WAV, language: "or" });
    expect(odia.ok).toBe(false);
    if (!odia.ok) {
      expect(odia.errors[0]?.path).toEqual(["language"]);
      expect(String(odia.errors[0]?.message)).toContain('"sonic-3.6"');
    }
    const british = safeUnchecked({ model_id: "sonic-3", transcript: "x", voice: VOICE, output_format: WAV, locale: "en-GB" });
    expect(british.ok).toBe(false);
    if (!british.ok) {
      expect(british.errors[0]?.path).toEqual(["locale"]);
      expect(String(british.errors[0]?.message)).toContain("need Sonic 3.6 or later");
      expect(String(british.errors[0]?.message)).toContain('the bare code "en"');
    }
    // A bare code is fine in `locale` on every model.
    expect(tts.safe({ model_id: "sonic-3.5", transcript: "x", voice: VOICE, output_format: WAV, locale: "en" }).ok).toBe(true);
  });

  test("language and locale together are refused, even when they match", () => {
    const r = safeUnchecked({
      model_id: "sonic-3.6",
      transcript: "x",
      voice: VOICE,
      output_format: WAV,
      language: "en",
      locale: "en",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["locale"]);
      expect(String(r.errors[0]?.message)).toContain("never both");
    }
  });

  test("generation_config and pronunciation dictionaries stay open on Sonic 3.6", () => {
    const r = tts.safe({
      model_id: "sonic-3.6",
      transcript: "x",
      voice: VOICE,
      output_format: WAV,
      pronunciation_dict_id: "dict_123",
      generation_config: { volume: 1.2, speed: 0.9, emotion: "calm" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["invalid_enum_value"]);
  });
});

describe("cartesia.tts aliases and uncataloged ids never refuse a language (2026-11-12)", () => {
  const WAV = { container: "wav" } as const;
  const base = { transcript: "x", voice: VOICE, output_format: WAV };

  test("sonic-preview takes the Sonic 3.6 values quietly — its languages cell points at the 3.6 page", () => {
    for (const r of [
      tts.safe({ ...base, model_id: "sonic-preview", locale: "en-GB" }),
      tts.safe({ ...base, model_id: "sonic-preview", language: "ur" }),
      tts.safe({ ...base, model_id: "sonic-preview", language: "pt-BR" }),
    ]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a Sonic 3.6 value on sonic-latest, sonic-3-latest or an uncataloged id is a warning", () => {
    const cases = [
      ["sonic-latest", tts.safe({ ...base, model_id: "sonic-latest", language: "ur" })],
      ["sonic-3-latest", tts.safe({ ...base, model_id: "sonic-3-latest", locale: "en-GB" })],
      ["sonic-3.7", tts.safe({ ...base, model_id: "sonic-3.7", language: "ur" })],
      ["sonic-3.6-2026-12-01", tts.safe({ ...base, model_id: "sonic-3.6-2026-12-01", locale: "en-GB" })],
    ] as const;
    for (const [model, r] of cases) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const issue = r.warnings.find((w) => w.path[0] === "language" || w.path[0] === "locale");
      expect(issue?.code).toBe("invalid_enum_value");
      expect(issue?.severity).toBe("warning");
      expect(String(issue?.message)).toContain("needs Sonic 3.6 or later");
      expect(String(issue?.message)).toContain(`"${model}"`);
    }
  });

  test("a value on no documented list is still only a warning on those ids", () => {
    for (const model_id of ["sonic-preview", "sonic-latest", "sonic-3.7"]) {
      const r = safeUnchecked({ ...base, model_id, language: "xx" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.find((w) => w.path[0] === "language")?.severity).toBe("warning");
    }
  });

  test("an id whose list is documented still refuses at error severity", () => {
    for (const [model_id, value] of [
      ["sonic-3.5", "en-GB"],
      ["sonic-3.5-2026-05-04", "ur"],
      ["sonic-3", "or"],
      ["sonic-3-2026-01-12", "en-GB"],
      ["sonic-3.6", "en-gb"],
    ] as const) {
      const r = safeUnchecked({ ...base, model_id, locale: value });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.find((e) => e.path[0] === "locale")?.code).toBe("invalid_enum_value");
    }
  });
});

describe("cartesia.tts normalization (2026-03-01, read 2026-11-12)", () => {
  const WAV = { container: "wav" } as const;
  const base = { transcript: "x", voice: VOICE, output_format: WAV };
  const sonicIds = Object.keys(models).filter((id) => id.startsWith("sonic"));

  test("auto, off, null and a bare code pass on every cataloged sonic id", () => {
    for (const model_id of sonicIds) {
      for (const normalization of ["auto", "off", null, "en", "hi"] as const) {
        const r = tts.safe({ ...base, model_id, normalization });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.warnings.filter((w) => w.path[0] === "normalization")).toEqual([]);
      }
    }
  });

  test("a locale code passes on Sonic 3.6 and warns on an earlier model", () => {
    const sonic36 = tts.safe({ ...base, model_id: "sonic-3.6", locale: "en-GB", normalization: "en-US" });
    expect(sonic36.ok).toBe(true);
    if (sonic36.ok) expect(sonic36.warnings.map((w) => w.path[0])).toEqual(["model_id"]);

    const earlier = tts.safe({ ...base, model_id: "sonic-3.5", normalization: "en-IN" });
    expect(earlier.ok).toBe(true);
    if (earlier.ok) {
      const issue = earlier.warnings.find((w) => w.path[0] === "normalization");
      expect(issue?.code).toBe("invalid_enum_value");
      expect(String(issue?.message)).toContain("Locale codes require Sonic 3.6 or later.");
    }
  });

  test("anything off the list is refused — including a lower-case region", () => {
    for (const normalization of ["shouty", "en-in", "cy-GB"]) {
      const r = safeUnchecked({ ...base, model_id: "sonic-3.6", normalization });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.path[0] === "normalization");
        expect(issue?.code).toBe("invalid_enum_value");
        expect(issue?.meta?.allowed).toContain("off");
      }
    }
  });

  test("it is a typed wire field, not an unknown_param passthrough", () => {
    const v = tts({ ...base, model_id: "sonic-3.6", normalization: "off" });
    expect(JSON.parse(JSON.stringify(v)).normalization).toBe("off");
    const r = tts.safe({ ...base, model_id: "sonic-3.5", normalization: "off" });
    expect(r.ok && r.warnings).toEqual([]);
  });
});

describe("unified tts → cartesia: Sonic 3.6 says a regional tag exactly", () => {
  const unified = createTts([cartesiaAdapter]);
  const MP3 = { format: "mp3", sampleRate: 44100, bitrate: 128000 } as const;
  const call = (model: "cartesia/sonic-3.6" | "cartesia/sonic-3.5", language: string) =>
    unified.safe({ model, text: "hi", voice: "v1", language, outputFormat: MP3 });

  test("a listed tag on sonic-3.6 is sent as `locale`, case folded, with no approximation", () => {
    for (const language of ["pt-BR", "pt_br"]) {
      const r = call("cartesia/sonic-3.6", language);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const body = JSON.parse(JSON.stringify(r.params));
      expect(body.locale).toBe("pt-BR");
      expect(Object.hasOwn(body, "language")).toBe(false);
      expect(r.params.warnings.filter((w) => w.path[0] === "language")).toEqual([]);
    }
  });

  test("an unlisted tag on sonic-3.6, and any tag on sonic-3.5, keeps the primary-subtag path", () => {
    const cases = [
      ["cartesia/sonic-3.6", "ur-PK", "ur"],
      ["cartesia/sonic-3.5", "pt-BR", "pt"],
    ] as const;
    for (const [model, language, sent] of cases) {
      const r = call(model, language);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const body = JSON.parse(JSON.stringify(r.params));
      expect(body.language).toBe(sent);
      expect(Object.hasOwn(body, "locale")).toBe(false);
      expect(r.params.warnings.find((w) => w.path[0] === "language")?.code).toBe("approximated_param");
    }
  });

  test("the alias rows complete Sonic 3.6's 44 languages", () => {
    expect(CARTESIA_TTS_MODEL_PARAMS["sonic-preview"].languages).toBe(CARTESIA_TTS_3_6_LANGUAGES);
    expect(CARTESIA_TTS_MODEL_PARAMS["sonic-latest"].languages).toBe(CARTESIA_TTS_3_6_LANGUAGES);
    expect(CARTESIA_TTS_MODEL_PARAMS["sonic-3.5"].languages).toBe(CARTESIA_TTS_LANGUAGES);
  });
});
