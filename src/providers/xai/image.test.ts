import { describe, expect, test } from "bun:test";
import {
  image,
  IMAGE_GENERATIONS_URL,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_QUALITIES,
  IMAGE_MAX_N,
} from "./image";
import { imageModels, IMAGE_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("xai.image wire shape", () => {
  test("the whole params object is the JSON body; the route is synchronous", () => {
    const v = image({
      model: "grok-imagine-image-2.0",
      prompt: "A collage of London landmarks in a stenciled street-art style",
      aspect_ratio: "16:9",
      resolution: "2k",
      response_format: "url",
    });
    expect(Object.keys(v)).toEqual([
      "model",
      "prompt",
      "aspect_ratio",
      "resolution",
      "response_format",
    ]);
    expect(v.request.url).toBe(IMAGE_GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test(".toSdk('openai') and .toSdk('xai') return the body unchanged", () => {
    const v = image({ model: "grok-imagine-image", prompt: "a red door" });
    expect(v.toSdk("openai")).toEqual({ model: "grok-imagine-image", prompt: "a red door" });
    expect(v.toSdk("xai")).toEqual({ model: "grok-imagine-image", prompt: "a red door" });
  });

  test("unknown params warn but pass through", () => {
    const r = safeUnchecked({
      model: "grok-imagine-image-2.0",
      prompt: "hi",
      style: "vivid",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("documented enums validate", () => {
    for (const aspect_ratio of IMAGE_ASPECT_RATIOS) {
      expect(
        image.safe({ model: "grok-imagine-image-2.0", prompt: "hi", aspect_ratio }).ok,
      ).toBe(true);
    }
    for (const resolution of IMAGE_RESOLUTIONS) {
      expect(
        image.safe({ model: "grok-imagine-image-2.0", prompt: "hi", resolution }).ok,
      ).toBe(true);
    }
    const badRatio = safeUnchecked({
      model: "grok-imagine-image-2.0",
      prompt: "hi",
      aspect_ratio: "7:5",
    });
    expect(badRatio.ok).toBe(false);
    const badResolution = safeUnchecked({
      model: "grok-imagine-image-2.0",
      prompt: "hi",
      resolution: "4k",
    });
    expect(badResolution.ok).toBe(false);
  });

  test("2.0's quality and 1.5k tier are typed wire fields", () => {
    // "* `resolution` ("1k" | "2k" | "1.5k")" — REST reference; "Allowed values
    // are `low`, `medium`, and `auto`." — images/generation guide.
    expect(IMAGE_RESOLUTIONS).toContain("1.5k");
    for (const quality of IMAGE_QUALITIES) {
      const r = image.safe({
        model: "grok-imagine-image-2.0",
        prompt: "hi",
        resolution: "1.5k",
        quality,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    const high = safeUnchecked({ model: "grok-imagine-image-2.0", prompt: "hi", quality: "high" });
    expect(high.ok).toBe(false);
  });
});

describe("xai.image model gate", () => {
  test("every catalogued image model is in the enum", () => {
    expect([...IMAGE_MODEL_IDS].sort()).toEqual(Object.keys(imageModels).sort());
  });

  test("the retired grok-imagine-image-quality slug still validates, with a deprecated_model warning", () => {
    const r = image.safe({ model: "grok-imagine-image-quality", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("the documented alias validates and prices as grok-imagine-image", () => {
    // "- **Aliases:** `grok-imagine-image-2026-03-02`" — models/grok-imagine-image.
    const r = image.safe({ model: "grok-imagine-image-2026-03-02", prompt: "hi", n: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.04, 10);
    }
  });

  test("a video id is invalid_enum_value here, with unknown_model alongside", () => {
    const r = image.safe({ model: "grok-imagine-video-1.5", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    }
  });

  test("an omitted model is legal on the wire: checks are skipped, no estimate", () => {
    const r = image.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeUndefined();
    }
  });
});

describe("xai.image n bounds", () => {
  test("1 through 10 pass; 0 and 11 fail", () => {
    expect(image.safe({ model: "grok-imagine-image-2.0", prompt: "hi", n: 1 }).ok).toBe(true);
    expect(
      image.safe({ model: "grok-imagine-image-2.0", prompt: "hi", n: IMAGE_MAX_N }).ok,
    ).toBe(true);
    const zero = image.safe({ model: "grok-imagine-image-2.0", prompt: "hi", n: 0 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors[0]?.path).toEqual(["n"]);
    const eleven = image.safe({
      model: "grok-imagine-image-2.0",
      prompt: "hi",
      n: IMAGE_MAX_N + 1,
    });
    expect(eleven.ok).toBe(false);
  });
});

describe("xai.image pricing", () => {
  test("default-request rates: the models page, and 2.0's low rate for the retired slug", () => {
    expect(imageModels["grok-imagine-image"].cost?.perImage).toBe(0.02);
    expect(imageModels["grok-imagine-image-2.0"].cost?.perImage).toBe(0.04);
    // "It reflects the `grok-imagine-image-2.0` low price: $0.04 per 1K image
    // and $0.06 per 2K image" — imagine-image-quality-nov-2 migration guide.
    expect(imageModels["grok-imagine-image-quality"].cost?.perImage).toBe(0.04);
  });

  test("the estimate is n × the model's rate", () => {
    const one = image.safe({ model: "grok-imagine-image-2.0", prompt: "hi" });
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.estimate.costUSD).toBeCloseTo(0.04, 10);

    const three = image.safe({ model: "grok-imagine-image-quality", prompt: "hi", n: 3 });
    expect(three.ok).toBe(true);
    if (three.ok) expect(three.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("grok-imagine-image-2.0 prices by resolution and quality", () => {
    function cost(params: Parameters<typeof image.safe>[0]): number | undefined {
      const r = image.safe(params);
      return r.ok ? r.estimate.costUSD : undefined;
    }
    const base = { model: "grok-imagine-image-2.0", prompt: "hi" } as const;
    // "1K · Low | $0.04", "1.5K · Low | $0.05", "2K · Low | $0.06".
    expect(cost({ ...base, resolution: "1.5k" })).toBeCloseTo(0.05, 10);
    expect(cost({ ...base, resolution: "2k", quality: "low" })).toBeCloseTo(0.06, 10);
    // `auto` (the default) "currently uses `low` for image generation".
    expect(cost({ ...base, resolution: "2k", quality: "auto" })).toBeCloseTo(0.06, 10);
    // "1K · Medium | $0.06", "1.5K · Medium | $0.07", "2K · Medium | $0.08".
    expect(cost({ ...base, quality: "medium" })).toBeCloseTo(0.06, 10);
    expect(cost({ ...base, resolution: "1.5k", quality: "medium" })).toBeCloseTo(0.07, 10);
    expect(cost({ ...base, resolution: "2k", quality: "medium", n: 2 })).toBeCloseTo(0.16, 10);
  });

  test("a resolution with no published rate prices nothing", () => {
    // grok-imagine-image's table has "1K" and "2K" rows only.
    const r = image.safe({ model: "grok-imagine-image", prompt: "hi", resolution: "1.5k" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    const twoK = image.safe({ model: "grok-imagine-image", prompt: "hi", resolution: "2k" });
    if (twoK.ok) expect(twoK.estimate.costUSD).toBeCloseTo(0.02, 10);
  });

  test("maxCostUSD turns an expensive batch into over_budget", () => {
    const r = image.safe(
      { model: "grok-imagine-image-quality", prompt: "hi", n: 10 },
      { maxCostUSD: 0.25 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = image as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "grok-imagine-image-2.0", prompt: "hi", n: 99 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
