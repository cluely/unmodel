import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  VOICES_CLONE_URL,
  VOICE_CLONE_MAX_SAMPLE_BYTES,
  INWORLD_LANG_CODES,
} from "./voice-clone";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

/** Valid base64 for a payload of `bytes` zero-bytes. */
const base64OfBytes = (bytes: number) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

const SAMPLE = { audioData: base64OfBytes(12) };

describe("inworld.voiceClone happy path", () => {
  test("returns the exact JSON body and request — samples ride inline as base64", () => {
    const v = voiceClone({ displayName: "Narrator", voiceSamples: [SAMPLE] });

    expect(Object.keys(v)).toEqual(["displayName", "voiceSamples"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      displayName: "Narrator",
      voiceSamples: [{ audioData: SAMPLE.audioData }],
    });

    expect(v.request.url).toBe(VOICES_CLONE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceClone.safe({
      displayName: "Narrator",
      voiceSamples: [
        { audioData: SAMPLE.audioData, transcription: "hello there" },
        { audioData: SAMPLE.audioData },
      ],
      languageCode: "en-US",
      description: "A warm narrator voice",
      tags: ["british", "calm"],
      audioProcessingConfig: { removeBackgroundNoise: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("every documented legacy langCode passes", () => {
    for (const code of INWORLD_LANG_CODES) {
      const r = voiceClone.safe({
        displayName: "n",
        voiceSamples: [SAMPLE],
        langCode: code,
      });
      expect(r.ok).toBe(true);
    }
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ displayName: "n", voiceSamples: [SAMPLE], brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("inworld.voiceClone documented rules", () => {
  test("languageCode and langCode together are invalid_shape", () => {
    const r = voiceClone.safe({
      displayName: "n",
      voiceSamples: [SAMPLE],
      languageCode: "en-US",
      langCode: "EN_US",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_shape");
      expect(issue?.path).toEqual(["langCode"]);
      expect(issue?.message).toContain("at most one");
    }
  });

  test("an undocumented langCode is invalid_enum_value", () => {
    const r = voiceClone.safe({ displayName: "n", voiceSamples: [SAMPLE], langCode: "SV_SE" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["langCode"]);
      expect(issue?.meta?.allowed).toEqual([...INWORLD_LANG_CODES]);
    }
  });

  test("a sample over 4MB is media_too_large at its index", () => {
    const oversized = "A".repeat(Math.ceil((VOICE_CLONE_MAX_SAMPLE_BYTES + 1024) / 3) * 4);
    const r = voiceClone.safe({
      displayName: "n",
      voiceSamples: [SAMPLE, { audioData: oversized }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "media_too_large");
      expect(issue?.path).toEqual(["voiceSamples", 1, "audioData"]);
      expect(issue?.meta?.limit).toBe(VOICE_CLONE_MAX_SAMPLE_BYTES);
    }
  });

  test("an empty voiceSamples array is rejected", () => {
    const r = voiceClone.safe({ displayName: "n", voiceSamples: [] });
    expect(r.ok).toBe(false);
  });

  test("a sample without audioData is rejected", () => {
    const r = safeUnchecked({ displayName: "n", voiceSamples: [{ transcription: "hi" }] });
    expect(r.ok).toBe(false);
  });
});
