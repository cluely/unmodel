import { describe, expect, test } from "bun:test";
import {
  imageEditErase,
  imageEditInpaint,
  imageEditOutpaint,
  imageEditSearchAndReplace,
  imageEditSearchAndRecolor,
  imageEditRemoveBackground,
  STABLE_IMAGE_ERASE_URL,
  STABLE_IMAGE_INPAINT_URL,
  STABLE_IMAGE_OUTPAINT_URL,
  STABLE_IMAGE_SEARCH_AND_REPLACE_URL,
  STABLE_IMAGE_SEARCH_AND_RECOLOR_URL,
  STABLE_IMAGE_REMOVE_BACKGROUND_URL,
} from "./image-edit";
import { toFormData } from "./image";
import { models } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const png = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("stability edit route URLs", () => {
  test("every edit route points at /v2beta/stable-image/edit/*", () => {
    expect(STABLE_IMAGE_ERASE_URL).toBe("https://api.stability.ai/v2beta/stable-image/edit/erase");
    expect(STABLE_IMAGE_INPAINT_URL).toBe(
      "https://api.stability.ai/v2beta/stable-image/edit/inpaint",
    );
    expect(STABLE_IMAGE_OUTPAINT_URL).toBe(
      "https://api.stability.ai/v2beta/stable-image/edit/outpaint",
    );
    expect(STABLE_IMAGE_SEARCH_AND_REPLACE_URL).toBe(
      "https://api.stability.ai/v2beta/stable-image/edit/search-and-replace",
    );
    expect(STABLE_IMAGE_SEARCH_AND_RECOLOR_URL).toBe(
      "https://api.stability.ai/v2beta/stable-image/edit/search-and-recolor",
    );
    expect(STABLE_IMAGE_REMOVE_BACKGROUND_URL).toBe(
      "https://api.stability.ai/v2beta/stable-image/edit/remove-background",
    );
  });
});

describe("stability edit catalog ids", () => {
  // None of the six routes has a `model` wire field: each pins its catalog id
  // in the validator, so unknown_model can only ever fire if one of those ids
  // stops resolving. This pins that — the warning is unreachable by design.
  test("every route's fixed catalog id resolves, so unknown_model never fires", () => {
    const routes: Array<[string, ValidateResult<unknown>]> = [
      ["stable-image-erase", imageEditErase.safe({ image: png() })],
      ["stable-image-inpaint", imageEditInpaint.safe({ image: png(), prompt: "x" })],
      ["stable-image-outpaint", imageEditOutpaint.safe({ image: png(), left: 100 })],
      [
        "stable-image-search-and-replace",
        imageEditSearchAndReplace.safe({ image: png(), prompt: "a", search_prompt: "b" }),
      ],
      [
        "stable-image-search-and-recolor",
        imageEditSearchAndRecolor.safe({ image: png(), prompt: "a", select_prompt: "b" }),
      ],
      ["stable-image-remove-background", imageEditRemoveBackground.safe({ image: png() })],
    ];
    for (const [id, r] of routes) {
      expect(Object.hasOwn(models, id)).toBe(true);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });
});

describe("stability.imageEditInpaint", () => {
  test("returns multipart-ready fields with an empty header map", () => {
    const image = png();
    const v = imageEditInpaint({ image, prompt: "a golden retriever" });
    expect(Object.keys(v)).toEqual(["image", "prompt"]);
    expect(v.request.url).toBe(STABLE_IMAGE_INPAINT_URL);
    expect(v.request.headers).toEqual({});
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("a golden retriever");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  test("grow_mask goes to 100 on inpaint (the rest of the family caps at 20)", () => {
    expect(imageEditInpaint.safe({ image: png(), prompt: "x", grow_mask: 100 }).ok).toBe(true);
    const over = (imageEditInpaint.safe as unknown as Unchecked)({
      image: png(),
      prompt: "x",
      grow_mask: 101,
    });
    expect(over.ok).toBe(false);
  });

  test("prompt is required", () => {
    const r = (imageEditInpaint.safe as unknown as Unchecked)({ image: png() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });

  test("costs 5 credits ($0.05)", () => {
    const r = imageEditInpaint.safe({ image: png(), prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05, 10);
  });
});

describe("stability.imageEditErase", () => {
  test("returns multipart-ready fields with an empty header map", () => {
    const v = imageEditErase({ image: png(), mask: png(), grow_mask: 10 });
    expect(Object.keys(v)).toEqual(["image", "mask", "grow_mask"]);
    expect(v.request.url).toBe(STABLE_IMAGE_ERASE_URL);
    expect(v.request.headers).toEqual({});
  });

  test("needs only an image and caps grow_mask at 20", () => {
    expect(imageEditErase.safe({ image: png() }).ok).toBe(true);
    expect(imageEditErase.safe({ image: png(), grow_mask: 20 }).ok).toBe(true);
    const over = (imageEditErase.safe as unknown as Unchecked)({ image: png(), grow_mask: 21 });
    expect(over.ok).toBe(false);
  });

  test("a non-Blob image is an invalid_shape error", () => {
    const r = (imageEditErase.safe as unknown as Unchecked)({ image: "./cat.png" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("stability.imageEditOutpaint", () => {
  test("returns multipart-ready fields with an empty header map", () => {
    const v = imageEditOutpaint({ image: png(), left: 200, creativity: 0.5 });
    expect(Object.keys(v)).toEqual(["image", "left", "creativity"]);
    expect(v.request.url).toBe(STABLE_IMAGE_OUTPAINT_URL);
    expect(v.request.headers).toEqual({});
  });

  test("requires at least one non-zero direction", () => {
    const none = (imageEditOutpaint.safe as unknown as Unchecked)({ image: png() });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]?.message).toContain("at least one outpainting direction");

    expect(imageEditOutpaint.safe({ image: png(), left: 200 }).ok).toBe(true);
  });

  test("each side is capped at 2000 px", () => {
    expect(imageEditOutpaint.safe({ image: png(), up: 2000 }).ok).toBe(true);
    const over = (imageEditOutpaint.safe as unknown as Unchecked)({ image: png(), up: 2001 });
    expect(over.ok).toBe(false);
  });

  test("costs 4 credits ($0.04)", () => {
    const r = imageEditOutpaint.safe({ image: png(), down: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.04, 10);
  });
});

describe("stability search-and-* routes", () => {
  test("each returns multipart-ready fields on its own route with empty headers", () => {
    const replace = imageEditSearchAndReplace({
      image: png(),
      prompt: "a dog",
      search_prompt: "cat",
    });
    expect(Object.keys(replace)).toEqual(["image", "prompt", "search_prompt"]);
    expect(replace.request.url).toBe(STABLE_IMAGE_SEARCH_AND_REPLACE_URL);
    expect(replace.request.headers).toEqual({});

    const recolor = imageEditSearchAndRecolor({
      image: png(),
      prompt: "blue",
      select_prompt: "car",
    });
    expect(Object.keys(recolor)).toEqual(["image", "prompt", "select_prompt"]);
    expect(recolor.request.url).toBe(STABLE_IMAGE_SEARCH_AND_RECOLOR_URL);
    expect(recolor.request.headers).toEqual({});
  });

  test("search-and-replace requires prompt + search_prompt", () => {
    const missing = (imageEditSearchAndReplace.safe as unknown as Unchecked)({
      image: png(),
      prompt: "a dog",
    });
    expect(missing.ok).toBe(false);
    expect(
      imageEditSearchAndReplace.safe({ image: png(), prompt: "a dog", search_prompt: "cat" }).ok,
    ).toBe(true);
  });

  test("search-and-recolor requires prompt + select_prompt", () => {
    const missing = (imageEditSearchAndRecolor.safe as unknown as Unchecked)({
      image: png(),
      prompt: "blue",
    });
    expect(missing.ok).toBe(false);
    expect(
      imageEditSearchAndRecolor.safe({ image: png(), prompt: "blue", select_prompt: "car" }).ok,
    ).toBe(true);
  });
});

describe("stability.imageEditRemoveBackground", () => {
  test("returns multipart-ready fields with an empty header map", () => {
    const v = imageEditRemoveBackground({ image: png(), output_format: "webp" });
    expect(Object.keys(v)).toEqual(["image", "output_format"]);
    expect(v.request.url).toBe(STABLE_IMAGE_REMOVE_BACKGROUND_URL);
    expect(v.request.headers).toEqual({});
  });

  test("output_format is png/webp only — jpeg cannot carry alpha", () => {
    expect(imageEditRemoveBackground.safe({ image: png(), output_format: "webp" }).ok).toBe(true);
    const jpeg = (imageEditRemoveBackground.safe as unknown as Unchecked)({
      image: png(),
      output_format: "jpeg",
    });
    expect(jpeg.ok).toBe(false);
    if (!jpeg.ok) expect(jpeg.errors[0]?.path).toEqual(["output_format"]);
  });

  test("costs 5 credits ($0.05)", () => {
    const r = imageEditRemoveBackground.safe({ image: png() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05, 10);
  });
});
