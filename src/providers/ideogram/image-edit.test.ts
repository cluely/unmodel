import { describe, expect, test } from "bun:test";
import {
  imageEdit,
  imageEditRemix,
  imageEditReframe,
  imageEditReplaceBackground,
  IDEOGRAM_V3_EDIT_URL,
  IDEOGRAM_V3_REMIX_URL,
  IDEOGRAM_V3_REFRAME_URL,
  IDEOGRAM_V3_REPLACE_BACKGROUND_URL,
} from "./image-edit";
import { toFormData } from "./image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const png = (bytes = 4): Blob => new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("ideogram v3 editing route URLs", () => {
  test("routes live under /v1/ideogram-v3", () => {
    expect(IDEOGRAM_V3_EDIT_URL).toBe("https://api.ideogram.ai/v1/ideogram-v3/edit");
    expect(IDEOGRAM_V3_REMIX_URL).toBe("https://api.ideogram.ai/v1/ideogram-v3/remix");
    expect(IDEOGRAM_V3_REFRAME_URL).toBe("https://api.ideogram.ai/v1/ideogram-v3/reframe");
    expect(IDEOGRAM_V3_REPLACE_BACKGROUND_URL).toBe(
      "https://api.ideogram.ai/v1/ideogram-v3/replace-background",
    );
  });
});

describe("ideogram.imageEdit", () => {
  test("image + mask + prompt validate into a multipart body", () => {
    const v = imageEdit({ image: png(), mask: png(), prompt: "add a hat" });
    expect(Object.keys(v)).toEqual(["image", "mask", "prompt"]);
    expect(v.request.url).toBe(IDEOGRAM_V3_EDIT_URL);
    expect(v.request.headers).toEqual({});
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("add a hat");
    // Single-file fields must be file parts, not JSON-stringified objects.
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("mask")).toBeInstanceOf(Blob);
  });

  test("mask is required", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({ image: png(), prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["mask"]);
  });

  test("style_codes conflict with style_type and style_reference_images", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "x",
      style_codes: ["1a2b3c4d"],
      style_type: "REALISTIC",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["style_codes"]);
  });

  test("character reference switches to the surcharge rate", () => {
    const r = imageEdit.safe({
      image: png(),
      mask: png(),
      prompt: "x",
      rendering_speed: "QUALITY",
      character_reference_images: [png()],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.2, 10);
  });

  test("more than one character reference is rejected", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({
      image: png(),
      mask: png(),
      prompt: "x",
      character_reference_images: [png(), png()],
    });
    expect(r.ok).toBe(false);
  });

  test("an image over 25MB is media_too_large", () => {
    const r = (imageEdit.safe as unknown as Unchecked)({
      image: png(25 * 1024 * 1024 + 1),
      mask: png(),
      prompt: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "media_too_large")).toBe(true);
  });
});

describe("ideogram.imageEditRemix", () => {
  test("resolution and aspect_ratio are mutually exclusive", () => {
    const r = (imageEditRemix.safe as unknown as Unchecked)({
      image: png(),
      prompt: "x",
      resolution: "1024x1024",
      aspect_ratio: "16x9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["aspect_ratio"]);
  });

  test("image_weight rides along and prices per num_images", () => {
    const v = imageEditRemix({ image: png(), prompt: "x", image_weight: 70, num_images: 2 });
    expect(Object.keys(v)).toEqual(["image", "prompt", "image_weight", "num_images"]);
    expect(v.request.url).toBe(IDEOGRAM_V3_REMIX_URL);
    expect(v.request.headers).toEqual({});

    const r = imageEditRemix.safe({ image: png(), prompt: "x", image_weight: 70, num_images: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("an unknown aspect_ratio is invalid_enum_value", () => {
    const r = (imageEditRemix.safe as unknown as Unchecked)({
      image: png(),
      prompt: "x",
      aspect_ratio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("ideogram.imageEditReframe", () => {
  test("resolution is required", () => {
    const missing = (imageEditReframe.safe as unknown as Unchecked)({ image: png() });
    expect(missing.ok).toBe(false);
    expect(imageEditReframe.safe({ image: png(), resolution: "1536x512" }).ok).toBe(true);
  });

  test("reframe prices at the rendering-speed rate", () => {
    const v = imageEditReframe({ image: png(), resolution: "1024x1024", rendering_speed: "TURBO" });
    expect(Object.keys(v)).toEqual(["image", "resolution", "rendering_speed"]);
    expect(v.request.url).toBe(IDEOGRAM_V3_REFRAME_URL);
    expect(v.request.headers).toEqual({});

    const r = imageEditReframe.safe({ image: png(), resolution: "1024x1024", rendering_speed: "TURBO" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.03, 10);
  });
});

describe("ideogram.imageEditReplaceBackground", () => {
  test("image + prompt validate", () => {
    const v = imageEditReplaceBackground({ image: png(), prompt: "a beach at sunset" });
    expect(Object.keys(v)).toEqual(["image", "prompt"]);
    expect(v.request.url).toBe(IDEOGRAM_V3_REPLACE_BACKGROUND_URL);
    expect(v.request.headers).toEqual({});
  });

  test("an unknown style_preset is invalid_enum_value", () => {
    const r = (imageEditReplaceBackground.safe as unknown as Unchecked)({
      image: png(),
      prompt: "x",
      style_preset: "NOT_A_PRESET",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["style_preset"]);
  });
});
