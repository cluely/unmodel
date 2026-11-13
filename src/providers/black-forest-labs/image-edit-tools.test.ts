import { describe, expect, test } from "bun:test";
import {
  imageEditOutpainting,
  imageEditErase,
  imageEditDeblur,
  imageEditVto,
  FLUX_ERASE_URL,
  FLUX_DEBLUR_URL,
  FLUX_OUTPAINTING_URL,
  FLUX_OUTPAINTING_MAX_PIXELS,
  FLUX_OUTPAINTING_MODEL_ID,
} from "./image-edit-tools";
import { BFL_API_BASE_URL } from "./image";
import { FLUX_DEBLUR_RATE, FLUX_ERASE_RATE, outpaintingCostUSD } from "./pricing";
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

  test("the outpainting canvas is capped at 4 MP (docs: 422 above it)", () => {
    expect(FLUX_OUTPAINTING_MAX_PIXELS).toBe(4 * 1024 * 1024);
    // Exactly 4 MP, and the docs' own non-square example, pass.
    const atLimit = imageEditOutpainting.safe({ input_image: "x", width: 2048, height: 2048 });
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.estimate.costUSD).toBeCloseTo(0.4, 10);
    expect(imageEditOutpainting.safe({ input_image: "x", width: 1024, height: 4096 }).ok).toBe(true);

    for (const [width, height] of [[2048, 2049], [3000, 3000]] as const) {
      const r = imageEditOutpainting.safe({ input_image: "x", width, height });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_shape");
        expect(r.errors[0]?.path).toEqual(["width"]);
        expect(r.errors[0]?.meta?.value).toBe(width * height);
        expect(r.errors[0]?.meta?.source).toBe("https://docs.bfl.ml/flux_tools/flux_outpainting");
      }
    }
  });

  test("outpainting refuses seed and the webhook pair (closed schema declares none)", () => {
    for (const [param, value] of [
      ["seed", 7],
      ["webhook_url", "https://example.com/hook"],
      ["webhook_secret", "s3cret"],
    ] as const) {
      const r = safeOutpaint({ input_image: "x", width: 1024, height: 1024, [param]: value });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", [param]]]);
        expect(r.errors[0]?.meta?.source).toContain("FluxOutpaintingInputs");
      }
    }
    const deny = imageEditOutpainting.constraintsFor(FLUX_OUTPAINTING_MODEL_ID)[0]?.deny;
    expect(Object.keys(deny ?? {})).toEqual(["seed", "webhook_url", "webhook_secret"]);
    expect(deny?.webhook_url?.reason).toContain("polling_url");
  });

  test("erase, deblur and VTO keep seed and the webhook pair", () => {
    const extras = { seed: 7, webhook_url: "https://example.com/hook", webhook_secret: "s3cret" };
    for (const r of [
      imageEditErase.safe({ image: "a", mask: "b", ...extras }),
      imageEditDeblur.safe({ image: "x", ...extras }),
      imageEditVto.safe({ prompt: "p", person: "p", garment: "g", ...extras }),
    ]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
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

  test("the FLUX.2-backed tools take safety_tolerance 0–7", () => {
    expect(imageEditDeblur.safe({ image: "x", safety_tolerance: 7 }).ok).toBe(true);
    expect(imageEditVto.safe({ prompt: "p", person: "p", garment: "g", safety_tolerance: 7 }).ok)
      .toBe(true);
    const over = imageEditDeblur.safe({ image: "x", safety_tolerance: 8 });
    expect(over.ok).toBe(false);
  });

  test("every tool takes the optional user field", () => {
    const r = imageEditErase.safe({ image: "a", mask: "b", user: "end-user-42" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    expect(safeErase({ image: "a", mask: "b", user: "" }).ok).toBe(false);
  });

  test("outpainting is priced exactly from its canvas and mode", () => {
    const cases: Array<[number, number, "high" | "fast" | undefined, number]> = [
      [1024, 1024, undefined, 0.1], // 1 MP at the default [high]
      [2048, 2048, "high", 0.4], // 4 MP
      [1025, 1024, "high", 0.2], // rounds up to 2 MP
      [1920, 1080, "fast", 0.051], // 1.98 MP → 2 MP: $0.045 + $0.006
    ];
    for (const [width, height, mode, price] of cases) {
      const r = imageEditOutpainting.safe({
        input_image: "x",
        width,
        height,
        ...(mode !== undefined && { mode }),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(price, 10);
    }
    expect(outpaintingCostUSD({ width: 2048, height: 2048 })).toBeCloseTo(0.4, 10);
  });

  test("erase, deblur and VTO bill on sizes the request does not carry: no estimate", () => {
    for (const r of [
      imageEditDeblur.safe({ image: "x" }),
      imageEditErase.safe({ image: "a", mask: "b" }),
      imageEditVto.safe({ prompt: "p", person: "p", garment: "g" }),
    ]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
    expect(FLUX_ERASE_RATE.firstMp).toBe(0.03);
    expect(FLUX_DEBLUR_RATE.referenceMp).toBe(0.004);
  });
});
