import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  voiceCloneToFormData,
  VOICES_URL,
  VOICE_CLONE_GENDERS,
  VOICE_CLONE_MAX_SAMPLE_BYTES,
  VOICE_CLONE_MAX_CONSENT_BYTES,
} from "./voice-clone";
import { voiceConsentChallenge, VOICES_CONSENT_CHALLENGES_URL } from "./voice-consent-challenge";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const audio = (bytes = 3) => new Blob([new Uint8Array(bytes)], { type: "audio/wav" });

const minimal = () => ({
  name: "My Voice",
  gender: "female" as const,
  sample: audio(),
  consent_challenge_id: "chal_123",
  consent_recording: audio(),
});

describe("speechify.voiceConsentChallenge", () => {
  test("returns the exact JSON body and request", () => {
    const v = voiceConsentChallenge({ full_name: "Ada Lovelace" });
    expect(Object.keys(v)).toEqual(["full_name"]);
    expect(v.request.url).toBe(VOICES_CONSENT_CHALLENGES_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("full_name must be non-empty", () => {
    expect(voiceConsentChallenge.safe({ full_name: "" }).ok).toBe(false);
  });
});

describe("speechify.voiceClone happy path", () => {
  test("returns the validated multipart fields with an empty-headers request", () => {
    const v = voiceClone(minimal());

    expect(Object.keys(v)).toEqual([
      "name",
      "gender",
      "sample",
      "consent_challenge_id",
      "consent_recording",
    ]);
    expect(v.request.url).toBe(VOICES_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from the FormData body.
    expect(v.request.headers).toEqual({});
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceClone.safe({
      ...minimal(),
      locale: "en-US",
      avatar: new Blob([new Uint8Array([1])], { type: "image/png" }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("every documented gender passes; an undocumented one is rejected", () => {
    for (const gender of VOICE_CLONE_GENDERS) {
      expect(voiceClone.safe({ ...minimal(), gender }).ok).toBe(true);
    }
    const r = voiceClone.safe({ ...minimal(), gender: "nonbinary" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["gender"]);
    }
  });
});

describe("speechify.voiceClone consent and size rules", () => {
  test("the consent pair is required", () => {
    const noId = safeUnchecked({ ...minimal(), consent_challenge_id: undefined });
    expect(noId.ok).toBe(false);
    const noRecording = safeUnchecked({ ...minimal(), consent_recording: undefined });
    expect(noRecording.ok).toBe(false);
  });

  test("the deprecated declarative consent warns, naming its replacement", () => {
    const r = voiceClone.safe({
      ...minimal(),
      consent: JSON.stringify({ fullName: "Ada Lovelace", email: "ada@example.com" }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warning = r.warnings.find((w) => w.path?.[0] === "consent");
      expect(warning?.code).toBe("unsupported_param");
      expect(warning?.message).toContain("consent_challenge_id");
    }
  });

  test("an oversized sample or consent recording is media_too_large", () => {
    const bigSample = voiceClone.safe({
      ...minimal(),
      sample: audio(VOICE_CLONE_MAX_SAMPLE_BYTES + 1),
    });
    expect(bigSample.ok).toBe(false);
    if (!bigSample.ok) {
      expect(bigSample.errors[0]?.code).toBe("media_too_large");
      expect(bigSample.errors[0]?.path).toEqual(["sample"]);
    }
    const bigConsent = voiceClone.safe({
      ...minimal(),
      consent_recording: audio(VOICE_CLONE_MAX_CONSENT_BYTES + 1),
    });
    expect(bigConsent.ok).toBe(false);
    if (!bigConsent.ok) expect(bigConsent.errors[0]?.path).toEqual(["consent_recording"]);
  });
});

describe("speechify.voiceCloneToFormData", () => {
  test("Blobs are file parts, strings are string parts", () => {
    const v = voiceClone({ ...minimal(), locale: "en-GB" });
    const form = voiceCloneToFormData(v);
    expect(form.get("sample")).toBeInstanceOf(Blob);
    expect(form.get("consent_recording")).toBeInstanceOf(Blob);
    expect(form.get("name")).toBe("My Voice");
    expect(form.get("gender")).toBe("female");
    expect(form.get("consent_challenge_id")).toBe("chal_123");
    expect(form.get("locale")).toBe("en-GB");
    expect(form.has("avatar")).toBe(false);
  });
});
