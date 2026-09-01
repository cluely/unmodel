import { describe, expect, test } from "bun:test";
import {
  imageEdit,
  toFormData,
  IMAGES_EDITS_URL,
  DEFAULT_IMAGE_EDIT_MODEL_ID,
  MAX_EDIT_IMAGES,
} from "./image-edit";
import { imagesEditConstraints } from "./constraints";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the Tier-A compile-time surface so runtime enforcement of
// type-blocked params can be exercised.
const safeUnchecked = imageEdit.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const png = (bytes = 1024): Blob =>
  new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("openai.imageEdit happy path", () => {
  test("returns the multipart params with hidden toSdk/request", () => {
    const image = png();
    const v = imageEdit({
      model: "gpt-image-1.5",
      image,
      prompt: "put the product on a marble counter",
      size: "1536x1024",
      quality: "high",
      input_fidelity: "high",
    });

    expect(Object.keys(v)).toEqual([
      "model",
      "image",
      "prompt",
      "size",
      "quality",
      "input_fidelity",
    ]);
    expect(v.request.url).toBe(IMAGES_EDITS_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary, so no content-type is set.
    expect(v.request.headers).toEqual({});
    expect({ ...v.toSdk("openai") }).toEqual({ ...v });
  });

  test("model may be omitted (server default gpt-image-1.5)", () => {
    const r = imageEdit.safe({ image: png(), prompt: "x", input_fidelity: "low" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    expect(DEFAULT_IMAGE_EDIT_MODEL_ID).toBe("gpt-image-1.5");
  });

  test("up to 16 images pass, 17 do not", () => {
    const ok = imageEdit.safe({
      model: "gpt-image-2",
      image: Array.from({ length: MAX_EDIT_IMAGES }, () => png()),
      prompt: "x",
    });
    expect(ok.ok).toBe(true);

    const tooMany = imageEdit.safe({
      model: "gpt-image-2",
      image: Array.from({ length: MAX_EDIT_IMAGES + 1 }, () => png()),
      prompt: "x",
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.errors[0]?.code).toBe("invalid_shape");
      expect(tooMany.errors[0]?.path).toEqual(["image"]);
    }
  });

  test("unknown model falls back to the escape arm with a warning", () => {
    const r = imageEdit.safe({ model: "gpt-image-9", image: png(), prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
  });
});

describe("openai.imageEdit per-model rules", () => {
  test("input_fidelity is denied on gpt-image-2 (fixed at high)", () => {
    const r = safeUnchecked({
      model: "gpt-image-2",
      image: png(),
      prompt: "x",
      input_fidelity: "high",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["input_fidelity"]);
      expect(String(issue?.meta?.source)).toContain("guides/image-generation");
    }
  });

  test("input_fidelity is denied on gpt-image-1-mini", () => {
    const r = safeUnchecked({
      model: "gpt-image-1-mini",
      image: png(),
      prompt: "x",
      input_fidelity: "low",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["input_fidelity"]);
  });

  test("transparent background passes on gpt-image-2 — preview support, both ids", () => {
    for (const model of ["gpt-image-2", "gpt-image-2-2026-04-21"] as const) {
      const r = imageEdit.safe({
        model,
        image: png(),
        prompt: "x",
        background: "transparent",
      });
      expect(r.ok).toBe(true);
    }
  });

  test('transparent with output_format "jpeg" is rejected on edits too', () => {
    const r = safeUnchecked({
      model: "gpt-image-2",
      image: png(),
      prompt: "x",
      background: "transparent",
      output_format: "jpeg",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["output_format"]);
  });

  test("gpt-image-2 free-form sizes follow the documented pixel band", () => {
    expect(imageEdit.safe({ model: "gpt-image-2", image: png(), prompt: "x", size: "1536x864" }).ok).toBe(true);

    const r = imageEdit.safe({ model: "gpt-image-2", image: png(), prompt: "x", size: "1000x1000" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.violations).toEqual(["divisible_by_16"]);
  });

  test("response_format is denied on GPT image models", () => {
    const r = safeUnchecked({
      model: "gpt-image-1",
      image: png(),
      prompt: "x",
      response_format: "url",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["response_format"]);
  });

  test("dall-e-2 accepts one image and rejects GPT-image-only params", () => {
    const r = safeUnchecked({
      model: "dall-e-2",
      image: png(),
      prompt: "x",
      output_format: "png",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["output_format"]);

    const twoImages = safeUnchecked({
      model: "dall-e-2",
      image: [png(), png()],
      prompt: "x",
    });
    expect(twoImages.ok).toBe(false);
    if (!twoImages.ok) {
      expect(twoImages.errors.some((e) => e.message.includes("at most 1"))).toBe(true);
    }
  });

  test("dall-e-3 is not an edit model — it hits the escape arm", () => {
    expect(Object.hasOwn(imagesEditConstraints, "dall-e-3")).toBe(false);
  });
});

describe("openai.imageEdit upload limits", () => {
  test("an image over 50MB is media_too_large", () => {
    const r = imageEdit.safe({
      model: "gpt-image-1.5",
      image: png(51 * 1024 * 1024),
      prompt: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "media_too_large");
      expect(issue?.path).toEqual(["image"]);
    }
  });

  test("dall-e-2 caps uploads at 4MB and png only", () => {
    const r = safeUnchecked({
      model: "dall-e-2",
      image: new Blob([new Uint8Array(5 * 1024 * 1024)], { type: "image/jpeg" }),
      prompt: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code).sort()).toEqual([
        "media_too_large",
        "media_unsupported_format",
      ]);
    }
  });

  test("a non-PNG mask is media_unsupported_format", () => {
    const r = imageEdit.safe({
      model: "gpt-image-1.5",
      image: png(),
      mask: new Blob([new Uint8Array(16)], { type: "image/webp" }),
      prompt: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "media_unsupported_format");
      expect(issue?.path).toEqual(["mask"]);
    }
  });

  test("an unlabeled Blob is never format-checked", () => {
    const r = imageEdit.safe({
      model: "gpt-image-1.5",
      image: new Blob([new Uint8Array(16)]),
      prompt: "x",
    });
    expect(r.ok).toBe(true);
  });

  test("array images report the offending index", () => {
    const r = imageEdit.safe({
      model: "gpt-image-1.5",
      image: [png(), png(51 * 1024 * 1024)],
      prompt: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["image", 1]);
  });
});

describe("openai.imageEdit toFormData", () => {
  test("a single image rides as `image`, arrays as repeated `image[]`", () => {
    const single = toFormData({ model: "gpt-image-1.5", image: png(), prompt: "x" });
    expect(single.get("image")).toBeInstanceOf(Blob);
    expect(single.get("model")).toBe("gpt-image-1.5");

    const many = toFormData({ model: "gpt-image-2", image: [png(), png()], prompt: "x" });
    expect(many.getAll("image[]").length).toBe(2);
    expect(many.get("image")).toBeNull();
  });

  test("null values are dropped and scalars stringified", () => {
    const form = toFormData({
      model: "gpt-image-1.5",
      image: png(),
      prompt: "x",
      n: 2,
      quality: null,
      mask: png(),
    });
    expect(form.get("n")).toBe("2");
    expect(form.get("quality")).toBeNull();
    expect(form.get("mask")).toBeInstanceOf(Blob);
  });
});
