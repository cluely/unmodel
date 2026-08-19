import { describe, expect, test } from "bun:test";
import { create, REVE_CREATE_URL } from "./create";
import { edit, remix, REVE_EDIT_URL, REVE_REMIX_URL } from "./edit";
import { createV2, REVE_V2_CREATE_URL, REVE_ASYNC_IMAGE_FORMATS } from "./v2-create";
import { models, resolveReveVersion } from "./models";
import {
  reveCreditsToUSD,
  REVE_MAX_IMAGE_DIMENSION,
  REVE_V1_ASPECT_RATIOS,
  REVE_V2_ASPECT_RATIOS,
} from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (params: unknown, options?: ValidateOptions) => ValidateResult<
  Record<string, unknown>
>;
const createUnchecked = create.safe as unknown as Unchecked;
const editUnchecked = edit.safe as unknown as Unchecked;
const remixUnchecked = remix.safe as unknown as Unchecked;
const createV2Unchecked = createV2.safe as unknown as Unchecked;

/** Minimal PNG (signature + IHDR) with the given dimensions, base64-encoded. */
function pngBase64(width: number, height: number, padBytes = 0): string {
  const bytes = new Uint8Array(24 + padBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("reve.create", () => {
  test("validates and targets the v1 create route", () => {
    const v = create({
      prompt: "A serene mountain landscape at sunset with snow-capped peaks",
      aspect_ratio: "16:9",
      version: "reve-create@20250915",
    });
    expect(v.request.url).toBe(REVE_CREATE_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio", "version"]);
  });

  test("every ReveV1AspectRatio preset validates on create", () => {
    // Keep in sync with ReveV1AspectRatio — the v1 space is CLOSED ("The v1
    // endpoints intentionally document and accept only the smaller legacy
    // subset"), so the param type has no `(string & {})` tail and every arm it
    // advertises has to clear checkAspectRatio.
    for (const aspect_ratio of REVE_V1_ASPECT_RATIOS) {
      const r = create.safe({ prompt: "x", aspect_ratio });
      expect(r.ok, `aspect_ratio ${aspect_ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("v1 rejects the v2-only aspect ratios", () => {
    const r = createUnchecked({ prompt: "x", aspect_ratio: "auto" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.message).toContain("v2");
    }
    expect(createUnchecked({ prompt: "x", aspect_ratio: "21:9" }).ok).toBe(false);
  });

  test("only the two documented create versions are accepted", () => {
    expect(createUnchecked({ prompt: "x", version: "latest" }).ok).toBe(true);
    const r = createUnchecked({ prompt: "x", version: "reve-edit@20250915" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["version"]);
  });

  test("the 2560-character prompt cap is enforced", () => {
    const r = createUnchecked({ prompt: "a".repeat(2561) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("2560");
  });

  test("prices 18 credits and scales with test_time_scaling", () => {
    const plain = create.safe({ prompt: "x" });
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(plain.estimate.costUSD).toBeCloseTo(0.024, 6);

    const scaled = create.safe({ prompt: "x", test_time_scaling: 3 });
    expect(scaled.ok).toBe(true);
    if (scaled.ok) expect(scaled.estimate.costUSD).toBeCloseTo(0.072, 6);
  });

  test("out-of-range test_time_scaling is a clamp warning, not an error", () => {
    const r = create.safe({ prompt: "x", test_time_scaling: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.message.includes("clamped"))).toBe(true);
  });

  test("postprocessing shapes are validated", () => {
    expect(
      create.safe({ prompt: "x", postprocessing: [{ process: "upscale", upscale_factor: 2 }] }).ok,
    ).toBe(true);

    const badFactor = createUnchecked({
      prompt: "x",
      postprocessing: [{ process: "upscale", upscale_factor: 5 }],
    });
    expect(badFactor.ok).toBe(false);
    if (!badFactor.ok) expect(badFactor.errors[0]?.path).toEqual(["postprocessing", 0, "upscale_factor"]);

    const emptyFit = createUnchecked({ prompt: "x", postprocessing: [{ process: "fit_image" }] });
    expect(emptyFit.ok).toBe(false);
    if (!emptyFit.ok) expect(emptyFit.errors[0]?.message).toContain("max_dim");

    const bigFit = createUnchecked({
      prompt: "x",
      postprocessing: [{ process: "fit_image", max_dim: 8192 }],
    });
    expect(bigFit.ok).toBe(false);

    const unknownProcess = createUnchecked({
      prompt: "x",
      postprocessing: [{ process: "sharpen" }],
    });
    expect(unknownProcess.ok).toBe(false);
    if (!unknownProcess.ok) expect(unknownProcess.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("reve.edit / reve.remix", () => {
  test("edit targets its route and prices the fast checkpoint separately", () => {
    const standard = edit.safe({ edit_instruction: "make the sky stormy", reference_image: pngBase64(64, 64) });
    expect(standard.ok).toBe(true);
    if (standard.ok) expect(standard.estimate.costUSD).toBeCloseTo(0.04, 6);

    const fast = edit({
      edit_instruction: "make the sky stormy",
      reference_image: pngBase64(64, 64),
      version: "latest-fast",
    });
    expect(Object.keys(fast)).toEqual(["edit_instruction", "reference_image", "version"]);
    expect(fast.request.url).toBe(REVE_EDIT_URL);
    expect(fast.request.headers).toEqual({ "content-type": "application/json" });
    const fastSafe = edit.safe({
      edit_instruction: "x",
      reference_image: pngBase64(64, 64),
      version: "latest-fast",
    });
    if (fastSafe.ok) expect(fastSafe.estimate.costUSD).toBeCloseTo(reveCreditsToUSD(5), 6);
  });

  test("every ReveV1AspectRatio preset validates on edit and remix", () => {
    // Keep in sync with ReveV1AspectRatio
    for (const aspect_ratio of REVE_V1_ASPECT_RATIOS) {
      const e = edit.safe({
        edit_instruction: "x",
        reference_image: pngBase64(64, 64),
        aspect_ratio,
      });
      expect(e.ok, `edit should accept ${aspect_ratio}`).toBe(true);
      if (e.ok) expect(e.warnings, `edit ${aspect_ratio} should be warning-free`).toEqual([]);

      const m = remix.safe({ prompt: "x", reference_images: [pngBase64(64, 64)], aspect_ratio });
      expect(m.ok, `remix should accept ${aspect_ratio}`).toBe(true);
      if (m.ok) expect(m.warnings, `remix ${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("edit rejects remix-only versions", () => {
    const r = editUnchecked({
      edit_instruction: "x",
      reference_image: pngBase64(8, 8),
      version: "reve-remix@20250915",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["version"]);
  });

  test("remix requires 1–6 reference images", () => {
    const none = remixUnchecked({ prompt: "x", reference_images: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]?.path).toEqual(["reference_images"]);

    const many = remixUnchecked({
      prompt: "x",
      reference_images: Array.from({ length: 7 }, () => pngBase64(8, 8)),
    });
    expect(many.ok).toBe(false);

    const ok = remix({ prompt: "x", reference_images: [pngBase64(8, 8)] });
    expect(Object.keys(ok)).toEqual(["prompt", "reference_images"]);
    expect(ok.request.url).toBe(REVE_REMIX_URL);
    expect(ok.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("an over-tall reference image is reported", () => {
    const r = editUnchecked({
      edit_instruction: "x",
      reference_image: pngBase64(1024, REVE_MAX_IMAGE_DIMENSION + 8),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "media_dimensions_exceeded")).toBe(true);
  });

  test("total request pixels are budgeted across reference images", () => {
    const r = remixUnchecked({
      prompt: "x",
      reference_images: [pngBase64(8000, 4000), pngBase64(8000, 4000)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("across all images"))).toBe(true);
    }
  });
});

describe("reve.createV2", () => {
  test("validates, targets the v2 route and prices 150 credits", () => {
    const v = createV2({
      prompt: "the bottle from <frame>0</frame> on a terracotta tile",
      references: [{ data: pngBase64(512, 512) }],
      aspect_ratio: "auto",
    });
    expect(Object.keys(v)).toEqual(["prompt", "references", "aspect_ratio"]);
    expect(v.request.url).toBe(REVE_V2_CREATE_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    const r = createV2.safe({ prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.2, 6);
  });

  test("every ReveV2AspectRatio preset validates", () => {
    // Keep in sync with ReveV2AspectRatio — the full unified-model set is
    // CLOSED (17 ratios + "auto"), so the param type dropped its
    // `(string & {})` tail.
    for (const aspect_ratio of REVE_V2_ASPECT_RATIOS) {
      const r = createV2.safe({ prompt: "x", aspect_ratio });
      expect(r.ok, `aspect_ratio ${aspect_ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("every ReveAsyncImageFormat preset validates", () => {
    // Keep in sync with ReveAsyncImageFormat
    for (const image_format of REVE_ASYNC_IMAGE_FORMATS) {
      const r = createV2.safe({ prompt: "x", async: { image_format } });
      expect(r.ok, `image_format ${image_format} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${image_format} should be warning-free`).toEqual([]);
    }
  });

  test("v2 accepts the wide ratios v1 rejects", () => {
    expect(createV2.safe({ prompt: "x", aspect_ratio: "21:9" }).ok).toBe(true);
    expect(createV2Unchecked({ prompt: "x", aspect_ratio: "5:1" }).ok).toBe(false);
  });

  test("references take exactly one of data or ref", () => {
    const both = createV2Unchecked({ prompt: "x", references: [{ data: "AAAAAAAA", ref: "id:1" }] });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.errors[0]?.message).toContain("exactly one");

    const neither = createV2Unchecked({ prompt: "x", references: [{}] });
    expect(neither.ok).toBe(false);

    expect(createV2.safe({ prompt: "x", references: [{ ref: "reference:@logo" }] }).ok).toBe(true);
  });

  test("the compound layout reference shape is rejected", () => {
    const r = createV2Unchecked({
      prompt: "x",
      references: [{ image: { data: "AAAAAAAA" }, layout: { regions: [] } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("layout endpoints");
  });

  test("async options are validated", () => {
    const badFormat = createV2Unchecked({
      prompt: "x",
      async: { image_format: "image/gif" },
    });
    expect(badFormat.ok).toBe(false);

    const publicJson = createV2Unchecked({
      prompt: "x",
      async: { image_format: "application/json", public: true },
    });
    expect(publicJson.ok).toBe(false);
    if (!publicJson.ok) expect(publicJson.errors[0]?.path).toEqual(["async", "public"]);

    const httpCallback = createV2Unchecked({
      prompt: "x",
      async: { callback_url: "http://example.com/hook" },
    });
    expect(httpCallback.ok).toBe(false);

    expect(
      createV2.safe({
        prompt: "x",
        async: { callback_url: "https://example.com/hook", image_format: "image/jpeg", public: true },
      }).ok,
    ).toBe(true);
  });

  test("the 4000-character v2 prompt cap is enforced", () => {
    expect(createV2.safe({ prompt: "a".repeat(4000) }).ok).toBe(true);
    expect(createV2Unchecked({ prompt: "a".repeat(4001) }).ok).toBe(false);
  });
});

describe("reve version resolution", () => {
  test("moving aliases resolve to the dated catalog rows", () => {
    expect(resolveReveVersion("create", undefined)).toBe("reve-create@20250915");
    expect(resolveReveVersion("create", "latest")).toBe("reve-create@20250915");
    expect(resolveReveVersion("edit", "latest-fast")).toBe("reve-edit-fast@20251030");
    expect(resolveReveVersion("remix", "latest")).toBe("reve-remix@20250915");
    expect(resolveReveVersion("v2-create", "latest")).toBe("reve-v2-create");
    // Unknown strings pass through so the pipeline reports unknown_model.
    expect(resolveReveVersion("create", "reve-create@20990101")).toBe("reve-create@20990101");
  });

  test("catalog prices follow the published credit rate", () => {
    expect(models["reve-create@20250915"].cost.perImage).toBeCloseTo(0.024, 6);
    expect(models["reve-edit@20250915"].cost.perImage).toBeCloseTo(0.04, 6);
    expect(models["reve-v2-create"].cost.perImage).toBeCloseTo(0.2, 6);
  });
});
