import { describe, expect, test } from "bun:test";
import {
  textToSpeech,
  textToSpeechUrl,
  TEXT_TO_SPEECH_BASE_URL,
  TTS_OUTPUT_FORMATS,
  TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS,
  TTS_SPEED_MIN,
  TTS_SPEED_MAX,
} from "./text-to-speech";
import { models, TTS_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = textToSpeech.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("elevenlabs.textToSpeech happy path", () => {
  test("returns a wire-pure body with voice_id and output_format stripped", () => {
    const v = textToSpeech({
      voice_id: "JBFqnCBsd6RMkjVDRZzb",
      text: "Hello world",
      model_id: "eleven_flash_v2_5",
      output_format: "mp3_44100_128",
      seed: 42,
    });

    // voice_id (path param) and output_format (query param) are not body fields.
    expect(Object.keys(v)).toEqual(["text", "model_id", "seed"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      text: "Hello world",
      model_id: "eleven_flash_v2_5",
      seed: 42,
    });

    expect(v.request.url).toBe(
      `${TEXT_TO_SPEECH_BASE_URL}/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128`,
    );
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("omitting output_format leaves the URL query-free", () => {
    const v = textToSpeech({ voice_id: "abc123", text: "hi", model_id: "eleven_v3" });
    expect(v.request.url).toBe(`${TEXT_TO_SPEECH_BASE_URL}/abc123`);
  });

  test("voice ids are URL-encoded into the path", () => {
    expect(textToSpeechUrl("we ird/id")).toBe(`${TEXT_TO_SPEECH_BASE_URL}/we%20ird%2Fid`);
  });

  test("toSdk returns { voiceId, request } camelCased with nulls dropped", () => {
    const v = textToSpeech({
      voice_id: "abc123",
      text: "hi",
      model_id: "eleven_flash_v2_5",
      previous_text: "before",
      language_code: "de",
      seed: null,
      voice_settings: { stability: 0.4, similarity_boost: 0.9, use_speaker_boost: true, speed: null },
      pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "dict1", version_id: "v1" }],
      output_format: "pcm_16000",
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      voiceId: "abc123",
      request: {
        text: "hi",
        modelId: "eleven_flash_v2_5",
        previousText: "before",
        languageCode: "de",
        voiceSettings: { stability: 0.4, similarityBoost: 0.9, useSpeakerBoost: true },
        pronunciationDictionaryLocators: [{ pronunciationDictionaryId: "dict1", versionId: "v1" }],
        outputFormat: "pcm_16000",
      },
    });
  });

  test("explicit null means provider default and passes", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "hi",
      model_id: "eleven_flash_v2_5",
      language_code: null,
      voice_settings: null,
      seed: null,
      previous_text: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns but validates", () => {
    const r = textToSpeech.safe({ voice_id: "abc123", text: "hi", model_id: "eleven_v4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("deprecated turbo models warn", () => {
    expect(models.eleven_turbo_v2_5.status).toBe("deprecated");
    const r = textToSpeech.safe({ voice_id: "abc123", text: "hi", model_id: "eleven_turbo_v2_5" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ voice_id: "abc123", text: "hi", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("elevenlabs.textToSpeech character limits", () => {
  test("text over the per-model cap is over_output_limit with character meta", () => {
    const limit = models.eleven_v3.limit.characters;
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "x".repeat(limit + 1),
      model_id: "eleven_v3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors[0];
      expect(issue?.code).toBe("over_output_limit");
      expect(issue?.path).toEqual(["text"]);
      expect(issue?.message).toContain("characters");
      expect(issue?.meta?.limitCharacters).toBe(limit);
      expect(issue?.meta?.actualCharacters).toBe(limit + 1);
    }
  });

  test("text exactly at the cap passes", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "x".repeat(models.eleven_v3.limit.characters),
      model_id: "eleven_v3",
    });
    expect(r.ok).toBe(true);
  });

  test("omitted model_id enforces the documented default model's 10k cap", () => {
    // Server-side default is eleven_multilingual_v2 (10,000 characters).
    const r = textToSpeech.safe({ voice_id: "abc123", text: "x".repeat(10001) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.model).toBe("eleven_multilingual_v2");
    }
  });

  test("caps differ per model: 10001 chars pass on flash_v2_5 (40k cap)", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "x".repeat(10001),
      model_id: "eleven_flash_v2_5",
    });
    expect(r.ok).toBe(true);
  });
});

describe("elevenlabs.textToSpeech cost estimation", () => {
  test("multilingual v2 class is $0.10 per 1k characters", () => {
    // 1,000 chars × $100 / 1M chars = $0.10
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "x".repeat(1000),
      model_id: "eleven_multilingual_v2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.1, 10);
  });

  test("flash class is $0.05 per 1k characters", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "x".repeat(1000),
      model_id: "eleven_flash_v2_5",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05, 10);
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = textToSpeech.safe(
      { voice_id: "abc123", text: "x".repeat(2000), model_id: "eleven_v3" },
      { maxCostUSD: 0.1 },
    );
    // 2,000 chars × $100 / 1M = $0.20 > $0.10
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("unknown models carry no estimate", () => {
    const r = textToSpeech.safe({ voice_id: "abc123", text: "hi", model_id: "eleven_v4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("elevenlabs.textToSpeech enums and shape", () => {
  test("an undocumented output_format is invalid_enum_value", () => {
    const r = safeUnchecked({ voice_id: "abc123", text: "hi", output_format: "mp3_44100_1280" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["output_format"]);
      expect(issue?.meta?.allowed).toEqual([...TTS_OUTPUT_FORMATS]);
    }
  });

  test("every documented output_format passes", () => {
    // Keep in sync with ElevenlabsOutputFormat — the union is closed on both
    // `TextToSpeechParams.output_format` and `TextToSpeechQuery.output_format`
    // (the textToSpeechUrl helper's param type), so every value either surface
    // advertises must clear checkOutputFormat.
    expect(TTS_OUTPUT_FORMATS.length).toBe(28);
    for (const format of TTS_OUTPUT_FORMATS) {
      const r = textToSpeech.safe({ voice_id: "abc123", text: "hi", output_format: format });
      expect(r.ok, `preset ${format} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${format} should be warning-free`).toEqual([]);
      // The same value is legal on the hand-built-URL path.
      expect(textToSpeechUrl("v1", { output_format: format })).toContain(
        `output_format=${format}`,
      );
    }
  });

  test("apply_text_normalization outside auto/on/off is invalid_shape", () => {
    const r = safeUnchecked({ voice_id: "abc123", text: "hi", apply_text_normalization: "always" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("seed outside 0..4294967295 is invalid_shape", () => {
    const r = safeUnchecked({ voice_id: "abc123", text: "hi", seed: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("more than 3 pronunciation dictionary locators is invalid_shape", () => {
    const locator = { pronunciation_dictionary_id: "d" };
    const r = safeUnchecked({
      voice_id: "abc123",
      text: "hi",
      pronunciation_dictionary_locators: [locator, locator, locator, locator],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("missing text is invalid_shape and the throwing form throws", () => {
    const throwing = textToSpeech as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ voice_id: "abc123" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("elevenlabs.textToSpeech constraints", () => {
  test("language_code on eleven_multilingual_v2 warns (the API accepts it and ignores it)", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "hi",
      model_id: "eleven_multilingual_v2",
      language_code: "de",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings[0]?.code).toBe("unsupported_param");
      expect(r.warnings[0]?.path).toEqual(["language_code"]);
      expect(r.warnings[0]?.message).toContain("silently ignored by the API");
      expect(String(r.warnings[0]?.meta?.source)).toContain("elevenlabs.io/docs");
    }
  });

  test("language_code passes on flash_v2_5", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "hi",
      model_id: "eleven_flash_v2_5",
      language_code: "de",
    });
    expect(r.ok).toBe(true);
  });

  test("constraintsFor exposes the deny rule", () => {
    const deny = textToSpeech.constraintsFor("eleven_multilingual_v2")[0]?.deny?.language_code;
    expect(deny?.reason).toContain("multilingual_v2");
    expect(deny?.source).toContain("elevenlabs.io");
  });
});

describe("elevenlabs.textToSpeech query params (doc audit 2026-08-13)", () => {
  test("enable_logging and optimize_streaming_latency ride on the URL, not the body", () => {
    const v = textToSpeech({
      voice_id: "abc123",
      text: "hi",
      model_id: "eleven_flash_v2_5",
      output_format: "mp3_44100_128",
      enable_logging: false,
      optimize_streaming_latency: 3,
    });

    // Query params must never end up in the JSON body: the API ignores them
    // there, which would silently disable zero-retention mode.
    expect(Object.keys(v)).toEqual(["text", "model_id"]);

    const url = new URL(v.request.url);
    expect(url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(url.searchParams.get("enable_logging")).toBe("false");
    expect(url.searchParams.get("optimize_streaming_latency")).toBe("3");
  });

  test("toSdk carries the query params inside the SDK request object", () => {
    const v = textToSpeech({
      voice_id: "abc123",
      text: "hi",
      enable_logging: false,
      optimize_streaming_latency: 0,
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      voiceId: "abc123",
      request: { text: "hi", enableLogging: false, optimizeStreamingLatency: 0 },
    });
  });

  test("optimize_streaming_latency outside 0..4 is invalid_shape", () => {
    const r = safeUnchecked({ voice_id: "a", text: "hi", optimize_streaming_latency: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("every optimize_streaming_latency level validates cleanly", () => {
    // Keep in sync with ElevenlabsOptimizeStreamingLatency — the documented
    // space is exactly the integers 0–4, so each level the union advertises
    // must clear the schema's .int().min(0).max(4).
    expect(TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS.length).toBe(5);
    for (const level of TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS) {
      const r = textToSpeech.safe({
        voice_id: "abc123",
        text: "hi",
        optimize_streaming_latency: level,
      });
      expect(r.ok, `level ${level} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `level ${level} should be warning-free`).toEqual([]);
    }
  });

  test("textToSpeechUrl builds the documented query string", () => {
    expect(textToSpeechUrl("v1", { output_format: "pcm_16000", enable_logging: true })).toBe(
      `${TEXT_TO_SPEECH_BASE_URL}/v1?output_format=pcm_16000&enable_logging=true`,
    );
  });
});

describe("elevenlabs.textToSpeech voice_settings bounds (doc audit 2026-08-13)", () => {
  test("speed outside the documented 0.7-1.2 range errors with the doc source", () => {
    const r = textToSpeech.safe({
      voice_id: "abc123",
      text: "hi",
      voice_settings: { speed: 1.5 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors[0];
      expect(issue?.path).toEqual(["voice_settings", "speed"]);
      expect(issue?.meta?.min).toBe(TTS_SPEED_MIN);
      expect(issue?.meta?.max).toBe(TTS_SPEED_MAX);
      expect(String(issue?.meta?.source)).toContain("prompting/controls");
    }
  });

  test("the documented bounds themselves pass", () => {
    for (const speed of [TTS_SPEED_MIN, 1, TTS_SPEED_MAX]) {
      const r = textToSpeech.safe({ voice_id: "a", text: "hi", voice_settings: { speed } });
      expect(r.ok).toBe(true);
    }
  });

  test("stability/similarity_boost/style stay unconstrained (docs publish no bounds)", () => {
    const r = textToSpeech.safe({
      voice_id: "a",
      text: "hi",
      voice_settings: { stability: 1, similarity_boost: 0, style: 1 },
    });
    expect(r.ok).toBe(true);
  });
});

describe("elevenlabs.textToSpeech model gating (doc audit 2026-08-13)", () => {
  test("a catalog model from another API is unsupported_capability", () => {
    for (const modelId of ["scribe_v2", "music_v2", "eleven_english_sts_v2"]) {
      const r = textToSpeech.safe({ voice_id: "a", text: "hi", model_id: modelId });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["model_id"]);
      }
    }
  });

  test("ids unknown to the catalog stay a warning, not an error", () => {
    const r = textToSpeech.safe({ voice_id: "a", text: "hi", model_id: "eleven_v9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("every TTS model id passes the gate", () => {
    for (const id of TTS_MODEL_IDS) {
      const r = textToSpeech.safe({ voice_id: "a", text: "hi", model_id: id });
      expect(r.ok).toBe(true);
    }
  });
});
