import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  voiceCloneToFormData,
  VOICES_CLONE_URL,
  VOICE_CLONE_CARTESIA_VERSION,
  VOICE_CLONE_LANGUAGES,
  VOICE_CLONE_TAGLINE_MAX_CHARACTERS,
} from "./voice-clone";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const clip = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

describe("cartesia.voiceClone happy path", () => {
  test("returns the validated multipart fields with the version header", () => {
    const blob = clip();
    const v = voiceClone({ clip: blob, name: "Narrator", language: "en" });

    expect(Object.keys(v)).toEqual(["clip", "name", "language"]);
    expect(v.clip).toBe(blob);

    expect(v.request.url).toBe(VOICES_CLONE_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: no content-type, but the version header is required.
    expect(v.request.headers).toEqual({ "Cartesia-Version": VOICE_CLONE_CARTESIA_VERSION });
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceClone.safe({
      clip: clip(),
      name: "Narrator",
      language: "fr",
      tagline: "warm and calm",
      description: "A warm narrator voice for audiobooks",
      accent: "parisian",
      base_voice_id: "bf0a246a-8642-498a-9950-80c35e9276b5",
      access: "private",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("every documented language passes", () => {
    for (const language of VOICE_CLONE_LANGUAGES) {
      expect(voiceClone.safe({ clip: clip(), name: "n", language }).ok).toBe(true);
    }
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ clip: clip(), name: "n", language: "en", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("cartesia.voiceClone documented rules", () => {
  test("language is required and closed", () => {
    const missing = safeUnchecked({ clip: clip(), name: "n" });
    expect(missing.ok).toBe(false);
    const bad = voiceClone.safe({ clip: clip(), name: "n", language: "xx" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const issue = bad.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["language"]);
      expect(issue?.meta?.allowed).toEqual([...VOICE_CLONE_LANGUAGES]);
    }
  });

  test("tagline is capped at 32 characters", () => {
    expect(
      voiceClone.safe({
        clip: clip(),
        name: "n",
        language: "en",
        tagline: "a".repeat(VOICE_CLONE_TAGLINE_MAX_CHARACTERS + 1),
      }).ok,
    ).toBe(false);
  });

  test("an undocumented access value is invalid_enum_value", () => {
    const r = safeUnchecked({ clip: clip(), name: "n", language: "en", access: "unlisted" });
    expect(r.ok).toBe(false);
  });

  test("the retired mode/enhance/transcript fields are unknown params now", () => {
    const r = safeUnchecked({
      clip: clip(),
      name: "n",
      language: "en",
      mode: "similarity",
      enhance: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknowns = r.warnings.filter((w) => w.code === "unknown_param").map((w) => w.path?.[0]);
      expect(unknowns.sort()).toEqual(["enhance", "mode"]);
    }
  });
});

describe("cartesia.voiceCloneToFormData", () => {
  test("clip is the file part, the rest are string parts, omissions drop", () => {
    const v = voiceClone({
      clip: clip(),
      name: "Narrator",
      language: "en",
      access: "public",
    });
    const form = voiceCloneToFormData(v);
    expect(form.get("clip")).toBeInstanceOf(Blob);
    expect(form.get("name")).toBe("Narrator");
    expect(form.get("language")).toBe("en");
    expect(form.get("access")).toBe("public");
    expect(form.has("tagline")).toBe(false);
  });
});
