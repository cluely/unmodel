import { describe, expect, test } from "bun:test";
import {
  stableImageUltra,
  stableImageCore,
  stableImageSd3,
  toFormData,
  STABLE_IMAGE_ULTRA_URL,
  STABLE_IMAGE_CORE_URL,
  STABLE_IMAGE_SD3_URL,
  STABILITY_STYLE_PRESETS,
} from "./generate";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

const safeUltraUnchecked = stableImageUltra.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const safeCoreUnchecked = stableImageCore.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const safeSd3Unchecked = stableImageSd3.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("stability.stableImageUltra", () => {
  test("enumerable props are the exact multipart fields", () => {
    const v = stableImageUltra({
      prompt: "a lighthouse at dawn",
      negative_prompt: "fog",
      aspect_ratio: "16:9",
      seed: 7,
      output_format: "webp",
    });
    expect(Object.keys(v)).toEqual([
      "prompt",
      "negative_prompt",
      "aspect_ratio",
      "seed",
      "output_format",
    ]);
    expect(v.request.url).toBe(STABLE_IMAGE_ULTRA_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from FormData; no static headers.
    expect(v.request.headers).toEqual({});
    // No official JS SDK — toSdk("stability") returns the fields unchanged.
    expect(v.toSdk("stability")).toEqual({
      prompt: "a lighthouse at dawn",
      negative_prompt: "fog",
      aspect_ratio: "16:9",
      seed: 7,
      output_format: "webp",
    });
  });

  test("image with strength passes; image without strength fails", () => {
    const ok = stableImageUltra.safe({ prompt: "hi", image: pngBlob, strength: 0.6 });
    expect(ok.ok).toBe(true);
    const bad = stableImageUltra.safe({ prompt: "hi", image: pngBlob });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]?.code).toBe("invalid_shape");
      expect(bad.errors[0]?.path).toEqual(["strength"]);
    }
  });

  test("estimates 8 credits = $0.08 and enforces maxCostUSD", () => {
    const r = stableImageUltra.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.08, 10);
    const over = stableImageUltra.safe({ prompt: "hi" }, { maxCostUSD: 0.05 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.code).toBe("over_budget");
  });

  test("prompt over 10000 characters is invalid_shape", () => {
    const r = stableImageUltra.safe({ prompt: "x".repeat(10001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("seed outside 0..4294967294 is invalid_shape", () => {
    const r = safeUltraUnchecked({ prompt: "hi", seed: 4294967295 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["seed"]);
  });

  test("empty prompt throws via the throwing form", () => {
    const throwing = stableImageUltra as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ prompt: "" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("stability.stableImageCore", () => {
  test("enumerable props are the exact multipart fields", () => {
    const v = stableImageCore({
      prompt: "a lighthouse at dawn",
      aspect_ratio: "16:9",
      output_format: "webp",
    });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio", "output_format"]);
    expect(v.request.url).toBe(STABLE_IMAGE_CORE_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from FormData; no static headers.
    expect(v.request.headers).toEqual({});
  });

  test("targets the core route and estimates 3 credits = $0.03", () => {
    const r = stableImageCore.safe({ prompt: "hi", style_preset: "pixel-art" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeCloseTo(0.03, 10);
      const request = (r.params as { request: { url: string } }).request;
      expect(request.url).toBe(STABLE_IMAGE_CORE_URL);
    }
  });

  test("every documented style_preset passes", () => {
    for (const preset of STABILITY_STYLE_PRESETS) {
      const r = stableImageCore.safe({ prompt: "hi", style_preset: preset });
      expect(r.ok).toBe(true);
    }
  });

  test("an undocumented aspect_ratio is invalid_shape", () => {
    const r = safeCoreUnchecked({ prompt: "hi", aspect_ratio: "32:9" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["aspect_ratio"]);
  });

  test("core has no image field: it warns as unknown_param", () => {
    const r = safeCoreUnchecked({ prompt: "hi", image: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.warnings[0]?.path).toEqual(["image"]);
    }
  });
});

describe("stability.stableImageSd3", () => {
  test("targets the sd3 route; model rides in the multipart body", () => {
    const v = stableImageSd3({ prompt: "hi", model: "sd3.5-large-turbo" });
    expect(Object.keys(v)).toEqual(["prompt", "model"]);
    expect(v.request.url).toBe(STABLE_IMAGE_SD3_URL);
  });

  test("omitted model estimates the documented default (sd3.5-large, $0.065)", () => {
    const r = stableImageSd3.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.065, 10);
  });

  test("per-model credit pricing converts at 1 credit = $0.01", () => {
    const cases: Array<[string, number]> = [
      ["sd3.5-large", 0.065],
      ["sd3.5-large-turbo", 0.04],
      ["sd3.5-medium", 0.035],
      ["sd3.5-flash", 0.025],
    ];
    for (const [model, price] of cases) {
      const r = stableImageSd3.safe({ prompt: "hi", model });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(price, 10);
    }
  });

  test("deprecated sd3-* ids warn and price as their 3.5 equivalent", () => {
    expect(models["sd3-large"].status).toBe("deprecated");
    const r = stableImageSd3.safe({ prompt: "hi", model: "sd3-large" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
      expect(r.estimate.costUSD).toBeCloseTo(0.065, 10);
    }
  });

  test("an undocumented model is invalid_enum_value", () => {
    const r = stableImageSd3.safe({ prompt: "hi", model: "sd2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.meta?.allowed).toContain("sd3.5-flash");
    }
  });

  test("an off-catalog model warns unknown_model alongside the enum error", () => {
    const r = stableImageSd3.safe({ prompt: "hi", model: "sd2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.model).toBe("sd2");
    }
  });

  test("image-to-image requires image and strength", () => {
    const r = stableImageSd3.safe({ prompt: "hi", mode: "image-to-image" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["image", "strength"]);
    }
    const ok = stableImageSd3.safe({
      prompt: "hi",
      mode: "image-to-image",
      image: pngBlob,
      strength: 0.7,
    });
    expect(ok.ok).toBe(true);
  });

  test("aspect_ratio is rejected in image-to-image mode", () => {
    const r = stableImageSd3.safe({
      prompt: "hi",
      mode: "image-to-image",
      image: pngBlob,
      strength: 0.7,
      aspect_ratio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["aspect_ratio"]);
  });

  test("image/strength are rejected in (default) text-to-image mode", () => {
    const r = stableImageSd3.safe({ prompt: "hi", image: pngBlob, strength: 0.7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["image", "strength"]);
    }
  });

  test("cfg_scale outside 1–10 is invalid_shape", () => {
    const r = safeSd3Unchecked({ prompt: "hi", cfg_scale: 11 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["cfg_scale"]);
  });
});

describe("stability.toFormData", () => {
  test("appends the image Blob as a file part and stringifies scalars", () => {
    const v = stableImageSd3({
      prompt: "hi",
      mode: "image-to-image",
      image: pngBlob,
      strength: 0.7,
      model: "sd3.5-flash",
      seed: 42,
    });
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("hi");
    expect(form.get("mode")).toBe("image-to-image");
    expect(form.get("model")).toBe("sd3.5-flash");
    expect(form.get("strength")).toBe("0.7");
    expect(form.get("seed")).toBe("42");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  test("omits undefined fields", () => {
    const form = toFormData(stableImageCore({ prompt: "hi" }));
    expect([...form.keys()]).toEqual(["prompt"]);
  });
});
