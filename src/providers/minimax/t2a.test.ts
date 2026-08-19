import { describe, expect, test } from "bun:test";
import { t2a, T2A_URL, T2A_EMOTIONS, T2A_AUDIO_FORMATS } from "./t2a";
import {
  speechModels,
  SPEECH_MODEL_IDS,
  T2A_MAX_CHARACTERS,
  T2A_HD_PER_MILLION_CHARACTERS,
  T2A_TURBO_PER_MILLION_CHARACTERS,
} from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";

const safeUnchecked = t2a.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const voice = { voice_id: "English_Graceful_Lady" };

describe("minimax.t2a wire shape", () => {
  test("the whole params object is the JSON body", () => {
    const v = t2a({
      model: "speech-2.8-hd",
      text: "Hello world",
      voice_setting: { voice_id: "English_Graceful_Lady", speed: 1.2 },
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 },
    });
    expect(Object.keys(v)).toEqual(["model", "text", "voice_setting", "audio_setting"]);
    expect(v.request.url).toBe(T2A_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No official JS SDK — toSdk("minimax") returns the body unchanged.
    expect(v.toSdk("minimax")).toEqual(JSON.parse(JSON.stringify(v)));
  });

  test("unknown params warn but pass through", () => {
    const r = safeUnchecked({ model: "speech-2.8-hd", text: "hi", voice_setting: voice, foo: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("minimax.t2a model gate", () => {
  test("every documented model passes", () => {
    for (const model of SPEECH_MODEL_IDS) {
      expect(t2a.safe({ model, text: "hi", voice_setting: voice }).ok).toBe(true);
    }
  });

  test("an undocumented model is invalid_enum_value (and unknown_model)", () => {
    const r = t2a.safe({ model: "speech-03-hd", text: "hi", voice_setting: voice });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
    }
  });
});

describe("minimax.t2a voice selection", () => {
  test("a voice_id or timbre_weights is required", () => {
    const missing = t2a.safe({ model: "speech-2.8-hd", text: "hi" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["voice_setting", "voice_id"]);

    const mixed = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      timbre_weights: [
        { voice_id: "female-chengshu", weight: 30 },
        { voice_id: "female-tianmei", weight: 70 },
      ],
    });
    expect(mixed.ok).toBe(true);
  });

  test("at most 4 mixed voices, weights 1–100", () => {
    const tooMany = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      timbre_weights: Array.from({ length: 5 }, (_, i) => ({ voice_id: `v${i}`, weight: 20 })),
    });
    expect(tooMany.ok).toBe(false);

    const badWeight = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      timbre_weights: [{ voice_id: "v", weight: 101 }],
    });
    expect(badWeight.ok).toBe(false);
  });

  test("voice_setting numeric ranges are enforced", () => {
    const cases = [
      { speed: 2.5 },
      { speed: 0.4 },
      { vol: 0 },
      { vol: 11 },
      { pitch: 13 },
      { pitch: -13 },
    ];
    for (const setting of cases) {
      const r = safeUnchecked({
        model: "speech-2.8-hd",
        text: "hi",
        voice_setting: { ...voice, ...setting },
      });
      expect(r.ok).toBe(false);
    }
    expect(
      t2a.safe({
        model: "speech-2.8-hd",
        text: "hi",
        voice_setting: { ...voice, speed: 2, vol: 10, pitch: -12 },
      }).ok,
    ).toBe(true);
  });
});

describe("minimax.t2a emotion availability", () => {
  test("the documented emotions pass on speech-2.6-hd", () => {
    for (const emotion of T2A_EMOTIONS) {
      const r = t2a.safe({
        model: "speech-2.6-hd",
        text: "hi",
        voice_setting: { ...voice, emotion },
      });
      expect(r.ok).toBe(true);
    }
  });

  test("whisper is rejected on speech-2.8 and speech-02", () => {
    for (const model of ["speech-2.8-hd", "speech-02-hd"]) {
      const r = t2a.safe({
        model,
        text: "hi",
        voice_setting: { ...voice, emotion: "whisper" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
    }
  });

  test("fluent is allowed on speech-2.8 but not on speech-02", () => {
    expect(
      t2a.safe({ model: "speech-2.8-turbo", text: "hi", voice_setting: { ...voice, emotion: "fluent" } })
        .ok,
    ).toBe(true);
    const r = t2a.safe({
      model: "speech-02-turbo",
      text: "hi",
      voice_setting: { ...voice, emotion: "fluent" },
    });
    expect(r.ok).toBe(false);
  });

  test("an undocumented emotion is invalid_enum_value", () => {
    const r = safeUnchecked({
      model: "speech-2.6-hd",
      text: "hi",
      voice_setting: { ...voice, emotion: "bored" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice_setting", "emotion"]);
  });
});

describe("minimax.t2a audio_setting", () => {
  test("every documented format passes", () => {
    for (const format of T2A_AUDIO_FORMATS) {
      const r = t2a.safe({
        model: "speech-2.8-hd",
        text: "hi",
        voice_setting: voice,
        audio_setting: { format },
      });
      expect(r.ok).toBe(true);
    }
  });

  test("undocumented sample_rate / channel / format are invalid_enum_value", () => {
    const bad = [
      { sample_rate: 48000 },
      { channel: 3 },
      { format: "aac" },
      { bitrate: 96000 },
    ];
    for (const audio_setting of bad) {
      const r = safeUnchecked({
        model: "speech-2.8-hd",
        text: "hi",
        voice_setting: voice,
        audio_setting,
      });
      expect(r.ok).toBe(false);
    }
  });

  test("bitrate warns for non-mp3 output", () => {
    const r = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      voice_setting: voice,
      audio_setting: { format: "wav", bitrate: 128000 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.meta?.ignored).toBe(true);
    }
  });
});

describe("minimax.t2a language_boost and streaming pairings", () => {
  test("Persian/Filipino/Tamil are rejected on the 01 and 02 series", () => {
    const r = t2a.safe({
      model: "speech-02-hd",
      text: "hi",
      voice_setting: voice,
      language_boost: "Tamil",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
    expect(
      t2a.safe({
        model: "speech-2.8-hd",
        text: "hi",
        voice_setting: voice,
        language_boost: "Tamil",
      }).ok,
    ).toBe(true);
  });

  test("an undocumented language_boost is invalid_enum_value", () => {
    const r = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      voice_setting: voice,
      language_boost: "Klingon",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["language_boost"]);
  });

  test("word_streaming subtitles need stream:true; url output is non-streaming only", () => {
    const noStream = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      voice_setting: voice,
      subtitle_type: "word_streaming",
    });
    expect(noStream.ok).toBe(false);
    if (!noStream.ok) expect(noStream.errors[0]?.path).toEqual(["subtitle_type"]);

    const streamUrl = t2a.safe({
      model: "speech-2.8-hd",
      text: "hi",
      voice_setting: voice,
      stream: true,
      output_format: "url",
    });
    expect(streamUrl.ok).toBe(false);
    if (!streamUrl.ok) expect(streamUrl.errors[0]?.path).toEqual(["output_format"]);
  });
});

describe("minimax.t2a limits and cost", () => {
  test("text above 10,000 characters is over_output_limit", () => {
    const r = t2a.safe({
      model: "speech-2.8-hd",
      text: "x".repeat(T2A_MAX_CHARACTERS + 1),
      voice_setting: voice,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.meta).toMatchObject({ limitCharacters: T2A_MAX_CHARACTERS });
    }
  });

  test("hd bills $100/M characters and turbo $60/M", () => {
    expect(speechModels["speech-2.8-hd"].cost?.perMillionCharacters).toBe(
      T2A_HD_PER_MILLION_CHARACTERS,
    );
    expect(speechModels["speech-2.8-turbo"].cost?.perMillionCharacters).toBe(
      T2A_TURBO_PER_MILLION_CHARACTERS,
    );
    const text = "x".repeat(1000);
    const hd = t2a.safe({ model: "speech-2.8-hd", text, voice_setting: voice });
    expect(hd.ok).toBe(true);
    if (hd.ok) expect(hd.estimate.costUSD).toBeCloseTo(0.1, 10);
    const turbo = t2a.safe({ model: "speech-2.6-turbo", text, voice_setting: voice });
    expect(turbo.ok).toBe(true);
    if (turbo.ok) expect(turbo.estimate.costUSD).toBeCloseTo(0.06, 10);
  });

  test("the unpriced speech-01 tier yields no estimate", () => {
    const speech01: ModelInfo = speechModels["speech-01-hd"];
    expect(speech01.cost).toBeUndefined();
    const r = t2a.safe({ model: "speech-01-hd", text: "hi", voice_setting: voice });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD turns a long script into over_budget", () => {
    const r = t2a.safe(
      { model: "speech-2.8-hd", text: "x".repeat(9000), voice_setting: voice },
      { maxCostUSD: 0.5 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = t2a as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "speech-2.8-hd", text: "hi" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
