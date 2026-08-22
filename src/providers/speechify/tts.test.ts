import { describe, expect, test } from "bun:test";
import {
  tts,
  ttsStream,
  AUDIO_SPEECH_URL,
  AUDIO_STREAM_URL,
  SPEECH_MAX_CHARACTERS,
  STREAM_MAX_CHARACTERS,
  SPEECH_OUTPUT_FORMATS,
  STREAM_OUTPUT_FORMATS,
} from "./tts";
import { models, SPEECHIFY_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const ttsUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const streamUnchecked = ttsStream.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("speechify.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      input: "Hello from Speechify.",
      voice_id: "geffen_32",
      model: "simba-3.2" as const,
      audio_format: "mp3" as const,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["input", "voice_id", "model", "audio_format"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(AUDIO_SPEECH_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // @speechify/api's GetSpeechRequest is snake_case — toSdk is the identity.
    expect(v.toSdk("speechify")).toEqual(params);
  });

  test("every documented optional field passes", () => {
    const r = tts.safe({
      input: "x",
      voice_id: "george",
      model: "simba-3.0",
      language: "es-MX",
      audio_format: "wav",
      output_format: "wav_48000",
      options: { loudness_normalization: true, text_normalization: false },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns; the legacy Simba 1.6 ids warn as deprecated", () => {
    const unknown = tts.safe({ input: "x", voice_id: "v", model: "simba-9" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    for (const id of ["simba-english", "simba-multilingual"] as const) {
      expect(models[id].status).toBe("deprecated");
      const r = tts.safe({ input: "x", voice_id: "v", model: id });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
  });

  test("omitting model resolves to the documented simba-3.0 default", () => {
    const r = tts.safe({ input: "x", voice_id: "v" });
    expect(r.ok).toBe(true);
    // simba-3.0 is catalogued, so no unknown_model warning fires.
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown top-level key warns", () => {
    const r = ttsUnchecked({ input: "x", voice_id: "v", speed: 1.2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("speechify character caps (2,000 speech / 20,000 stream)", () => {
  test("speech over 2,000 characters is over_output_limit with character meta", () => {
    const input = "a".repeat(SPEECH_MAX_CHARACTERS + 1);
    const r = tts.safe({ input, voice_id: "v", model: "simba-3.2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["input"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(2000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(2001);
    }
  });

  test("speech at exactly 2,000 passes; the same text passes on stream", () => {
    const input = "a".repeat(SPEECH_MAX_CHARACTERS);
    expect(tts.safe({ input, voice_id: "v" }).ok).toBe(true);
    expect(ttsStream.safe({ input, voice_id: "v" }).ok).toBe(true);
  });

  test("stream over 20,000 characters is over_output_limit", () => {
    const input = "a".repeat(STREAM_MAX_CHARACTERS + 1);
    const r = ttsStream.safe({ input, voice_id: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(20000);
    }
  });

  test("the endpoint cap applies even for models unknown to the catalog", () => {
    const r = tts.safe({
      input: "a".repeat(SPEECH_MAX_CHARACTERS + 5),
      voice_id: "v",
      model: "simba-9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ input: "a".repeat(2001), voice_id: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("speechify format rules (the two routes differ)", () => {
  test("wav_* output formats are speech-only", () => {
    expect(SPEECH_OUTPUT_FORMATS).toContain("wav_24000");
    expect(STREAM_OUTPUT_FORMATS).not.toContain("wav_24000" as never);

    const ok = tts.safe({ input: "x", voice_id: "v", output_format: "wav_24000" });
    expect(ok.ok).toBe(true);

    const bad = streamUnchecked({ input: "x", voice_id: "v", output_format: "wav_24000" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]?.code).toBe("invalid_enum_value");
      expect(bad.errors[0]?.path).toEqual(["output_format"]);
      expect(bad.errors[0]?.message).toContain("only available on POST /v1/audio/speech");
    }
  });

  test("an unknown output_format is invalid_enum_value on both routes", () => {
    for (const run of [ttsUnchecked, streamUnchecked]) {
      const r = run({ input: "x", voice_id: "v", output_format: "flac_44100" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    }
  });

  test("audio_format on the stream route is unsupported_param", () => {
    const r = streamUnchecked({ input: "x", voice_id: "v", audio_format: "mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["audio_format"]);
      expect(issue?.message).toContain("only a field of POST /v1/audio/speech");
    }
  });

  test("an invalid audio_format on the speech route is invalid_shape", () => {
    const r = ttsUnchecked({ input: "x", voice_id: "v", audio_format: "flac" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("empty input is invalid_shape", () => {
    const r = ttsUnchecked({ input: "", voice_id: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("speechify.ttsStream Accept header", () => {
  test("accept is stripped from the body onto request.headers and back for the SDK", () => {
    const v = ttsStream({
      input: "Hello",
      voice_id: "geffen_32",
      accept: "audio/mpeg",
    });

    expect(Object.keys(v)).toEqual(["input", "voice_id"]);
    expect((v as Record<string, unknown>).accept).toBeUndefined();
    expect(v.request.url).toBe(AUDIO_STREAM_URL);
    expect(v.request.headers.accept).toBe("audio/mpeg");
    expect(v.toSdk("speechify")).toEqual({ input: "Hello", voice_id: "geffen_32", Accept: "audio/mpeg" });
  });

  test("no accept means no accept header", () => {
    const v = ttsStream({ input: "Hello", voice_id: "v" });
    expect(v.request.headers.accept).toBeUndefined();
    expect(v.toSdk("speechify")).toEqual({ input: "Hello", voice_id: "v" });
  });

  test("an undocumented accept value is invalid_enum_value", () => {
    const r = streamUnchecked({ input: "x", voice_id: "v", accept: "audio/wav" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["accept"]);
    }
  });

  test("headers are not shared between two validations", () => {
    const a = ttsStream({ input: "a", voice_id: "v", accept: "audio/mpeg" });
    const b = ttsStream({ input: "b", voice_id: "v", accept: "audio/aac" });
    a.request.headers.authorization = "Bearer leak";
    expect(b.request.headers.authorization).toBeUndefined();
  });
});

describe("speechify per-model gates (doc audit 2026-08-13)", () => {
  test("a non-English language on simba-3.2 is unsupported_capability", () => {
    const r = tts.safe({ input: "x", voice_id: "v", model: "simba-3.2", language: "fr-FR" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["language"]);
      expect(r.errors[0]?.message).toContain("English only");
    }
  });

  test("English locales pass on simba-3.2", () => {
    for (const language of ["en", "en-US", "en-GB"]) {
      expect(tts.safe({ input: "x", voice_id: "v", model: "simba-3.2", language }).ok).toBe(
        true,
      );
    }
  });

  test("simba-3.0 accepts non-English languages (documented as unvalidated, not rejected)", () => {
    const r = tts.safe({ input: "x", voice_id: "v", model: "simba-3.0", language: "fr-FR" });
    expect(r.ok).toBe(true);
  });

  test("the gate also applies on the stream route", () => {
    const r = ttsStream.safe({ input: "x", voice_id: "v", model: "simba-3.2", language: "ja-JP" });
    expect(r.ok).toBe(false);
  });
});

describe("speechify cost estimation (Starter list rate)", () => {
  test("every model prices at $10/1M characters", () => {
    for (const id of ["simba-3.2", "simba-3.0", "simba-multilingual", "simba-english"] as const) {
      const r = tts.safe({ input: "a".repeat(1000), voice_id: "v", model: id });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.01, 10);
    }
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = ttsStream.safe(
      { input: "a".repeat(20000), voice_id: "v", model: "simba-3.2" },
      { maxCostUSD: 0.05 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_budget");
      expect(r.errors[0]?.meta?.estimated).toBeCloseTo(0.2, 10);
    }
  });
});

describe("speechify catalog", () => {
  test("every synthesis model is TTS-shaped with the 20,000-character ceiling", () => {
    // The synthetic `voice-clone` id (POST /v1/voices) is deliberately not a
    // synthesis model, so the sweep runs over the synthesis allow-list.
    for (const id of SPEECHIFY_MODEL_IDS) {
      const info = models[id];
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(20000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
      expect(info.cost?.perMillionCharacters).toBe(10);
    }
  });
});
