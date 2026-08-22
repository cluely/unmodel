import { describe, expect, test } from "bun:test";
import {
  voiceClone,
  voiceCloneToFormData,
  AI_VOICE_URL,
  VOICE_CLONE_LMNT_VERSION,
} from "./voice-clone";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceClone.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const file = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

describe("lmnt.voiceClone happy path", () => {
  test("returns the validated multipart fields with the version header", () => {
    const blob = file();
    const v = voiceClone({ file: blob, name: "Narrator" });

    expect(Object.keys(v)).toEqual(["file", "name"]);
    expect(v.file).toBe(blob);

    expect(v.request.url).toBe(AI_VOICE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "lmnt-version": VOICE_CLONE_LMNT_VERSION });
  });

  test("all documented fields validate together without warnings", () => {
    const r = voiceClone.safe({
      file: file(),
      name: "Narrator",
      description: "A warm narrator voice",
      gender: "female",
      tags: ["narration", "warm"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the retired pre-1.2 shape (files[] + metadata) is unknown params now", () => {
    const r = safeUnchecked({ file: file(), name: "n", metadata: "{}", enhance: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknowns = r.warnings.filter((w) => w.code === "unknown_param").map((w) => w.path?.[0]);
      expect(unknowns.sort()).toEqual(["enhance", "metadata"]);
    }
  });
});

describe("lmnt.voiceClone shape enforcement", () => {
  test("file must be a Blob and name non-empty", () => {
    expect(safeUnchecked({ file: "not-a-blob", name: "n" }).ok).toBe(false);
    expect(voiceClone.safe({ file: file(), name: "" }).ok).toBe(false);
  });
});

describe("lmnt.voiceCloneToFormData", () => {
  test("file is the file part, tags repeat per item", () => {
    const v = voiceClone({ file: file(), name: "Narrator", tags: ["a", "b"] });
    const form = voiceCloneToFormData(v);
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("name")).toBe("Narrator");
    expect(form.getAll("tags")).toEqual(["a", "b"]);
    expect(form.has("description")).toBe(false);
  });
});
