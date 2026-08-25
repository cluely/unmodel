import { describe, expect, test } from "bun:test";
import {
  image,
  IMAGE_GENERATIONS_URL,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
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
});

describe("xai.image model gate", () => {
  test("every catalogued image model is in the enum", () => {
    expect([...IMAGE_MODEL_IDS].sort()).toEqual(Object.keys(imageModels).sort());
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
  test("flat per-image rates from the models page", () => {
    expect(imageModels["grok-imagine-image"].cost?.perImage).toBe(0.02);
    expect(imageModels["grok-imagine-image-2.0"].cost?.perImage).toBe(0.04);
    expect(imageModels["grok-imagine-image-quality"].cost?.perImage).toBe(0.05);
  });

  test("the estimate is n × the model's rate", () => {
    const one = image.safe({ model: "grok-imagine-image-2.0", prompt: "hi" });
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.estimate.costUSD).toBeCloseTo(0.04, 10);

    const three = image.safe({ model: "grok-imagine-image-quality", prompt: "hi", n: 3 });
    expect(three.ok).toBe(true);
    if (three.ok) expect(three.estimate.costUSD).toBeCloseTo(0.15, 10);
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
