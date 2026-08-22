import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  voiceCloneToFormData,
  VOICES_ADD_URL,
  VOICE_CLONE_LABEL_KEYS,
} from "./voice-clone";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const sample = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

describe("elevenlabs.voiceClone happy path", () => {
  test("returns the validated multipart fields with an empty-headers request", () => {
    const blob = sample();
    const v = voiceClone({ name: "Narrator", files: [blob] });

    expect(Object.keys(v)).toEqual(["name", "files"]);
    expect(v.name).toBe("Narrator");
    expect(v.files[0]).toBe(blob);

    expect(v.request.url).toBe(VOICES_ADD_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from the FormData body.
    expect(v.request.headers).toEqual({});
  });

  test("all documented fields validate together", () => {
    const r = voiceClone.safe({
      name: "Narrator",
      files: [sample(), sample()],
      description: "A warm narrator voice",
      labels: { language: "en", accent: "british", gender: "female", age: "middle-aged" },
      remove_background_noise: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit null means provider default and passes", () => {
    const r = voiceClone.safe({ name: "n", files: [sample()], description: null, labels: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("toSdk camelCases and drops nulls", () => {
    const blob = sample();
    const v = voiceClone({
      name: "Narrator",
      files: [blob],
      description: null,
      remove_background_noise: true,
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      name: "Narrator",
      files: [blob],
      removeBackgroundNoise: true,
    });
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ name: "n", files: [sample()], brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("elevenlabs.voiceClone shape enforcement", () => {
  test("an empty files array is rejected", () => {
    const r = voiceClone.safe({ name: "n", files: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((i) => i.path?.[0] === "files")).toBe(true);
    }
  });

  test("a non-Blob files entry is rejected", () => {
    const r = safeUnchecked({ name: "n", files: ["not-a-blob"] });
    expect(r.ok).toBe(false);
  });

  test("an empty name is rejected", () => {
    const r = voiceClone.safe({ name: "", files: [sample()] });
    expect(r.ok).toBe(false);
  });

  test("an undocumented labels key is invalid_enum_value naming the four keys", () => {
    const r = safeUnchecked({ name: "n", files: [sample()], labels: { mood: "cheerful" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["labels", "mood"]);
      expect(issue?.meta?.allowed).toEqual([...VOICE_CLONE_LABEL_KEYS]);
    }
  });
});

describe("elevenlabs.voiceCloneToFormData", () => {
  test("appends each file as its own `files` part and JSON-encodes labels", () => {
    const a = sample();
    const b = sample();
    const v = voiceClone({
      name: "Narrator",
      files: [a, b],
      labels: { language: "en" },
      remove_background_noise: false,
    });
    const form = voiceCloneToFormData(v);
    expect(form.getAll("files")).toHaveLength(2);
    expect(form.get("name")).toBe("Narrator");
    expect(form.get("labels")).toBe(JSON.stringify({ language: "en" }));
    expect(form.get("remove_background_noise")).toBe("false");
  });

  test("omits null and undefined fields", () => {
    const v = voiceClone({ name: "n", files: [sample()], description: null });
    const form = voiceCloneToFormData(v);
    expect(form.has("description")).toBe(false);
    expect(form.has("remove_background_noise")).toBe(false);
  });
});
