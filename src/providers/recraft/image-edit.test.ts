import { describe, expect, test } from "bun:test";
import {
  imageEdit,
  imageEditInpaint,
  imageEditOutpaint,
  imageEditReplaceBackground,
  imageEditGenerateBackground,
  toFormData,
  IMAGE_TO_IMAGE_URL,
  INPAINT_URL,
  OUTPAINT_URL,
  REPLACE_BACKGROUND_URL,
  GENERATE_BACKGROUND_URL,
  MAX_INPUT_IMAGE_BYTES,
} from "./image-edit";
import { ASPECT_RATIOS, V2_V3_SIZES, UNATTRIBUTED_SIZE_VALUES } from "./image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const png = (bytes = 3): Blob => new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("recraft editing route URLs", () => {
  test("all five routes live under /v1/images", () => {
    expect(IMAGE_TO_IMAGE_URL).toBe("https://external.api.recraft.ai/v1/images/imageToImage");
    expect(INPAINT_URL).toBe("https://external.api.recraft.ai/v1/images/inpaint");
    expect(OUTPAINT_URL).toBe("https://external.api.recraft.ai/v1/images/outpaint");
    expect(REPLACE_BACKGROUND_URL).toBe(
      "https://external.api.recraft.ai/v1/images/replaceBackground",
    );
    expect(GENERATE_BACKGROUND_URL).toBe(
      "https://external.api.recraft.ai/v1/images/generateBackground",
    );
  });
});

describe("recraft.imageEdit", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = imageEdit({ image: png(), prompt: "winter", strength: 0.2 });
    expect(Object.keys(v)).toEqual(["image", "prompt", "strength"]);
    expect(v.request.url).toBe(IMAGE_TO_IMAGE_URL);
    expect(v.request.headers).toEqual({});
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("winter");
    expect(form.get("strength")).toBe("0.2");
  });

  test("JSON form: image_url gets a JSON content-type", () => {
    const v = imageEdit({ image_url: "https://x/y.png", prompt: "winter", strength: 0.2 });
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("image and image_url are mutually exclusive, and one is required", () => {
    const both = (imageEdit.safe as unknown as Unchecked)({
      image: png(),
      image_url: "https://x/y.png",
      prompt: "w",
      strength: 0.2,
    });
    expect(both.ok).toBe(false);

    const neither = (imageEdit.safe as unknown as Unchecked)({ prompt: "w", strength: 0.2 });
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.errors[0]?.path).toEqual(["image"]);
  });

  test("strength is required and lies in [0, 1]", () => {
    const missing = (imageEdit.safe as unknown as Unchecked)({ image: png(), prompt: "w" });
    expect(missing.ok).toBe(false);
    const over = (imageEdit.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      strength: 1.5,
    });
    expect(over.ok).toBe(false);
  });

  test("V2 models are rejected (V3/V4 only)", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      strength: 0.2,
      model: "recraftv2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["model"]);
    }
    expect(
      imageEdit.safe({ image: png(), prompt: "w", strength: 0.2, model: "recraftv4_1_pro" }).ok,
    ).toBe(true);
  });

  test("the raster aliases validate and price like their base models", () => {
    const r = imageEdit.safe({
      image: png(),
      prompt: "w",
      strength: 0.2,
      model: "recraftv4_1_pro_raster",
      n: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.42, 10);
    }
    const v3 = imageEdit.safe({
      image: png(),
      prompt: "w",
      strength: 0.2,
      model: "recraftv3_raster",
      style: "Photorealism",
    });
    expect(v3.ok).toBe(true);
  });

  test("V4.1 Flash and the V4 Styles line are not image-to-image models", () => {
    for (const model of ["recraftv4_1_flash", "recraftv4_1_flash_raster", "recraftv4_styles"]) {
      const r = (imageEdit.safe as unknown as Unchecked)({
        image: png(),
        prompt: "w",
        strength: 0.2,
        model,
      });
      expect(r.ok, model).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["model"]);
    }
  });

  test("costs the model's per-image rate × n", () => {
    const r = imageEdit.safe({
      image: png(),
      prompt: "w",
      strength: 0.2,
      model: "recraftv3",
      n: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("inputs over 20 MB are media_too_large; a 15 MB input passes", () => {
    expect(MAX_INPUT_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    const r = (imageEdit.safe as unknown as Unchecked)({
      image: png(MAX_INPUT_IMAGE_BYTES + 1),
      prompt: "w",
      strength: 0.2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "media_too_large")).toBe(true);
    expect(imageEdit.safe({ image: png(15 * 1024 * 1024), prompt: "w", strength: 0.2 }).ok).toBe(true);
    expect(
      imageEditInpaint.safe({ image: png(), mask: png(15 * 1024 * 1024), prompt: "w" }).ok,
    ).toBe(true);
  });

  test("response_format takes url | b64_json | multipart on every route", () => {
    expect(imageEdit.safe({ image: png(), prompt: "w", strength: 0.2, response_format: "multipart" }).ok)
      .toBe(true);
    expect(imageEditReplaceBackground.safe({ image: png(), prompt: "w", response_format: "multipart" }).ok)
      .toBe(true);
    const r = (imageEditInpaint.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "w",
      response_format: "hex",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toEqual(["url", "b64_json", "multipart"]);
  });
});

describe("image_format and style_match on every editing route", () => {
  const routes = [
    ["imageEdit", imageEdit.safe as unknown as Unchecked, { image: png(), prompt: "w", strength: 0.2 }],
    ["imageEditInpaint", imageEditInpaint.safe as unknown as Unchecked, { image: png(), mask: png(), prompt: "w" }],
    ["imageEditOutpaint", imageEditOutpaint.safe as unknown as Unchecked, { image: png(), prompt: "w", zoom_out_percentage: 20 }],
    ["imageEditReplaceBackground", imageEditReplaceBackground.safe as unknown as Unchecked, { image: png(), prompt: "w" }],
    [
      "imageEditGenerateBackground",
      imageEditGenerateBackground.safe as unknown as Unchecked,
      { image: png(), mask: png(), prompt: "w" },
    ],
  ] as const;

  test.each(routes)("%s takes image_format webp | png, warning-free, and refuses jpeg", (_name, safe, base) => {
    for (const image_format of ["webp", "png"]) {
      const r = safe({ ...base, image_format });
      expect(r.ok, image_format).toBe(true);
      expect(r.warnings, image_format).toEqual([]);
    }
    const jpeg = safe({ ...base, image_format: "jpeg" });
    expect(jpeg.ok).toBe(false);
    if (!jpeg.ok) {
      expect(jpeg.errors.map((e) => `${e.code}@${e.path?.join(".")}`)).toEqual([
        "invalid_enum_value@image_format",
      ]);
      expect(jpeg.errors[0]?.meta?.allowed).toEqual(["webp", "png"]);
    }
  });

  test.each(routes)("%s takes style_match regular on V3, and refuses precise", (_name, safe, base) => {
    const regular = safe({ ...base, model: "recraftv3", style_id: "abc", style_match: "regular" });
    expect(regular.ok).toBe(true);
    expect(regular.warnings).toEqual([]);
    const precise = safe({ ...base, model: "recraftv3", style_id: "abc", style_match: "precise" });
    expect(precise.ok).toBe(false);
    if (!precise.ok) {
      expect(precise.errors.map((e) => `${e.code}@${e.path?.join(".")}`)).toEqual([
        "invalid_enum_value@style_match",
      ]);
    }
  });

  test("image_format is not refused on a vector model — the page says it is ignored there", () => {
    const r = imageEdit.safe({
      image: png(),
      prompt: "w",
      strength: 0.2,
      model: "recraftv4_1_vector",
      image_format: "png",
    });
    expect(r.ok).toBe(true);
  });
});

describe("recraft.imageEdit: the V3-only params refuse the V4 / V4.1 line", () => {
  const base = { image: png(), prompt: "w", strength: 0.2 };
  const codes = (r: ValidateResult<unknown>): string[] =>
    r.ok ? [] : r.errors.map((e) => `${e.code}@${e.path?.join(".")}`);

  test.each([
    ["style_id", { style_id: "abc" }],
    ["style", { style: "Photorealism" }],
    ["style_match", { style_id: "abc", style_match: "regular" }],
    ["negative_prompt", { negative_prompt: "people" }],
    ["text_layout", { text_layout: [{ text: "hi", bbox: [[0, 0], [1, 0], [1, 1], [0, 1]] }] }],
  ] as const)("recraftv4_1 + %s is unsupported_param", (param, extra) => {
    const r = (imageEdit.safe as unknown as Unchecked)({ ...base, model: "recraftv4_1", ...extra });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(`unsupported_param@${param}`);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path?.[0] === param);
      expect(issue?.meta?.source).toBe("https://www.recraft.ai/docs/api-reference/tools/image-to-image");
    }
  });

  test("a raster alias of the V4.1 line refuses negative_prompt too", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({
      ...base,
      model: "recraftv4_1_raster",
      negative_prompt: "people",
    });
    expect(codes(r)).toEqual(["unsupported_param@negative_prompt"]);
  });

  test("controls.artistic_level / no_text are V3-only; colors stay open", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({
      ...base,
      model: "recraftv4_1",
      controls: { artistic_level: 3, no_text: true },
    });
    expect(codes(r)).toEqual([
      "unsupported_param@controls.artistic_level",
      "unsupported_param@controls.no_text",
    ]);
    expect(
      imageEdit.safe({ ...base, model: "recraftv4_1", controls: { colors: [{ rgb: [255, 0, 0] }] } }).ok,
    ).toBe(true);
    expect(imageEdit.safe({ ...base, model: "recraftv3", controls: { artistic_level: 3 } }).ok).toBe(true);
  });

  test("every V3 id keeps the style vocabulary", () => {
    const raster = imageEdit.safe({ ...base, model: "recraftv3_raster", style_id: "abc", negative_prompt: "x" });
    expect(raster.ok).toBe(true);
    if (raster.ok) expect(raster.warnings).toEqual([]);
    expect(imageEdit.safe({ ...base, model: "recraftv3_vector", style: "Vector art", text_layout: [] }).ok).toBe(
      true,
    );
  });

  test("with no model, a curated V3 style resolves to the V3 model that lists it", () => {
    const raster = imageEdit.safe({ ...base, style: "Illustration", negative_prompt: "people" });
    expect(raster.ok).toBe(true);
    if (raster.ok) expect(raster.estimate.costUSD).toBeCloseTo(0.04, 10);
    const vector = imageEdit.safe({ ...base, style: "Vector art" });
    expect(vector.ok).toBe(true);
    if (vector.ok) expect(vector.estimate.costUSD).toBeCloseTo(0.08, 10);
    // …and without a style the default is recraftv4_1, which refuses the rest.
    const bare = (imageEdit.safe as unknown as Unchecked)({ ...base, negative_prompt: "people" });
    expect(codes(bare)).toEqual(["unsupported_param@negative_prompt"]);
  });

  test("an id the route refuses draws the model error alone", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({ ...base, model: "recraftv4_1_flash", style_id: "abc" });
    expect(codes(r)).toEqual(["invalid_enum_value@model"]);
  });
});

describe("recraft.imageEditInpaint / imageEditGenerateBackground", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = imageEditInpaint({ image: png(), mask: png(), prompt: "add a hat", n: 2 });
    expect(Object.keys(v)).toEqual(["image", "mask", "prompt", "n"]);
    expect(v.request.url).toBe(INPAINT_URL);
    expect(v.request.headers).toEqual({});
  });

  test("JSON form: the _url counterparts get a JSON content-type", () => {
    const v = imageEditInpaint({
      image_url: "https://x/a.png",
      mask_url: "https://x/m.png",
      prompt: "add a hat",
    });
    expect(Object.keys(v)).toEqual(["image_url", "mask_url", "prompt"]);
    expect(v.request.url).toBe(INPAINT_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("generateBackground carries the same body to its own route", () => {
    const blob = imageEditGenerateBackground({ image: png(), mask: png(), prompt: "a studio backdrop" });
    expect(Object.keys(blob)).toEqual(["image", "mask", "prompt"]);
    expect(blob.request.url).toBe(GENERATE_BACKGROUND_URL);
    expect(blob.request.headers).toEqual({});

    const json = imageEditGenerateBackground({
      image_url: "https://x/a.png",
      mask_url: "https://x/m.png",
      prompt: "a studio backdrop",
    });
    expect(json.request.headers["content-type"]).toBe("application/json");
  });

  test("an off-catalog model warns unknown_model alongside the enum error", () => {
    const r = (imageEditInpaint.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "w",
      model: "recraftv9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.model).toBe("recraftv9");
    }
  });

  test("mask (or mask_url) is required", () => {
    const missing = (imageEditInpaint.safe as unknown as Unchecked)({ image: png(), prompt: "winter" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["mask"]);

    expect(imageEditInpaint.safe({ image: png(), mask: png(), prompt: "winter" }).ok).toBe(true);
    expect(
      imageEditGenerateBackground.safe({ image_url: "https://x/a.png", mask_url: "https://x/m.png", prompt: "w" })
        .ok,
    ).toBe(true);
  });

  test("only recraftv3 / recraftv3_vector are accepted", () => {
    const r = (imageEditInpaint.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "w",
      model: "recraftv4_1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model"]);

    expect(imageEditInpaint.safe({ image: png(), mask: png(), prompt: "w", model: "recraftv3_vector" }).ok)
      .toBe(true);
  });

  test("recraftv3_raster is accepted on every V3-only route and prices at the V3 rate", () => {
    const inpaint = imageEditInpaint.safe({ image: png(), mask: png(), prompt: "w", model: "recraftv3_raster" });
    expect(inpaint.ok).toBe(true);
    if (inpaint.ok) {
      expect(inpaint.warnings).toEqual([]);
      expect(inpaint.estimate.costUSD).toBeCloseTo(0.04, 10);
    }
    expect(
      imageEditGenerateBackground.safe({ image: png(), mask: png(), prompt: "w", model: "recraftv3_raster" }).ok,
    ).toBe(true);
    expect(
      imageEditOutpaint.safe({ image: png(), prompt: "w", zoom_out_percentage: 20, model: "recraftv3_raster" }).ok,
    ).toBe(true);
    expect(imageEditReplaceBackground.safe({ image: png(), prompt: "w", model: "recraftv3_raster" }).ok).toBe(
      true,
    );
  });

  test("defaults to recraftv3, so the V3 prompt cap (1000) applies", () => {
    const r = (imageEditInpaint.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "x".repeat(1001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_output_limit")).toBe(true);
  });
});

describe("recraft.imageEditOutpaint", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = imageEditOutpaint({
      image: png(),
      prompt: "wider",
      expand_left: 100,
      zoom_out_percentage: 20,
    });
    expect(Object.keys(v)).toEqual(["image", "prompt", "expand_left", "zoom_out_percentage"]);
    expect(v.request.url).toBe(OUTPAINT_URL);
    expect(v.request.headers).toEqual({});
  });

  test("every RecraftSize preset this v3-only route can take validates", () => {
    // Keep in sync with RecraftSize (image.ts). Outpaint is
    // recraftv3 / recraftv3_vector only, so the meaningful arms are the 14
    // shared aspect ratios plus the V2/V3 WxH table and the unattributed
    // pass-through size. The route carries no per-VALUE size rule (only the
    // size ⇄ expand_* exclusivity in checkOutpaintGeometry), so this pins that
    // nothing the type advertises is rejected on the way through.
    for (const size of [...ASPECT_RATIOS, ...V2_V3_SIZES, ...UNATTRIBUTED_SIZE_VALUES]) {
      const r = imageEditOutpaint.safe({ image: png(), prompt: "wider", size });
      expect(r.ok, `outpaint should accept ${size}`).toBe(true);
      if (r.ok) expect(r.warnings, `${size} should be warning-free`).toEqual([]);
    }
  });

  test("expand_* and size cannot be combined", () => {
    const r = (imageEditOutpaint.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      expand_left: 100,
      size: "1024x1024",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["size"]);
  });

  test("at least one of size / expand_* / zoom_out_percentage is required", () => {
    const none = (imageEditOutpaint.safe as unknown as Unchecked)({ image: png(), prompt: "w" });
    expect(none.ok).toBe(false);
    expect(imageEditOutpaint.safe({ image: png(), prompt: "w", zoom_out_percentage: 20 }).ok).toBe(true);
  });

  test("expand_* is capped at 4096 and zoom_out_percentage is exclusive of 100", () => {
    expect(imageEditOutpaint.safe({ image: png(), prompt: "w", expand_top: 4096 }).ok).toBe(true);
    expect(
      (imageEditOutpaint.safe as unknown as Unchecked)({ image: png(), prompt: "w", expand_top: 4097 }).ok,
    ).toBe(false);
    expect(
      (imageEditOutpaint.safe as unknown as Unchecked)({ image: png(), prompt: "w", zoom_out_percentage: 100 })
        .ok,
    ).toBe(false);
  });
});

describe("recraft.imageEditReplaceBackground", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = imageEditReplaceBackground({ image: png(), prompt: "a beach", n: 2 });
    expect(Object.keys(v)).toEqual(["image", "prompt", "n"]);
    expect(v.request.url).toBe(REPLACE_BACKGROUND_URL);
    expect(v.request.headers).toEqual({});
  });

  test("JSON form: image_url gets a JSON content-type", () => {
    const v = imageEditReplaceBackground({ image_url: "https://x/a.png", prompt: "a beach" });
    expect(Object.keys(v)).toEqual(["image_url", "prompt"]);
    expect(v.request.url).toBe(REPLACE_BACKGROUND_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("validates and prices at the V3 raster rate", () => {
    const r = imageEditReplaceBackground.safe({ image: png(), prompt: "a beach" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.04, 10);
  });

  test("style and style_id cannot be combined", () => {
    const r = (imageEditReplaceBackground.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      style: "Photorealism",
      style_id: "abc",
    });
    expect(r.ok).toBe(false);
  });
});
