import { describe, expect, test } from "bun:test";
import {
  voiceDesign,
  VOICES_DESIGN_URL,
  VOICE_DESIGN_PROMPT_MIN_CHARACTERS,
  VOICE_DESIGN_PROMPT_MAX_CHARACTERS,
} from "./voice-design";
import { voiceDesignPublish, voiceDesignPublishUrl } from "./voice-design-publish";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceDesign.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const PROMPT = "An elderly British gentleman with a warm, slow, gravelly storytelling tone";

describe("inworld.voiceDesign happy path", () => {
  test("returns the exact JSON body and request", () => {
    const v = voiceDesign({ designPrompt: PROMPT, previewText: "Once upon a time." });

    expect(Object.keys(v)).toEqual(["designPrompt", "previewText"]);
    expect(v.request.url).toBe(VOICES_DESIGN_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceDesign.safe({
      designPrompt: PROMPT,
      previewText: "Once upon a time, in a land far away.",
      languageCode: "en-US",
      voiceDesignConfig: { numberOfSamples: 3 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ designPrompt: PROMPT, previewText: "hi.", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("inworld.voiceDesign documented bounds", () => {
  test("designPrompt is bounded 30–250 characters", () => {
    expect(voiceDesign.safe({ designPrompt: "too short", previewText: "hi." }).ok).toBe(false);
    expect(
      voiceDesign.safe({
        designPrompt: "a".repeat(VOICE_DESIGN_PROMPT_MAX_CHARACTERS + 1),
        previewText: "hi.",
      }).ok,
    ).toBe(false);
    expect(
      voiceDesign.safe({
        designPrompt: "a".repeat(VOICE_DESIGN_PROMPT_MIN_CHARACTERS),
        previewText: "hi.",
      }).ok,
    ).toBe(true);
  });

  test("previewText must not be empty", () => {
    expect(voiceDesign.safe({ designPrompt: PROMPT, previewText: "" }).ok).toBe(false);
  });

  test("numberOfSamples is bounded 1–3", () => {
    for (const [value, ok] of [
      [0, false],
      [1, true],
      [3, true],
      [4, false],
    ] as const) {
      const r = voiceDesign.safe({
        designPrompt: PROMPT,
        previewText: "hi.",
        voiceDesignConfig: { numberOfSamples: value },
      });
      expect(r.ok).toBe(ok);
    }
  });

  test("languageCode and langCode together are invalid_shape", () => {
    const r = voiceDesign.safe({
      designPrompt: PROMPT,
      previewText: "hi.",
      languageCode: "en-US",
      langCode: "EN_US",
    });
    expect(r.ok).toBe(false);
  });
});

describe("inworld.voiceDesignPublish", () => {
  test("voiceId is a path param, stripped from the body", () => {
    const v = voiceDesignPublish({
      voiceId: "my-workspace__draft-1",
      displayName: "Narrator",
      description: "A warm narrator voice",
    });

    expect(Object.keys(v)).toEqual(["displayName", "description"]);
    expect(v.request.url).toBe(voiceDesignPublishUrl("my-workspace__draft-1"));
    expect(v.request.url.endsWith(":publish")).toBe(true);
    expect(v.request.method).toBe("POST");
  });

  test("displayName and description are required non-empty; tags stay optional", () => {
    expect(
      voiceDesignPublish.safe({ voiceId: "w__v", displayName: "", description: "d" }).ok,
    ).toBe(false);
    expect(
      voiceDesignPublish.safe({ voiceId: "w__v", displayName: "n", description: "" }).ok,
    ).toBe(false);
    const r = voiceDesignPublish.safe({
      voiceId: "w__v",
      displayName: "n",
      description: "d",
      tags: ["demo", "custom"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});
