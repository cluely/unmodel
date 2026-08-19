import { describe, expect, test } from "bun:test";
import {
  video,
  GENERATIONS_URL,
  LUMA_VIDEO_DURATIONS,
  LUMA_VIDEO_RESOLUTIONS,
  CONCEPTS_LIST_URL,
} from "./video";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("luma.video happy path", () => {
  test("returns a wire-pure body with URL, method and JSON headers", () => {
    const v = video({
      model: "ray-2",
      prompt: "A serene lake surrounded by mountains at sunset",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: "5s",
      loop: true,
    });
    expect(Object.keys(v)).toEqual([
      "model",
      "prompt",
      "aspect_ratio",
      "resolution",
      "duration",
      "loop",
    ]);
    expect(v.request.url).toBe(GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("toSdk returns the body unchanged in shape", () => {
    const v = video({
      model: "ray-flash-2",
      prompt: "hi",
      keyframes: { frame0: { type: "image", url: "https://example.com/a.jpg" } },
    });
    expect(v.toSdk("luma")).toEqual({
      model: "ray-flash-2",
      prompt: "hi",
      keyframes: { frame0: { type: "image", url: "https://example.com/a.jpg" } },
    });
  });

  test("image-to-video and extend keyframe shapes pass", () => {
    const r = video.safe({
      model: "ray-2",
      prompt: "continue the shot",
      keyframes: {
        frame0: { type: "generation", id: "123e4567-e89b-12d3-a456-426614174000" },
        frame1: { type: "image", url: "https://example.com/end.jpg" },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("every LumaVideoDuration × LumaVideoResolution preset passes cleanly", () => {
    // Keep in sync with LumaVideoDuration and LumaVideoResolution in
    // video.ts — every named preset of both unions must clear
    // checkDuration / checkResolution, or the autocomplete would advertise
    // values the runtime reports as invalid_enum_value. "ray-2" is in this
    // route's catalog and every documented duration × resolution pair is legal
    // on it, so the whole cross product is looped.
    for (const duration of LUMA_VIDEO_DURATIONS) {
      for (const resolution of LUMA_VIDEO_RESOLUTIONS) {
        const r = video.safe({ model: "ray-2", prompt: "hi", duration, resolution });
        expect(r.ok, `preset ${duration} @ ${resolution} should validate`).toBe(true);
        if (r.ok) {
          expect(r.warnings, `preset ${duration} @ ${resolution} should be warning-free`).toEqual(
            [],
          );
        }
      }
    }
  });

  test("unknown model warns but validates", () => {
    const r = video.safe({ model: "ray-3", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("a photon image model on the video route warns as unknown_model", () => {
    const r = video.safe({ model: "photon-1", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ model: "ray-2", prompt: "hi", enhance: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["enhance"]);
    }
  });
});

describe("luma.video enums and shape", () => {
  test("an undocumented duration is invalid_enum_value with source", () => {
    const r = video.safe({ model: "ray-2", prompt: "hi", duration: "7s" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["duration"]);
      expect(issue?.meta?.allowed).toEqual([...LUMA_VIDEO_DURATIONS]);
      expect(String(issue?.meta?.source)).toContain("docs.lumalabs.ai");
    }
  });

  test("an undocumented resolution is invalid_enum_value", () => {
    const r = video.safe({ model: "ray-2", prompt: "hi", resolution: "2160p" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual(["resolution"]);
    }
  });

  test("invalid_enum_value can be demoted to a warning", () => {
    const r = video.safe(
      { model: "ray-2", prompt: "hi", duration: "10s" },
      { severity: { invalid_enum_value: "warning" } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["invalid_enum_value"]);
  });

  test("an aspect_ratio outside the documented set is invalid_shape", () => {
    const r = safeUnchecked({ model: "ray-2", prompt: "hi", aspect_ratio: "2:1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("a malformed keyframe is invalid_shape", () => {
    const r = safeUnchecked({
      model: "ray-2",
      keyframes: { frame0: { type: "image" } }, // missing url
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("missing model is invalid_shape and the throwing form throws", () => {
    const throwing = video as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ prompt: "hi" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });

  test("no cost estimate is produced (no published USD pricing)", () => {
    const r = video.safe({ model: "ray-2", prompt: "hi", duration: "9s" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("luma.video documented endpoint URLs", () => {
  test("the concepts list endpoint is /generations/concepts/list", () => {
    expect(CONCEPTS_LIST_URL).toBe(`${GENERATIONS_URL}/concepts/list`);
    expect(CONCEPTS_LIST_URL).toBe(
      "https://api.lumalabs.ai/dream-machine/v1/generations/concepts/list",
    );
  });

  test("the generate route is the base /generations path", () => {
    expect(GENERATIONS_URL).toBe("https://api.lumalabs.ai/dream-machine/v1/generations");
  });
});
