import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  voiceCloneToFormData,
  CREATE_MODEL_URL,
  VOICE_CLONE_MAX_VOICES,
} from "./voice-clone";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const sample = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

const minimal = () => ({
  type: "tts" as const,
  title: "Narrator",
  train_mode: "fast" as const,
  voices: [sample()],
});

describe("fish-audio.voiceClone happy path", () => {
  test("returns the validated multipart fields with an empty-headers request", () => {
    const v = voiceClone({ ...minimal(), visibility: "private" });

    expect(Object.keys(v)).toEqual(["type", "title", "train_mode", "voices", "visibility"]);
    expect(v.request.url).toBe(CREATE_MODEL_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from the FormData body.
    expect(v.request.headers).toEqual({});
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceClone.safe({
      ...minimal(),
      voices: [sample(), sample()],
      texts: ["hello there", "general kenobi"],
      visibility: "unlist",
      description: "A warm narrator voice",
      tags: ["narration", "warm"],
      enhance_audio_quality: true,
      generate_sample: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a single Blob for voices and a single string for texts pass", () => {
    const r = voiceClone.safe({
      ...minimal(),
      voices: sample(),
      texts: "hello there",
      visibility: "private",
    });
    expect(r.ok).toBe(true);
  });

  // "default": "private" — POST /model in openapi.json, 2026-11-12.
  test("omitting visibility is clean: the wire defaults to private", () => {
    const r = voiceClone.safe(minimal());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("voice_design_signatures validates as a string or an array", () => {
    for (const voice_design_signatures of ["sig-0", ["sig-0", "sig-1"]]) {
      const r = voiceClone.safe({ ...minimal(), voice_design_signatures });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a non-string voice_design_signatures is rejected", () => {
    const r = safeUnchecked({ ...minimal(), voice_design_signatures: [1] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path?.[0]).toBe("voice_design_signatures");
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ ...minimal(), visibility: "private", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("fish-audio.voiceClone shape enforcement", () => {
  test("the required consts are enforced", () => {
    const bad = safeUnchecked({ ...minimal(), type: "svc" });
    expect(bad.ok).toBe(false);
    const badMode = safeUnchecked({ ...minimal(), train_mode: "full" });
    expect(badMode.ok).toBe(false);
  });

  test("voices count is capped at 20 and floored at 1", () => {
    const over = voiceClone.safe({
      ...minimal(),
      visibility: "private",
      voices: Array.from({ length: VOICE_CLONE_MAX_VOICES + 1 }, sample),
    });
    expect(over.ok).toBe(false);
    const empty = voiceClone.safe({ ...minimal(), visibility: "private", voices: [] });
    expect(empty.ok).toBe(false);
  });

  test("an undocumented visibility is invalid_enum_value", () => {
    const r = safeUnchecked({ ...minimal(), visibility: "hidden" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["visibility"]);
      expect(issue?.meta?.allowed).toEqual(["public", "unlist", "private"]);
    }
  });

  test("an explicitly public model without a cover image is rejected", () => {
    const r = voiceClone.safe({ ...minimal(), visibility: "public" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.path?.[0] === "cover_image");
      expect(issue?.code).toBe("invalid_shape");
    }
  });

  test("a public model with a cover image passes", () => {
    const r = voiceClone.safe({ ...minimal(), visibility: "public", cover_image: sample() });
    expect(r.ok).toBe(true);
  });
});

describe("fish-audio.voiceCloneToFormData", () => {
  test("repeats voices/texts/voice_design_signatures/tags per item and stringifies scalars", () => {
    const a = sample();
    const b = sample();
    const v = voiceClone({
      ...minimal(),
      voices: [a, b],
      texts: ["one", "two"],
      voice_design_signatures: ["sig-a", "sig-b"],
      tags: ["x", "y"],
      visibility: "private",
      enhance_audio_quality: false,
    });
    const form = voiceCloneToFormData(v);
    expect(form.getAll("voices")).toHaveLength(2);
    expect(form.getAll("texts")).toEqual(["one", "two"]);
    expect(form.getAll("voice_design_signatures")).toEqual(["sig-a", "sig-b"]);
    expect(form.getAll("tags")).toEqual(["x", "y"]);
    expect(form.get("type")).toBe("tts");
    expect(form.get("train_mode")).toBe("fast");
    expect(form.get("visibility")).toBe("private");
    expect(form.get("enhance_audio_quality")).toBe("false");
  });

  test("a single Blob voices value becomes one part; a cover image is a file part", () => {
    const cover = sample();
    const v = voiceClone({
      ...minimal(),
      voices: sample(),
      visibility: "public",
      cover_image: cover,
    });
    const form = voiceCloneToFormData(v);
    expect(form.getAll("voices")).toHaveLength(1);
    expect(form.get("cover_image")).toBeInstanceOf(Blob);
    expect(form.has("texts")).toBe(false);
  });
});
