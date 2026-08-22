import { describe, expect, test } from "bun:test";
import {
  voiceDesign,
  textToVoiceDesignUrl,
  TEXT_TO_VOICE_DESIGN_URL,
  VOICE_DESIGN_OUTPUT_FORMATS,
  VOICE_DESIGN_TEXT_MIN_CHARACTERS,
  VOICE_DESIGN_TEXT_MAX_CHARACTERS,
} from "./voice-design";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceDesign.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const PREVIEW_TEXT = "a".repeat(VOICE_DESIGN_TEXT_MIN_CHARACTERS);

describe("elevenlabs.voiceDesign happy path", () => {
  test("returns a wire-pure body with output_format stripped to the URL", () => {
    const v = voiceDesign({
      voice_description: "A calm, deep narrator with a slight rasp",
      model_id: "eleven_ttv_v3",
      output_format: "mp3_44100_128",
      seed: 42,
    });

    expect(Object.keys(v)).toEqual(["voice_description", "model_id", "seed"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      voice_description: "A calm, deep narrator with a slight rasp",
      model_id: "eleven_ttv_v3",
      seed: 42,
    });

    expect(v.request.url).toBe(`${TEXT_TO_VOICE_DESIGN_URL}?output_format=mp3_44100_128`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("omitting output_format leaves the URL query-free", () => {
    const v = voiceDesign({ voice_description: "desc" });
    expect(v.request.url).toBe(TEXT_TO_VOICE_DESIGN_URL);
    expect(textToVoiceDesignUrl()).toBe(TEXT_TO_VOICE_DESIGN_URL);
  });

  test("every documented body field validates on eleven_ttv_v3", () => {
    const r = voiceDesign.safe({
      voice_description: "A bright announcer",
      model_id: "eleven_ttv_v3",
      text: PREVIEW_TEXT,
      auto_generate_text: false,
      loudness: 0.5,
      quality: 0.8,
      seed: 7,
      guidance_scale: 5,
      stream_previews: false,
      should_enhance: true,
      remixing_session_id: "rs_1",
      remixing_session_iteration_id: "rsi_1",
      reference_audio_base64: "AAAA",
      prompt_strength: 0.4,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("toSdk camelCases, drops nulls, and folds the query param in", () => {
    const v = voiceDesign({
      voice_description: "desc",
      text: null,
      auto_generate_text: true,
      loudness: -0.25,
      output_format: "pcm_24000",
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      voiceDescription: "desc",
      autoGenerateText: true,
      loudness: -0.25,
      outputFormat: "pcm_24000",
    });
  });

  test("unknown model warns but validates", () => {
    const r = voiceDesign.safe({ voice_description: "desc", model_id: "eleven_ttv_v4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("elevenlabs.voiceDesign model gating", () => {
  test("a catalog id from another API is rejected as unsupported_capability", () => {
    const r = voiceDesign.safe({ voice_description: "desc", model_id: "eleven_multilingual_v2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model_id"]);
      expect(issue?.meta?.allowed).toEqual(["eleven_ttv_v3", "eleven_multilingual_ttv_v2"]);
    }
  });

  test("v3-only fields are rejected on the default (ttv_v2) model", () => {
    const r = voiceDesign.safe({
      voice_description: "desc",
      reference_audio_base64: "AAAA",
      prompt_strength: 0.5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.filter((i) => i.code === "unsupported_param").map((i) => i.path?.[0]);
      expect(paths.sort()).toEqual(["prompt_strength", "reference_audio_base64"]);
    }
  });

  test("v3-only fields pass on eleven_ttv_v3", () => {
    const r = voiceDesign.safe({
      voice_description: "desc",
      model_id: "eleven_ttv_v3",
      reference_audio_base64: "AAAA",
      prompt_strength: 0.5,
    });
    expect(r.ok).toBe(true);
  });
});

describe("elevenlabs.voiceDesign documented bounds", () => {
  test("text shorter than 100 characters is invalid_shape with bounds meta", () => {
    const r = voiceDesign.safe({ voice_description: "desc", text: "too short" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_shape");
      expect(issue?.path).toEqual(["text"]);
      expect(issue?.meta?.min).toBe(VOICE_DESIGN_TEXT_MIN_CHARACTERS);
      expect(issue?.meta?.max).toBe(VOICE_DESIGN_TEXT_MAX_CHARACTERS);
    }
  });

  test("text over 1000 characters is rejected; 1000 exactly passes", () => {
    const over = voiceDesign.safe({
      voice_description: "desc",
      text: "a".repeat(VOICE_DESIGN_TEXT_MAX_CHARACTERS + 1),
    });
    expect(over.ok).toBe(false);
    const exact = voiceDesign.safe({
      voice_description: "desc",
      text: "a".repeat(VOICE_DESIGN_TEXT_MAX_CHARACTERS),
    });
    expect(exact.ok).toBe(true);
  });

  test("loudness outside −1..1 is rejected by the schema", () => {
    const r = voiceDesign.safe({ voice_description: "desc", loudness: 1.5 });
    expect(r.ok).toBe(false);
  });

  test("prompt_strength outside 0..1 is rejected by the schema", () => {
    const r = voiceDesign.safe({
      voice_description: "desc",
      model_id: "eleven_ttv_v3",
      prompt_strength: 2,
    });
    expect(r.ok).toBe(false);
  });

  test("every documented output_format passes; an undocumented one is rejected", () => {
    for (const format of VOICE_DESIGN_OUTPUT_FORMATS) {
      const r = voiceDesign.safe({ voice_description: "desc", output_format: format });
      expect(r.ok).toBe(true);
    }
    // The design endpoint documents no wav_* values (unlike text-to-speech).
    const r = safeUnchecked({ voice_description: "desc", output_format: "wav_44100" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["output_format"]);
    }
  });
});
