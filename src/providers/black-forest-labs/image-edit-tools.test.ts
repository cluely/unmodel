import { describe, expect, test } from "bun:test";
import {
  imageEditOutpainting,
  imageEditErase,
  imageEditDeblur,
  imageEditVto,
  FLUX_ERASE_URL,
  FLUX_DEBLUR_URL,
  FLUX_OUTPAINTING_URL,
} from "./image-edit-tools";
import { BFL_API_BASE_URL } from "./image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (params: unknown, options?: ValidateOptions) => ValidateResult<
  Record<string, unknown>
>;
const safeOutpaint = imageEditOutpainting.safe as unknown as Unchecked;
const safeErase = imageEditErase.safe as unknown as Unchecked;

describe("black-forest-labs FLUX tools routes", () => {
  test("the flux-tools/ path separator survives URL building", () => {
    expect(FLUX_ERASE_URL).toBe(`${BFL_API_BASE_URL}/v1/flux-tools/erase-v1`);
    expect(FLUX_DEBLUR_URL).toBe(`${BFL_API_BASE_URL}/v1/flux-tools/deblur-v1`);
    expect(FLUX_OUTPAINTING_URL).toBe(`${BFL_API_BASE_URL}/v1/flux-tools/outpainting-v1`);
  });

  test("outpainting needs a target canvas", () => {
    const v = imageEditOutpainting({ input_image: "https://x/y.png", width: 1920, height: 1080 });
    expect(Object.keys(v)).toEqual(["input_image", "width", "height"]);
    expect(v.request.url).toBe(FLUX_OUTPAINTING_URL);

    const missing = safeOutpaint({ input_image: "https://x/y.png" });
    expect(missing.ok).toBe(false);
  });

  test("outpainting canvas sides must be at least 64px", () => {
    const r = safeOutpaint({ input_image: "x", width: 32, height: 1080 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["width"]);
  });

  test("outpainting mode is high|fast", () => {
    expect(imageEditOutpainting.safe({ input_image: "x", width: 512, height: 512, mode: "fast" }).ok)
      .toBe(true);
    expect(safeOutpaint({ input_image: "x", width: 512, height: 512, mode: "turbo" }).ok).toBe(
      false,
    );
  });

  test("a reference offset past the canvas is rejected", () => {
    const r = safeOutpaint({
      input_image: "x",
      width: 512,
      height: 512,
      reference_offset_x: 900,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["reference_offset_x"]);
  });

  test("erase requires image + mask and caps dilate_pixels at 25", () => {
    const v = imageEditErase({ image: "a", mask: "b" });
    expect(Object.keys(v)).toEqual(["image", "mask"]);
    expect(v.request.url).toBe(FLUX_ERASE_URL);

    expect(imageEditErase.safe({ image: "a", mask: "b", dilate_pixels: 25 }).ok).toBe(true);
    expect(safeErase({ image: "a", mask: "b", dilate_pixels: 26 }).ok).toBe(false);
    expect(safeErase({ image: "a" }).ok).toBe(false);
  });

  test("deblur takes just an image", () => {
    const v = imageEditDeblur({ image: "https://x/y.png" });
    expect(Object.keys(v)).toEqual(["image"]);
    expect(v.request.url).toBe(FLUX_DEBLUR_URL);
  });

  test("VTO defaults to v2 and strips the route selector", () => {
    const v = imageEditVto({ prompt: "TRY-ON", person: "p", garment: "g" });
    expect(Object.keys(v)).toEqual(["prompt", "person", "garment"]);
    expect(v.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-tools/vto-v2`);

    const v1 = imageEditVto({ model: "flux-tools/vto-v1", prompt: "TRY-ON", person: "p", garment: "g" });
    expect(v1.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-tools/vto-v1`);
  });

  test("an unknown VTO route warns but validates", () => {
    const safeVto = imageEditVto.safe as unknown as Unchecked;
    const r = safeVto({ model: "flux-tools/vto-v9", prompt: "x", person: "p", garment: "g" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("the FLUX.2-backed tools cap safety_tolerance at 5", () => {
    expect(imageEditDeblur.safe({ image: "x", safety_tolerance: 5 }).ok).toBe(true);
    const over = imageEditDeblur.safe({ image: "x", safety_tolerance: 6 });
    expect(over.ok).toBe(false);
  });

  test("no tools route is priced, so none estimates a cost", () => {
    const r = imageEditDeblur.safe({ image: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
