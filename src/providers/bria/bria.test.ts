import { describe, expect, test } from "bun:test";
import {
  imageGenerate,
  imageGenerateLite,
  BRIA_IMAGE_GENERATE_URL,
  BRIA_IMAGE_GENERATE_LITE_URL,
} from "./generate";
import { imageEdit, BRIA_IMAGE_EDIT_URL } from "./edit";
import { models } from "./models";
import { BRIA_ASPECT_RATIOS, BRIA_RESOLUTIONS, BRIA_OUTPUT_TYPES } from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (params: unknown, options?: ValidateOptions) => ValidateResult<
  Record<string, unknown>
>;
const generateUnchecked = imageGenerate.safe as unknown as Unchecked;
const liteUnchecked = imageGenerateLite.safe as unknown as Unchecked;
const editUnchecked = imageEdit.safe as unknown as Unchecked;

const STRUCTURED_PROMPT = JSON.stringify({ short_description: "an owl at night" });

describe("bria.imageGenerate", () => {
  test("validates and targets the v2 generate route", () => {
    const v = imageGenerate({
      prompt: "a photorealistic rendering of balloon lettering on a white backdrop",
      aspect_ratio: "16:9",
      resolution: "4MP",
      steps_num: 50,
    });
    expect(v.request.url).toBe(BRIA_IMAGE_GENERATE_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio", "resolution", "steps_num"]);
  });

  test("prices one image at the published FIBO rate", () => {
    const r = imageGenerate.safe({ prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.03, 10);

    const lite = imageGenerateLite.safe({ prompt: "x" });
    expect(lite.ok).toBe(true);
    if (lite.ok) expect(lite.estimate.costUSD).toBeCloseTo(0.02, 10);

    const budget = imageGenerate.safe({ prompt: "x" }, { maxCostUSD: 0.02 });
    expect(budget.ok).toBe(false);
    if (!budget.ok) expect(budget.errors[0]?.code).toBe("over_budget");
  });

  test("requires one of prompt / images / structured_prompt", () => {
    const r = generateUnchecked({ aspect_ratio: "1:1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("structured_prompt");

    expect(imageGenerate.safe({ images: ["https://example.com/ref.jpg"] }).ok).toBe(true);
  });

  test("images + structured_prompt is not a documented combination", () => {
    const r = generateUnchecked({
      images: ["https://example.com/ref.jpg"],
      structured_prompt: STRUCTURED_PROMPT,
      seed: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("mutually exclusive");
  });

  test("structured_prompt must be a JSON string, and pairs with a seed", () => {
    const asObject = generateUnchecked({ structured_prompt: { short_description: "x" }, seed: 7 });
    expect(asObject.ok).toBe(false);
    if (!asObject.ok) expect(asObject.errors[0]?.message).toContain("STRING");

    const notJson = generateUnchecked({ structured_prompt: "an owl at night", seed: 7 });
    expect(notJson.ok).toBe(false);

    const noSeed = imageGenerate.safe({ structured_prompt: STRUCTURED_PROMPT });
    expect(noSeed.ok).toBe(true);
    if (noSeed.ok) expect(noSeed.warnings.some((w) => w.path[0] === "seed")).toBe(true);
  });

  test("images accepts exactly one entry", () => {
    const r = generateUnchecked({
      prompt: "x",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["images"]);
  });

  test("an off-catalog model_version warns unknown_model alongside the enum error", () => {
    // model_version is the catalog handle: anything but "FIBO" replaces the
    // route's fixed id, so an undocumented value misses the catalog too.
    const r = generateUnchecked({ prompt: "a", model_version: "NOPE" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.model).toBe("NOPE");
    }
  });

  // These three enums are CLOSED in the bundled OpenAPI, so their param types
  // dropped the `(string & {})` tail. Every arm they advertise must validate.
  test("every BriaAspectRatio preset validates on both generate routes", () => {
    // Keep in sync with BriaAspectRatio
    for (const aspect_ratio of BRIA_ASPECT_RATIOS) {
      const full = imageGenerate.safe({ prompt: "x", aspect_ratio });
      expect(full.ok, `generate should accept ${aspect_ratio}`).toBe(true);
      if (full.ok) expect(full.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);

      const lite = imageGenerateLite.safe({ prompt: "x", aspect_ratio });
      expect(lite.ok, `generate/lite should accept ${aspect_ratio}`).toBe(true);
      if (lite.ok) expect(lite.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("every BriaResolution preset validates", () => {
    // Keep in sync with BriaResolution
    for (const resolution of BRIA_RESOLUTIONS) {
      const r = imageGenerate.safe({ prompt: "x", resolution });
      expect(r.ok, `resolution ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${resolution} should be warning-free`).toEqual([]);
    }
  });

  test("every BriaOutputType preset validates on every v2 route", () => {
    // Keep in sync with BriaOutputType — it lives on BriaCommonParams, so it is
    // shared by generate, generate/lite and edit.
    for (const output_type of BRIA_OUTPUT_TYPES) {
      const full = imageGenerate.safe({ prompt: "x", output_type });
      expect(full.ok, `generate should accept ${output_type}`).toBe(true);
      if (full.ok) expect(full.warnings, `${output_type} should be warning-free`).toEqual([]);

      const lite = imageGenerateLite.safe({ prompt: "x", output_type });
      expect(lite.ok, `generate/lite should accept ${output_type}`).toBe(true);
      if (lite.ok) expect(lite.warnings, `${output_type} should be warning-free`).toEqual([]);

      const edited = imageEdit.safe({
        images: ["https://example.com/p.png"],
        instruction: "x",
        output_type,
      });
      expect(edited.ok, `edit should accept ${output_type}`).toBe(true);
      if (edited.ok) expect(edited.warnings, `${output_type} should be warning-free`).toEqual([]);
    }
  });

  test("enums and ranges are enforced", () => {
    expect(generateUnchecked({ prompt: "x", aspect_ratio: "21:9" }).ok).toBe(false);
    expect(generateUnchecked({ prompt: "x", resolution: "2MP" }).ok).toBe(false);
    expect(generateUnchecked({ prompt: "x", output_type: "webp" }).ok).toBe(false);
    expect(generateUnchecked({ prompt: "x", steps_num: 20 }).ok).toBe(false);
    expect(imageGenerate.safe({ prompt: "x", steps_num: 35 }).ok).toBe(true);

    const version = generateUnchecked({ prompt: "x", model_version: "FIBO-edit" });
    expect(version.ok).toBe(false);
    if (!version.ok) expect(version.errors[0]?.path).toEqual(["model_version"]);

    const webhook = generateUnchecked({ prompt: "x", webhook_url: "example.com/hook" });
    expect(webhook.ok).toBe(false);
  });
});

describe("bria.imageGenerateLite", () => {
  test("targets the lite route", () => {
    const v = imageGenerateLite({ prompt: "a ring on a marble table", aspect_ratio: "4:5" });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio"]);
    expect(v.request.url).toBe(BRIA_IMAGE_GENERATE_LITE_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("rejects the full route's extra knobs", () => {
    for (const params of [
      { prompt: "x", resolution: "4MP" },
      { prompt: "x", negative_prompt: "blurry" },
      { prompt: "x", steps_num: 40 },
    ]) {
      const r = liteUnchecked(params);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
    }
  });
});

describe("bria.imageEdit", () => {
  test("validates and targets the edit route", () => {
    const v = imageEdit({
      images: ["https://example.com/product.png"],
      instruction: "make the background a warm terracotta wall",
      guidance_scale: 5,
      steps_num: 30,
    });
    expect(Object.keys(v)).toEqual(["images", "instruction", "guidance_scale", "steps_num"]);
    expect(v.request.url).toBe(BRIA_IMAGE_EDIT_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    const r = imageEdit.safe({ images: ["https://example.com/p.png"], instruction: "x" });
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.03, 10);
  });

  test("images is required and must hold exactly one item", () => {
    const missing = editUnchecked({ instruction: "x" });
    expect(missing.ok).toBe(false);

    const two = editUnchecked({ images: ["a", "b"], instruction: "x" });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0]?.message).toContain("exactly one item");
  });

  test("the edit route's step range is wider than the generate route's", () => {
    expect(imageEdit.safe({ images: ["url"], instruction: "x", steps_num: 20 }).ok).toBe(true);
    const tooMany = editUnchecked({ images: ["url"], instruction: "x", steps_num: 51 });
    expect(tooMany.ok).toBe(false);
  });

  test("guidance_scale is bounded at 3–5", () => {
    expect(editUnchecked({ images: ["url"], instruction: "x", guidance_scale: 7 }).ok).toBe(false);
    expect(imageEdit.safe({ images: ["url"], instruction: "x", guidance_scale: 3 }).ok).toBe(true);
  });

  test("an edit with no instruction warns", () => {
    const r = imageEdit.safe({ images: ["https://example.com/p.png"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.path[0] === "instruction")).toBe(true);
  });

  test("the generate model_version is rejected here", () => {
    const r = editUnchecked({ images: ["url"], instruction: "x", model_version: "FIBO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model_version"]);
  });
});

describe("bria catalog", () => {
  test("holds the three documented FIBO routes with published prices", () => {
    expect(Object.keys(models)).toEqual(["FIBO", "FIBO-lite", "FIBO-edit"]);
    expect(models.FIBO.cost.perImage).toBe(0.03);
    expect(models["FIBO-lite"].cost.perImage).toBe(0.02);
    expect(models["FIBO-edit"].cost.perImage).toBe(0.03);
  });
});
