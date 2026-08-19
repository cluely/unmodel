import { describe, expect, test } from "bun:test";
import {
  image,
  IMAGE_GENERATIONS_URL,
  DEFAULT_IMAGE_MODEL_ID,
} from "./image";
import { GENERATIONS_URL } from "./generations";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("luma.image happy path", () => {
  test("returns a wire-pure body with the /generations/image URL", () => {
    const v = image({
      model: "photon-1",
      prompt: "A tiny robot tending a bonsai tree",
      aspect_ratio: "1:1",
      format: "png",
    });
    expect(Object.keys(v)).toEqual(["model", "prompt", "aspect_ratio", "format"]);
    expect(v.request.url).toBe(IMAGE_GENERATIONS_URL);
    expect(v.request.url).toBe(`${GENERATIONS_URL}/image`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    expect(v.toSdk("luma")).toEqual({
      model: "photon-1",
      prompt: "A tiny robot tending a bonsai tree",
      aspect_ratio: "1:1",
      format: "png",
    });
  });

  test("model may be omitted (documented default photon-1) without warnings", () => {
    expect(DEFAULT_IMAGE_MODEL_ID).toBe("photon-1");
    const r = image.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("reference inputs pass with their documented shapes", () => {
    const r = image.safe({
      model: "photon-flash-1",
      prompt: "match this style",
      image_ref: [{ url: "https://example.com/a.jpg", weight: 0.85 }],
      style_ref: [{ url: "https://example.com/style.jpg", weight: 0.8 }],
      character_ref: { identity0: { images: ["https://example.com/face.jpg"] } },
      modify_image_ref: { url: "https://example.com/base.jpg", weight: 1 },
      sync: true,
      sync_timeout: 60,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns but validates", () => {
    const r = image.safe({ model: "photon-2", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("a ray video model on the image route warns as unknown_model", () => {
    const r = image.safe({ model: "ray-2", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("luma.image shape", () => {
  test("a format outside jpg/png is invalid_shape", () => {
    const r = safeUnchecked({ prompt: "hi", format: "webp" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("video-only params are unknown here and warn", () => {
    const r = safeUnchecked({ prompt: "hi", loop: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["loop"]);
    }
  });

  test("no cost estimate is produced (no published USD pricing)", () => {
    const r = image.safe({ model: "photon-1", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("luma.image documented reference caps", () => {
  const REF = { url: "https://example.com/ref.jpg", weight: 0.85 };

  test("image_ref accepts up to 4 images", () => {
    expect(image.safe({ prompt: "x", image_ref: Array(4).fill(REF) }).ok).toBe(true);

    const r = image.safe({ prompt: "x", image_ref: Array(5).fill(REF) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["image_ref"]);
      expect(issue?.meta?.max).toBe(4);
      expect(String(issue?.meta?.source)).toContain("docs.lumalabs.ai");
    }
  });

  test("character_ref identity0 accepts up to 4 images of the same person", () => {
    const images = Array(4).fill("https://example.com/person.jpg");
    expect(
      image.safe({ prompt: "x", character_ref: { identity0: { images } } }).ok,
    ).toBe(true);

    const r = image.safe({
      prompt: "x",
      character_ref: { identity0: { images: [...images, "https://example.com/p5.jpg"] } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_shape")?.path).toEqual([
        "character_ref",
        "identity0",
        "images",
      ]);
    }
  });

  test("style_ref has no documented cap and stays permissive", () => {
    expect(image.safe({ prompt: "x", style_ref: Array(9).fill(REF) }).ok).toBe(true);
  });
});
