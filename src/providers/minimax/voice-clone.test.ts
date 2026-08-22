import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  toVoiceUploadFormData,
  VOICE_CLONE_URL,
  VOICE_CLONE_TEXT_MAX_CHARACTERS,
} from "./voice-clone";
import { voiceDesign, VOICE_DESIGN_URL, VOICE_DESIGN_PREVIEW_TEXT_MAX_CHARACTERS } from "./voice-design";
import { VOICE_DESIGN_PREVIEW_PER_MILLION_CHARACTERS } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const BASE = { file_id: 123456789, voice_id: "MyVoice01" };

describe("minimax.voiceClone happy path", () => {
  test("returns the exact JSON body and request", () => {
    const v = voiceClone(BASE);

    expect(Object.keys(v)).toEqual(["file_id", "voice_id"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(BASE);

    expect(v.request.url).toBe(VOICE_CLONE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceClone.safe({
      ...BASE,
      clone_prompt: { prompt_audio: 987654321, prompt_text: "Hello there." },
      text: "A short preview sentence.",
      model: "speech-2.8-hd",
      language_boost: "English",
      text_validation: "Hello there.",
      accuracy: 0.8,
      need_noise_reduction: true,
      need_volume_normalization: true,
      aigc_watermark: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a preview with text+model estimates at that model's per-character rate", () => {
    const text = "a".repeat(1000);
    const r = voiceClone.safe({ ...BASE, text, model: "speech-2.8-hd" });
    expect(r.ok).toBe(true);
    // speech-*-hd is $100 per 1M characters → 1000 chars = $0.10.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.1, 10);
  });

  test("no preview → no estimate", () => {
    const r = voiceClone.safe(BASE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("minimax.voiceClone documented rules", () => {
  test("voice_id grammar: too short, bad start, bad chars, bad tail are invalid_shape", () => {
    for (const bad of ["short", "1StartsWithDigit", "has spaces!", "EndsWithDash-", "Ends_With_"]) {
      const r = voiceClone.safe({ file_id: 1, voice_id: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((i) => i.path?.[0] === "voice_id");
        expect(issue?.code).toBe("invalid_shape");
      }
    }
    expect(voiceClone.safe({ file_id: 1, voice_id: "Voice_01" }).ok).toBe(true);
    expect(voiceClone.safe({ file_id: 1, voice_id: `A${"b".repeat(254)}c`.slice(0, 256) }).ok).toBe(
      true,
    );
  });

  test("text without model is invalid_shape naming the speech ids", () => {
    const r = voiceClone.safe({ ...BASE, text: "preview" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.path?.[0] === "model");
      expect(issue?.code).toBe("invalid_shape");
      expect(issue?.message).toContain("speech-2.8-hd");
    }
  });

  test("a non-speech catalog id as the preview model is unsupported_capability", () => {
    const r = voiceClone.safe({ ...BASE, text: "preview", model: "MiniMax-Hailuo-02" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
    }
  });

  test("an unknown preview model warns but validates", () => {
    const r = voiceClone.safe({ ...BASE, text: "preview", model: "speech-3.0-hd" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("text over 1000 characters and text_validation over 200 are rejected", () => {
    expect(
      voiceClone.safe({
        ...BASE,
        text: "a".repeat(VOICE_CLONE_TEXT_MAX_CHARACTERS + 1),
        model: "speech-2.8-hd",
      }).ok,
    ).toBe(false);
    expect(voiceClone.safe({ ...BASE, text_validation: "a".repeat(201) }).ok).toBe(false);
  });

  test("accuracy outside [0,1] is rejected by the schema", () => {
    expect(voiceClone.safe({ ...BASE, accuracy: 1.5 }).ok).toBe(false);
  });

  test("an undocumented language_boost is invalid_enum_value", () => {
    const r = safeUnchecked({ ...BASE, language_boost: "Klingon" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["language_boost"]);
    }
  });
});

describe("minimax.toVoiceUploadFormData", () => {
  test("builds the two-part upload body", () => {
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
    const form = toVoiceUploadFormData({ purpose: "voice_clone", file });
    expect(form.get("purpose")).toBe("voice_clone");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });
});

describe("minimax.voiceDesign", () => {
  test("returns the exact JSON body and request", () => {
    const v = voiceDesign({
      prompt: "A warm, deep narrator with a slow pace",
      preview_text: "Welcome to the show.",
    });
    expect(Object.keys(v)).toEqual(["prompt", "preview_text"]);
    expect(v.request.url).toBe(VOICE_DESIGN_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("preview_text is billed at $30 per 1M characters", () => {
    const preview = "a".repeat(500);
    const r = voiceDesign.safe({ prompt: "desc", preview_text: preview });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeCloseTo(
        (VOICE_DESIGN_PREVIEW_PER_MILLION_CHARACTERS * 500) / 1_000_000,
        12,
      );
    }
  });

  test("preview_text over 500 characters is rejected; a caller-chosen voice_id passes", () => {
    expect(
      voiceDesign.safe({
        prompt: "desc",
        preview_text: "a".repeat(VOICE_DESIGN_PREVIEW_TEXT_MAX_CHARACTERS + 1),
      }).ok,
    ).toBe(false);
    const r = voiceDesign.safe({
      prompt: "desc",
      preview_text: "hello.",
      voice_id: "MyDesignedVoice",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("prompt and preview_text must be non-empty", () => {
    expect(voiceDesign.safe({ prompt: "", preview_text: "hi." }).ok).toBe(false);
    expect(voiceDesign.safe({ prompt: "desc", preview_text: "" }).ok).toBe(false);
  });
});
