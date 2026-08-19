import { describe, expect, test } from "bun:test";
import { imageGenerations, IMAGE_GENERATIONS_URL } from "./image-generations";
import { omniImage, OMNI_IMAGE_URL } from "./omni-image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = imageGenerations.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("kling.imageGenerations", () => {
  test("wire-pure body with URL and method", () => {
    const v = imageGenerations({
      model_name: "kling-v2-1",
      prompt: "a lighthouse at dusk, painterly",
      aspect_ratio: "16:9",
      resolution: "2k",
      n: 2,
    });
    expect(Object.keys(v)).toEqual(["model_name", "prompt", "aspect_ratio", "resolution", "n"]);
    expect(v.request.url).toBe(IMAGE_GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("video model ids warn as unknown on the image route", () => {
    const r = imageGenerations.safe({ model_name: "kling-v2-6", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("fidelity params are bounded to 0..1", () => {
    const r = safeUnchecked({ model_name: "kling-v2-1", prompt: "hi", image_fidelity: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["image_fidelity"]);
  });

  test("resolution is a closed enum on this route", () => {
    const r = safeUnchecked({ model_name: "kling-v2-1", prompt: "hi", resolution: "4k" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["resolution"]);
  });

  test("every KlingImageResolution preset validates", () => {
    // Keep in sync with KlingImageResolution in image-generations.ts — this
    // route has no 4K tier (that one is omni-image only).
    for (const resolution of ["1k", "2k"] as const) {
      const r = imageGenerations.safe({ model_name: "kling-v2-1", prompt: "hi", resolution });
      expect(r.ok, `preset ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${resolution}`).toEqual([]);
    }
  });

  test("cost follows the text-to-image / image-to-image column and n", () => {
    const t2i = imageGenerations.safe({ model_name: "kling-v2-1", prompt: "hi", n: 2 });
    expect(t2i.ok).toBe(true);
    if (t2i.ok) expect(t2i.estimate.costUSD).toBeCloseTo(0.028, 10); // $0.014 × 2

    const i2i = imageGenerations.safe({
      model_name: "kling-v2-1",
      prompt: "hi",
      image: "https://example.com/ref.png",
    });
    expect(i2i.ok).toBe(true);
    if (i2i.ok) expect(i2i.estimate.costUSD).toBeCloseTo(0.028, 10); // $0.028 × 1

    // Elements still bill as image-to-image here — the "Multi-image to Image"
    // column belongs to POST /v1/images/multi-image2image.
    const withElements = imageGenerations.safe({
      model_name: "kling-v2-1",
      prompt: "hi",
      element_list: [{ element_id: 1 }, { element_id: 2 }],
    });
    expect(withElements.ok).toBe(true);
    if (withElements.ok) expect(withElements.estimate.costUSD).toBeCloseTo(0.028, 10);
  });

  test("kling-v2-new has no published rate", () => {
    const r = imageGenerations.safe({ model_name: "kling-v2-new", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("kling.omniImage", () => {
  test("wire-pure body and the default model", () => {
    const v = omniImage({
      prompt: "the same character, four consistent poses",
      image_list: [{ image: "https://example.com/character.png" }],
      result_type: "series",
      series_amount: "4",
    });
    expect(v.request.url).toBe(OMNI_IMAGE_URL);
    expect(Object.keys(v)).toEqual(["prompt", "image_list", "result_type", "series_amount"]);
    // kling-image-o1 image-to-image at the default 1K: $0.028.
    const r = omniImage.safe({
      prompt: "hi",
      image_list: [{ image: "https://example.com/a.png" }],
    });
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.028, 10);
  });

  test("kling-v3-omni charges double at 4K", () => {
    const r = omniImage.safe({
      model_name: "kling-v3-omni",
      prompt: "hi",
      resolution: "4k",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.056, 10);
  });

  test("every KlingOmniImageResolution preset validates", () => {
    // Keep in sync with KlingOmniImageResolution in omni-image.ts — the omni
    // image route is the one with a 4K tier.
    for (const resolution of ["1k", "2k", "4k"] as const) {
      const r = omniImage.safe({ model_name: "kling-v3-omni", prompt: "hi", resolution });
      expect(r.ok, `preset ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${resolution}`).toEqual([]);
    }
  });

  test("series_amount is a closed set", () => {
    const r = omniImage.safe({ prompt: "hi", series_amount: 12 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["series_amount"]);
    }
    expect(omniImage.safe({ prompt: "hi", series_amount: "auto" }).ok).toBe(true);
  });

  test("aspect_ratio accepts auto here", () => {
    expect(omniImage.safe({ prompt: "hi", aspect_ratio: "auto" }).ok).toBe(true);
  });

  test("the /v1/images/generations ids are unknown on the omni route", () => {
    const r = omniImage.safe({ model_name: "kling-v2-1", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});
