import { describe, expect, test } from "bun:test";
import { videoReframe, REFRAME_VIDEO_URL } from "./video-reframe";
import { reframeImage, REFRAME_IMAGE_URL } from "./reframe-image";
import { LUMA_VIDEO_DIMENSIONS, LUMA_IMAGE_DIMENSIONS } from "./pricing";
import { LUMA_ASPECT_RATIOS } from "./video";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeVideoUnchecked = videoReframe.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const safeImageUnchecked = reframeImage.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VIDEO = { url: "https://example.com/video.mp4" };
const IMAGE = { url: "https://example.com/image.jpg" };

describe("luma.videoReframe", () => {
  test("returns a wire-pure body with URL and method", () => {
    const v = videoReframe({
      model: "ray-2",
      media: VIDEO,
      aspect_ratio: "21:9",
      prompt: "extend the alley walls",
    });
    expect(Object.keys(v)).toEqual(["model", "media", "aspect_ratio", "prompt"]);
    expect(v.request.url).toBe(REFRAME_VIDEO_URL);
    expect(v.request.method).toBe("POST");
  });

  test("media and aspect_ratio are required", () => {
    expect(safeVideoUnchecked({ model: "ray-2", aspect_ratio: "16:9" }).ok).toBe(false);
    expect(safeVideoUnchecked({ model: "ray-2", media: VIDEO }).ok).toBe(false);
  });

  test("aspect_ratio is the documented closed enum", () => {
    for (const ratio of LUMA_ASPECT_RATIOS) {
      expect(videoReframe.safe({ model: "ray-2", media: VIDEO, aspect_ratio: ratio }).ok).toBe(true);
    }
    const r = safeVideoUnchecked({ model: "ray-2", media: VIDEO, aspect_ratio: "5:4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("geometry fields pass through as integers", () => {
    const v = videoReframe({
      model: "ray-flash-2",
      media: VIDEO,
      aspect_ratio: "16:9",
      grid_position_x: 10,
      grid_position_y: 20,
      x_start: 0,
      x_end: 1280,
      y_start: 0,
      y_end: 720,
      resized_width: 1280,
      resized_height: 720,
    });
    expect(v.resized_width).toBe(1280);

    const fractional = safeVideoUnchecked({
      model: "ray-2",
      media: VIDEO,
      aspect_ratio: "16:9",
      x_start: 1.5,
    });
    expect(fractional.ok).toBe(false);
  });

  test("a photon model on the video route warns as unknown_model", () => {
    const r = videoReframe.safe({ model: "photon-1", media: VIDEO, aspect_ratio: "16:9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("luma.reframeImage", () => {
  test("returns a wire-pure body with URL and method", () => {
    const v = reframeImage({
      model: "photon-1",
      media: IMAGE,
      aspect_ratio: "16:9",
      format: "png",
    });
    expect(Object.keys(v)).toEqual(["model", "media", "aspect_ratio", "format"]);
    expect(v.request.url).toBe(REFRAME_IMAGE_URL);
  });

  test("format is jpg or png", () => {
    const r = safeImageUnchecked({
      model: "photon-1",
      media: IMAGE,
      aspect_ratio: "16:9",
      format: "webp",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("a ray model on the image route warns as unknown_model", () => {
    const r = reframeImage.safe({ model: "ray-2", media: IMAGE, aspect_ratio: "16:9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("the image route has no first_frame", () => {
    const r = safeImageUnchecked({
      model: "photon-1",
      media: IMAGE,
      aspect_ratio: "16:9",
      first_frame: IMAGE,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["first_frame"]);
    }
  });
});

describe("luma documented dimension maps", () => {
  test("every aspect ratio has a video and an image size", () => {
    for (const ratio of LUMA_ASPECT_RATIOS) {
      expect(LUMA_VIDEO_DIMENSIONS[ratio]).toBeDefined();
      expect(LUMA_IMAGE_DIMENSIONS[ratio]).toBeDefined();
    }
  });

  test("16:9 maps to Ray 720p and Photon 2048x1152", () => {
    expect(LUMA_VIDEO_DIMENSIONS["16:9"]).toEqual([1280, 720]);
    expect(LUMA_IMAGE_DIMENSIONS["16:9"]).toEqual([2048, 1152]);
  });
});
