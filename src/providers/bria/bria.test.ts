import { describe, expect, test } from "bun:test";
import {
  image,
  imageLite,
  BRIA_IMAGE_GENERATE_URL,
  BRIA_IMAGE_GENERATE_LITE_URL,
} from "./image";
import { imageEdit, BRIA_IMAGE_EDIT_URL } from "./image-edit";
import { models } from "./models";
import {
  BRIA_ASPECT_RATIOS,
  BRIA_FIBO2_ASPECT_RATIOS,
  BRIA_LITE_ASPECT_RATIOS,
  BRIA_RESOLUTIONS,
  BRIA_OUTPUT_TYPES,
  BRIA_STYLES,
} from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (params: unknown, options?: ValidateOptions) => ValidateResult<
  Record<string, unknown>
>;
const generateUnchecked = image.safe as unknown as Unchecked;
const liteUnchecked = imageLite.safe as unknown as Unchecked;
const editUnchecked = imageEdit.safe as unknown as Unchecked;

const STRUCTURED_PROMPT = JSON.stringify({ short_description: "an owl at night" });

describe("bria.image", () => {
  test("validates and targets the v2 generate route", () => {
    const v = image({
      prompt: "a photorealistic rendering of balloon lettering on a white backdrop",
      aspect_ratio: "16:9",
      resolution: "4MP",
      steps_num: 50,
    });
    expect(v.request.url).toBe(BRIA_IMAGE_GENERATE_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio", "resolution", "steps_num"]);
  });

  test("prices one image at the published Fibo rate", () => {
    const r = image.safe({ prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.032, 10);

    const lite = imageLite.safe({ prompt: "x" });
    expect(lite.ok).toBe(true);
    if (lite.ok) expect(lite.estimate.costUSD).toBeCloseTo(0.0288, 10);

    const budget = image.safe({ prompt: "x" }, { maxCostUSD: 0.02 });
    expect(budget.ok).toBe(false);
    if (!budget.ok) expect(budget.errors[0]?.code).toBe("over_budget");
  });

  test("requires one of prompt / images / structured_prompt", () => {
    const r = generateUnchecked({ aspect_ratio: "1:1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("structured_prompt");

    expect(image.safe({ images: ["https://example.com/ref.jpg"] }).ok).toBe(true);
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

    const noSeed = image.safe({ structured_prompt: STRUCTURED_PROMPT });
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

  // These enums are CLOSED in the bundled OpenAPI, so their param types
  // dropped the `(string & {})` tail. Every arm they advertise must validate.
  test("every BriaAspectRatio preset validates on generate and edit", () => {
    // Keep in sync with BriaAspectRatio — the 21-value enum both Fibo 2 routes share.
    expect(BRIA_ASPECT_RATIOS).toHaveLength(21);
    for (const aspect_ratio of BRIA_ASPECT_RATIOS) {
      const full = image.safe({ prompt: "x", aspect_ratio });
      expect(full.ok, `generate should accept ${aspect_ratio}`).toBe(true);
      if (full.ok) expect(full.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);

      const edited = imageEdit.safe({
        images: ["https://example.com/p.png", "https://example.com/q.png"],
        instruction: "x",
        aspect_ratio,
      });
      expect(edited.ok, `edit should accept ${aspect_ratio}`).toBe(true);
      if (edited.ok) expect(edited.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("every BriaLiteAspectRatio preset validates on generate/lite", () => {
    // Keep in sync with BriaLiteAspectRatio — the lite route's nine-value enum.
    expect(BRIA_LITE_ASPECT_RATIOS).toHaveLength(9);
    for (const aspect_ratio of BRIA_LITE_ASPECT_RATIOS) {
      const lite = imageLite.safe({ prompt: "x", aspect_ratio });
      expect(lite.ok, `generate/lite should accept ${aspect_ratio}`).toBe(true);
      if (lite.ok) expect(lite.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("every BriaStyle preset validates with a text prompt", () => {
    // Keep in sync with BriaStyle
    for (const style of BRIA_STYLES) {
      const r = image.safe({ prompt: "a woman reading on a city bus", style, seed: 5555 });
      expect(r.ok, `style ${style} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${style} should be warning-free`).toEqual([]);
    }
    const unknown = generateUnchecked({ prompt: "x", style: "vintage" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("style refuses structured_prompt, images and 4MP", () => {
    for (const params of [
      { structured_prompt: STRUCTURED_PROMPT, seed: 1, style: "kodak_film" },
      { prompt: "x", images: ["https://example.com/ref.jpg"], style: "hard_flash" },
      { prompt: "x", resolution: "4MP", style: "hazy_dreamy" },
    ]) {
      const r = generateUnchecked(params);
      expect(r.ok, JSON.stringify(params)).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => e.path[0])).toEqual(["style"]);
        expect(r.errors[0]?.message).toContain("422");
      }
    }
  });

  test("4MP is async-only", () => {
    const r = generateUnchecked({ prompt: "x", resolution: "4MP", sync: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["sync"]);
      expect(r.errors[0]?.message).toContain("asynchronous");
    }

    expect(image.safe({ prompt: "x", resolution: "4MP", sync: false }).ok).toBe(true);
    expect(image.safe({ prompt: "x", resolution: "1MP", sync: true }).ok).toBe(true);
  });

  test("the twelve Fibo 2 ratios refuse 4MP, prompt+structured_prompt and prompt-less images", () => {
    expect(BRIA_FIBO2_ASPECT_RATIOS).toHaveLength(12);
    for (const params of [
      { prompt: "x", aspect_ratio: "21:9", resolution: "4MP" },
      { prompt: "x", structured_prompt: STRUCTURED_PROMPT, seed: 1, aspect_ratio: "2:1" },
      { images: ["https://example.com/ref.jpg"], aspect_ratio: "1:5" },
    ]) {
      const r = generateUnchecked(params);
      expect(r.ok, JSON.stringify(params)).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => e.path[0])).toEqual(["aspect_ratio"]);
        expect(r.errors[0]?.message).toContain("only Fibo 2 renders");
      }
    }

    // The same requests on one of the original nine ratios, and the Fibo 2
    // ratios on the requests Fibo 2 serves, all validate.
    expect(image.safe({ prompt: "x", aspect_ratio: "16:9", resolution: "4MP" }).ok).toBe(true);
    expect(
      image.safe({ images: ["https://example.com/ref.jpg"], prompt: "x", aspect_ratio: "21:9" }).ok,
    ).toBe(true);
    expect(image.safe({ structured_prompt: STRUCTURED_PROMPT, seed: 1, aspect_ratio: "9:21" }).ok)
      .toBe(true);
  });

  test("every BriaResolution preset validates", () => {
    // Keep in sync with BriaResolution
    for (const resolution of BRIA_RESOLUTIONS) {
      const r = image.safe({ prompt: "x", resolution });
      expect(r.ok, `resolution ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${resolution} should be warning-free`).toEqual([]);
    }
  });

  test("every BriaOutputType preset validates on every v2 route", () => {
    // Keep in sync with BriaOutputType — it lives on BriaCommonParams, so it is
    // shared by generate, generate/lite and edit.
    for (const output_type of BRIA_OUTPUT_TYPES) {
      const full = image.safe({ prompt: "x", output_type });
      expect(full.ok, `generate should accept ${output_type}`).toBe(true);
      if (full.ok) expect(full.warnings, `${output_type} should be warning-free`).toEqual([]);

      const lite = imageLite.safe({ prompt: "x", output_type });
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
    expect(generateUnchecked({ prompt: "x", aspect_ratio: "7:3" }).ok).toBe(false);
    expect(image.safe({ prompt: "x", aspect_ratio: "21:9" }).ok).toBe(true);
    expect(generateUnchecked({ prompt: "x", resolution: "2MP" }).ok).toBe(false);
    expect(generateUnchecked({ prompt: "x", output_type: "webp" }).ok).toBe(false);
    expect(generateUnchecked({ prompt: "x", steps_num: 20 }).ok).toBe(false);
    expect(image.safe({ prompt: "x", steps_num: 35 }).ok).toBe(true);

    const version = generateUnchecked({ prompt: "x", model_version: "FIBO-edit" });
    expect(version.ok).toBe(false);
    if (!version.ok) expect(version.errors[0]?.path).toEqual(["model_version"]);

    const webhook = generateUnchecked({ prompt: "x", webhook_url: "example.com/hook" });
    expect(webhook.ok).toBe(false);
  });
});

describe("bria.imageLite", () => {
  test("targets the lite route", () => {
    const v = imageLite({ prompt: "a ring on a marble table", aspect_ratio: "4:5" });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio"]);
    expect(v.request.url).toBe(BRIA_IMAGE_GENERATE_LITE_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("rejects the full route's extra knobs", () => {
    for (const params of [
      { prompt: "x", resolution: "4MP" },
      { prompt: "x", style: "kodak_film" },
      { prompt: "x", negative_prompt: "blurry" },
      { prompt: "x", steps_num: 40 },
    ]) {
      const r = liteUnchecked(params);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
    }
  });

  test("takes nine ratios; the twelve Fibo 2 ratios are refused by name", () => {
    const r = liteUnchecked({ prompt: "x", aspect_ratio: "21:9" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.message).toContain("POST /v2/image/generate only");
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
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.032, 10);
  });

  test("images is required and holds 1 to 4 items", () => {
    const missing = editUnchecked({ instruction: "x" });
    expect(missing.ok).toBe(false);

    const empty = editUnchecked({ images: [], instruction: "x" });
    expect(empty.ok).toBe(false);

    // The spec's own multi_reference_3_images example, shortened.
    const three = imageEdit.safe({
      images: [
        "https://labs-assets.bria.ai/sandbox-example-inputs/fibo2_edit_still_rock.jpg",
        "https://labs-assets.bria.ai/sandbox-example-inputs/fibo2_edit_still_bottle.jpg",
        "https://labs-assets.bria.ai/sandbox-example-inputs/fibo2_edit_still_logo.jpg",
      ],
      instruction: "luxury fragrance poster",
    });
    expect(three.ok).toBe(true);
    if (three.ok) expect(three.warnings).toEqual([]);
    expect(imageEdit.safe({ images: ["a", "b", "c", "d"], instruction: "x" }).ok).toBe(true);

    const five = editUnchecked({ images: ["a", "b", "c", "d", "e"], instruction: "x" });
    expect(five.ok).toBe(false);
    if (!five.ok) expect(five.errors[0]?.message).toContain("1 to 4 images");
  });

  test("a mask needs a single-image request", () => {
    expect(imageEdit.safe({ images: ["a"], mask: "m", instruction: "x" }).ok).toBe(true);
    const two = editUnchecked({ images: ["a", "b"], mask: "m", instruction: "x" });
    expect(two.ok).toBe(false);
    if (!two.ok) {
      expect(two.errors[0]?.path).toEqual(["mask"]);
      expect(two.errors[0]?.message).toContain("exactly one item");
    }
  });

  test("aspect_ratio is the 21-value enum", () => {
    const v = imageEdit({ images: ["a", "b"], instruction: "x", aspect_ratio: "21:9" });
    expect(v.aspect_ratio).toBe("21:9");
    const r = editUnchecked({ images: ["a"], instruction: "x", aspect_ratio: "7:3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
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
    expect(models.FIBO.name).toBe("Fibo 2");
    expect(models["FIBO-edit"].name).toBe("Fibo 2 Edit");
    expect(models.FIBO.cost.perImage).toBe(0.032);
    expect(models["FIBO-lite"].cost.perImage).toBe(0.0288);
    expect(models["FIBO-edit"].cost.perImage).toBe(0.032);
  });
});
