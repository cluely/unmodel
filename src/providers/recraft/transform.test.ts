import { describe, expect, test } from "bun:test";
import {
  imageToImage,
  inpaint,
  outpaint,
  replaceBackground,
  generateBackground,
  toFormData,
  IMAGE_TO_IMAGE_URL,
  INPAINT_URL,
  OUTPAINT_URL,
  REPLACE_BACKGROUND_URL,
  GENERATE_BACKGROUND_URL,
  MAX_INPUT_IMAGE_BYTES,
} from "./transform";
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

describe("recraft.imageToImage", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = imageToImage({ image: png(), prompt: "winter", strength: 0.2 });
    expect(Object.keys(v)).toEqual(["image", "prompt", "strength"]);
    expect(v.request.url).toBe(IMAGE_TO_IMAGE_URL);
    expect(v.request.headers).toEqual({});
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("winter");
    expect(form.get("strength")).toBe("0.2");
  });

  test("JSON form: image_url gets a JSON content-type", () => {
    const v = imageToImage({ image_url: "https://x/y.png", prompt: "winter", strength: 0.2 });
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("image and image_url are mutually exclusive, and one is required", () => {
    const both = (imageToImage.safe as unknown as Unchecked)({
      image: png(),
      image_url: "https://x/y.png",
      prompt: "w",
      strength: 0.2,
    });
    expect(both.ok).toBe(false);

    const neither = (imageToImage.safe as unknown as Unchecked)({ prompt: "w", strength: 0.2 });
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.errors[0]?.path).toEqual(["image"]);
  });

  test("strength is required and lies in [0, 1]", () => {
    const missing = (imageToImage.safe as unknown as Unchecked)({ image: png(), prompt: "w" });
    expect(missing.ok).toBe(false);
    const over = (imageToImage.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      strength: 1.5,
    });
    expect(over.ok).toBe(false);
  });

  test("V2 models are rejected (V3/V4 only)", () => {
    const r = (imageToImage.safe as unknown as Unchecked)({
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
      imageToImage.safe({ image: png(), prompt: "w", strength: 0.2, model: "recraftv4_1_pro" }).ok,
    ).toBe(true);
  });

  test("costs the model's per-image rate × n", () => {
    const r = imageToImage.safe({
      image: png(),
      prompt: "w",
      strength: 0.2,
      model: "recraftv3",
      n: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("inputs over 10 MB are media_too_large", () => {
    const r = (imageToImage.safe as unknown as Unchecked)({
      image: png(MAX_INPUT_IMAGE_BYTES + 1),
      prompt: "w",
      strength: 0.2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "media_too_large")).toBe(true);
  });
});

describe("recraft.inpaint / generateBackground", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = inpaint({ image: png(), mask: png(), prompt: "add a hat", n: 2 });
    expect(Object.keys(v)).toEqual(["image", "mask", "prompt", "n"]);
    expect(v.request.url).toBe(INPAINT_URL);
    expect(v.request.headers).toEqual({});
  });

  test("JSON form: the _url counterparts get a JSON content-type", () => {
    const v = inpaint({
      image_url: "https://x/a.png",
      mask_url: "https://x/m.png",
      prompt: "add a hat",
    });
    expect(Object.keys(v)).toEqual(["image_url", "mask_url", "prompt"]);
    expect(v.request.url).toBe(INPAINT_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("generateBackground carries the same body to its own route", () => {
    const blob = generateBackground({ image: png(), mask: png(), prompt: "a studio backdrop" });
    expect(Object.keys(blob)).toEqual(["image", "mask", "prompt"]);
    expect(blob.request.url).toBe(GENERATE_BACKGROUND_URL);
    expect(blob.request.headers).toEqual({});

    const json = generateBackground({
      image_url: "https://x/a.png",
      mask_url: "https://x/m.png",
      prompt: "a studio backdrop",
    });
    expect(json.request.headers["content-type"]).toBe("application/json");
  });

  test("an off-catalog model warns unknown_model alongside the enum error", () => {
    const r = (inpaint.safe as unknown as Unchecked)({
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
    const missing = (inpaint.safe as unknown as Unchecked)({ image: png(), prompt: "winter" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["mask"]);

    expect(inpaint.safe({ image: png(), mask: png(), prompt: "winter" }).ok).toBe(true);
    expect(
      generateBackground.safe({ image_url: "https://x/a.png", mask_url: "https://x/m.png", prompt: "w" })
        .ok,
    ).toBe(true);
  });

  test("only recraftv3 / recraftv3_vector are accepted", () => {
    const r = (inpaint.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "w",
      model: "recraftv4_1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model"]);

    expect(inpaint.safe({ image: png(), mask: png(), prompt: "w", model: "recraftv3_vector" }).ok)
      .toBe(true);
  });

  test("defaults to recraftv3, so the V3 prompt cap (1000) applies", () => {
    const r = (inpaint.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "x".repeat(1001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_output_limit")).toBe(true);
  });
});

describe("recraft.outpaint", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = outpaint({
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
      const r = outpaint.safe({ image: png(), prompt: "wider", size });
      expect(r.ok, `outpaint should accept ${size}`).toBe(true);
      if (r.ok) expect(r.warnings, `${size} should be warning-free`).toEqual([]);
    }
  });

  test("expand_* and size cannot be combined", () => {
    const r = (outpaint.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      expand_left: 100,
      size: "1024x1024",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["size"]);
  });

  test("at least one of size / expand_* / zoom_out_percentage is required", () => {
    const none = (outpaint.safe as unknown as Unchecked)({ image: png(), prompt: "w" });
    expect(none.ok).toBe(false);
    expect(outpaint.safe({ image: png(), prompt: "w", zoom_out_percentage: 20 }).ok).toBe(true);
  });

  test("expand_* is capped at 4096 and zoom_out_percentage is exclusive of 100", () => {
    expect(outpaint.safe({ image: png(), prompt: "w", expand_top: 4096 }).ok).toBe(true);
    expect(
      (outpaint.safe as unknown as Unchecked)({ image: png(), prompt: "w", expand_top: 4097 }).ok,
    ).toBe(false);
    expect(
      (outpaint.safe as unknown as Unchecked)({ image: png(), prompt: "w", zoom_out_percentage: 100 })
        .ok,
    ).toBe(false);
  });
});

describe("recraft.replaceBackground", () => {
  test("multipart form: Blob input leaves the headers empty for the boundary", () => {
    const v = replaceBackground({ image: png(), prompt: "a beach", n: 2 });
    expect(Object.keys(v)).toEqual(["image", "prompt", "n"]);
    expect(v.request.url).toBe(REPLACE_BACKGROUND_URL);
    expect(v.request.headers).toEqual({});
  });

  test("JSON form: image_url gets a JSON content-type", () => {
    const v = replaceBackground({ image_url: "https://x/a.png", prompt: "a beach" });
    expect(Object.keys(v)).toEqual(["image_url", "prompt"]);
    expect(v.request.url).toBe(REPLACE_BACKGROUND_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("validates and prices at the V3 raster rate", () => {
    const r = replaceBackground.safe({ image: png(), prompt: "a beach" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.04, 10);
  });

  test("style and style_id cannot be combined", () => {
    const r = (replaceBackground.safe as unknown as Unchecked)({
      image: png(),
      prompt: "w",
      style: "Photorealism",
      style_id: "abc",
    });
    expect(r.ok).toBe(false);
  });
});
