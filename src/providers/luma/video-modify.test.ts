import { describe, expect, test } from "bun:test";
import { videoModify, MODIFY_VIDEO_URL, LUMA_MODIFY_MODES } from "./video-modify";
import { modifyVideoCostUSD, MODIFY_VIDEO_USD_PER_MEGAPIXEL, LUMA_VIDEO_FPS } from "./pricing";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = videoModify.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VIDEO = { url: "https://example.com/video.mp4" };
const FRAME = { url: "https://example.com/frame.png" };

describe("luma.videoModify happy path", () => {
  test("returns a wire-pure body with URL and method", () => {
    const v = videoModify({
      model: "ray-2",
      media: VIDEO,
      first_frame: FRAME,
      mode: "flex_1",
      prompt: "turn the street into a rainy neon alley",
    });

    expect(Object.keys(v)).toEqual(["model", "media", "first_frame", "mode", "prompt"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      model: "ray-2",
      media: VIDEO,
      first_frame: FRAME,
      mode: "flex_1",
      prompt: "turn the street into a rainy neon alley",
    });
    expect(v.request.url).toBe(MODIFY_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("the documented example body validates", () => {
    // https://docs.lumalabs.ai/docs/modify-video
    const v = videoModify({
      prompt: "you can direct how to modify the video by providing a text prompt here",
      media: { url: "https://example.com/video.mp4" },
      first_frame: { url: "https://example.com/image.png" },
      mode: "flex_1",
      model: "ray-2",
    });
    expect(v.toSdk("luma")).toBeDefined();
  });

  test("an image model on the video route warns as unknown_model", () => {
    const r = videoModify.safe({ model: "photon-1", media: VIDEO, mode: "flex_1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("luma.videoModify required fields and enums", () => {
  test("media is required", () => {
    const r = safeUnchecked({ model: "ray-2", mode: "flex_1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("media.url is required", () => {
    const r = safeUnchecked({ model: "ray-2", media: {}, mode: "flex_1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("every documented mode is accepted", () => {
    for (const mode of LUMA_MODIFY_MODES) {
      expect(videoModify.safe({ model: "ray-2", media: VIDEO, mode }).ok).toBe(true);
    }
    expect(LUMA_MODIFY_MODES).toHaveLength(9);
  });

  test("an undocumented mode is invalid_enum_value", () => {
    const r = videoModify.safe({ model: "ray-2", media: VIDEO, mode: "reimagine_4" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["mode"]);
      expect(issue?.model).toBe("ray-2");
    }
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = videoModify as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "ray-2", media: VIDEO, mode: "nope" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("luma.videoModify published input limits", () => {
  test("constraintsFor exposes the per-model duration and size ceilings", () => {
    const ray2 = videoModify.constraintsFor("ray-2")[0]?.media?.video;
    expect(ray2?.maxDurationSeconds).toBe(10);
    expect(ray2?.maxBytes).toBe(100_000_000);

    const flash = videoModify.constraintsFor("ray-flash-2")[0]?.media?.video;
    expect(flash?.maxDurationSeconds).toBe(15);
  });
});

describe("luma modify-video pricing", () => {
  test("reproduces the documented worked examples", () => {
    // "ray-2, 720p, 5s, 16:9 → $1.75"
    expect(modifyVideoCostUSD({ model: "ray-2", aspectRatio: "16:9", seconds: 5 })).toBeCloseTo(
      1.75,
      2,
    );
    // "ray-flash-2, 720p, 5s, 16:9 → $0.60"
    expect(
      modifyVideoCostUSD({ model: "ray-flash-2", aspectRatio: "16:9", seconds: 5 }),
    ).toBeCloseTo(0.6, 2);
  });

  test("explicit dimensions bypass the aspect-ratio map", () => {
    const usd = modifyVideoCostUSD({ model: "ray-2", width: 1280, height: 720, seconds: 5 });
    expect(usd).toBeCloseTo(1.75, 2);
  });

  test("the published rates and implied fps are exported", () => {
    expect(MODIFY_VIDEO_USD_PER_MEGAPIXEL["ray-2"]).toBe(0.01582);
    expect(MODIFY_VIDEO_USD_PER_MEGAPIXEL["ray-flash-2"]).toBe(0.00544);
    expect(LUMA_VIDEO_FPS).toBe(24);
  });

  test("undefined for models with no published rate or unresolvable dimensions", () => {
    expect(modifyVideoCostUSD({ model: "photon-1", aspectRatio: "16:9", seconds: 5 })).toBeUndefined();
    expect(modifyVideoCostUSD({ model: "ray-2", seconds: 5 })).toBeUndefined();
    expect(modifyVideoCostUSD({ model: "ray-2", aspectRatio: "16:9", seconds: 0 })).toBeUndefined();
  });

  test("the endpoint itself produces no estimate — no dimensions on the wire", () => {
    const r = videoModify.safe({ model: "ray-2", media: VIDEO, mode: "flex_1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
