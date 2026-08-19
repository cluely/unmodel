import { describe, expect, test } from "bun:test";
import {
  speech,
  TTS_BYTES_URL,
  CARTESIA_VERSION,
  CARTESIA_EMOTIONS,
  CARTESIA_TTS_LANGUAGES,
} from "./speech";
import { UnmodelValidationError } from "../../core/issues";
import { models, TTS_MODEL_IDS } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = speech.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VOICE = { mode: "id", id: "694f9389-aac1-45b6-b726-9d9369183238" } as const;

describe("cartesia.speech happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model_id: "sonic-3.5" as const,
      transcript: "Hello from Cartesia.",
      voice: VOICE,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 } as const,
      language: "en" as const,
    };
    const v = speech(params);

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
    const mp3 = speech.safe({
      model_id: "sonic-3",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    });
    expect(mp3.ok).toBe(true);
    if (mp3.ok) expect(mp3.warnings).toEqual([]);

    const raw = speech.safe({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: 8000 },
    });
    expect(raw.ok).toBe(true);
  });

  test("generation_config within documented ranges passes", () => {
    const r = speech.safe({
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

  test("deprecated sonic-2 warns; beta sonic-preview does not", () => {
    expect(models["sonic-2"].status).toBe("deprecated");
    const deprecated = speech.safe({
      model_id: "sonic-2",
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

    const beta = speech.safe({
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
      const r = speech.safe({
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
    const r = speech.safe({
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

describe("cartesia.speech schema enforcement", () => {
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
    const ok = speech.safe({ ...base, output_format: { container: "wav" }, speed: "fast" });
    expect(ok.ok).toBe(true);
    const bad = safeUnchecked({ ...base, output_format: { container: "wav" }, speed: "faster" });
    expect(bad.ok).toBe(false);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const speechUnchecked = speech as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      speechUnchecked({ ...base, output_format: { container: "flac" } });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("cartesia.speech constraints", () => {
  test("pronunciation_dict_id on sonic-2 is unsupported_param with reason + source", () => {
    const r = safeUnchecked({
      model_id: "sonic-2",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      pronunciation_dict_id: "dict_123",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["pronunciation_dict_id"]);
      expect(r.errors[0]?.message).toContain("sonic-3 models and newer");
      expect(String(r.errors[0]?.meta?.source)).toContain("docs.cartesia.ai");
    }
  });

  test("pronunciation_dict_id on sonic-3.5 passes", () => {
    const r = speech.safe({
      model_id: "sonic-3.5",
      transcript: "x",
      voice: VOICE,
      output_format: { container: "wav" },
      pronunciation_dict_id: "dict_123",
    });
    expect(r.ok).toBe(true);
  });

  test("constraintsFor exposes the deny rule", () => {
    const deny = speech.constraintsFor("sonic-turbo")[0]?.deny?.pronunciation_dict_id;
    expect(deny?.reason).toContain("sonic-3 models and newer");
  });
});

describe("cartesia.speech estimation", () => {
  test("no costUSD is estimated — Cartesia publishes no USD rate (credits only)", () => {
    const r = speech.safe({
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
    const r = speech.safe(
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

describe("cartesia.speech doc audit 2026-08-13", () => {
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
      const r = speech.safe({
        model_id: "sonic-3.5",
        transcript: "x",
        voice: VOICE,
        output_format: { container: "wav", encoding },
      });
      expect(r.ok).toBe(true);
    }
    const bare = speech.safe({
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
      const r = speech.safe({
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
      const r = speech.safe({
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
