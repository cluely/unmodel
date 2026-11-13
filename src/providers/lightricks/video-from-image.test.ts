import { describe, expect, test } from "bun:test";
import { videoFromImage, IMAGE_TO_VIDEO_URL } from "./video-from-image";
import { videoFromAudio, AUDIO_TO_VIDEO_URL } from "./video-from-audio";
import { LONG_DURATIONS, LTX_FPS_VALUES, LTX_RESOLUTIONS } from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = videoFromAudio.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("lightricks.videoFromImage", () => {
  test("wire-pure body on the v2 URL", () => {
    const v = videoFromImage({
      model: "ltx-2-3-fast",
      image_uri: "https://example.com/first.png",
      prompt: "the camera pushes in",
      resolution: "1280x720",
      duration: 6,
    });
    expect(Object.keys(v)).toEqual(["model", "image_uri", "prompt", "resolution", "duration"]);
    expect(v.request.url).toBe(IMAGE_TO_VIDEO_URL);
    expect(v.toSdk("lightricks")).toEqual({
      model: "ltx-2-3-fast",
      image_uri: "https://example.com/first.png",
      prompt: "the camera pushes in",
      resolution: "1280x720",
      duration: 6,
    });
  });

  test("unknown model warns but validates", () => {
    const r = videoFromImage.safe({
      model: "nope-v9",
      image_uri: "https://example.com/a.png",
      prompt: "hi",
      resolution: "1280x720",
      duration: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      // Model-dependent checks were skipped, so nothing is priced either.
      expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("last_frame_uri cannot ride with automatic duration", () => {
    const r = videoFromImage.safe({
      model: "ltx-2-5-fast",
      image_uri: "https://example.com/a.png",
      last_frame_uri: "https://example.com/b.png",
      prompt: "hi",
      resolution: "1280x720",
      duration: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.message).toContain(
        "automatic duration",
      );
    }
  });

  test("empty image_uri is invalid_shape", () => {
    const r = videoFromImage.safe({
      model: "ltx-2-3-fast",
      image_uri: "",
      prompt: "hi",
      resolution: "1280x720",
      duration: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("estimates from the resolution tier", () => {
    const r = videoFromImage.safe({
      model: "ltx-2-5-fast",
      image_uri: "https://example.com/a.png",
      prompt: "hi",
      resolution: "2560x1440",
      duration: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(1.14, 10); // $0.19/s × 6
  });
});

describe("lightricks.videoFromImage preset unions", () => {
  const IMG = "https://example.com/a.png";

  test("every LtxResolution and LtxFps preset passes on ltx-2-5-pro", () => {
    // Keep in sync with LtxResolution / LtxFps in shared.ts — ltx-2-5-pro is
    // a model whose published matrix accepts all four tiers in all five shapes
    // and all four frame rates at a 6s duration, so both unions are looped
    // against it.
    for (const resolution of LTX_RESOLUTIONS) {
      const r = videoFromImage.safe({
        model: "ltx-2-5-pro",
        image_uri: IMG,
        prompt: "hi",
        resolution,
        duration: 6,
      });
      expect(r.ok, `preset ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${resolution} should be warning-free`).toEqual([]);
    }

    for (const fps of LTX_FPS_VALUES) {
      const r = videoFromImage.safe({
        model: "ltx-2-5-pro",
        image_uri: IMG,
        prompt: "hi",
        resolution: "1920x1080",
        duration: 6,
        fps,
      });
      expect(r.ok, `preset ${fps}fps should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${fps}fps should be warning-free`).toEqual([]);
    }
  });

  test("every LtxDuration preset passes on ltx-2-3-fast at 720p/24fps", () => {
    // Keep in sync with LtxDuration in shared.ts — the long-form durations are
    // 24/25fps-only on the fast variants (the pro variants cap at 10s), so that
    // is the combination the matrix documents as covering all eight values.
    for (const duration of LONG_DURATIONS) {
      const r = videoFromImage.safe({
        model: "ltx-2-3-fast",
        image_uri: IMG,
        prompt: "hi",
        resolution: "1280x720",
        duration,
      });
      expect(r.ok, `preset ${duration}s should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${duration}s should be warning-free`).toEqual([]);
    }
  });
});

describe("lightricks.videoFromAudio", () => {
  const AUDIO = "https://example.com/vo.mp3";

  test("wire-pure body and default model", () => {
    const v = videoFromAudio({
      audio_uri: "https://example.com/vo.mp3",
      prompt: "a narrator in a dim booth",
    });
    expect(Object.keys(v)).toEqual(["audio_uri", "prompt"]);
    expect(v.request.url).toBe(AUDIO_TO_VIDEO_URL);
  });

  test("ltx-2-3-fast has no arm on this route", () => {
    const r = videoFromAudio.safe({
      audio_uri: "https://example.com/vo.mp3",
      prompt: "hi",
      model: "ltx-2-3-fast",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.meta?.supported).toContain("ltx-2-3-pro");
    }
  });

  test("needs a prompt or an image", () => {
    const r = videoFromAudio.safe({ audio_uri: "https://example.com/vo.mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("resolution follows the text-to-video matrix, per model", () => {
    // 720p through 4K on every model with an arm; LTX-2.5 adds 1:1, 3:2, 2:3.
    const cases = [
      { model: "ltx-2-3-pro", resolution: "1280x720" },
      { model: "ltx-2-3-pro", resolution: "2160x3840" },
      { model: "ltx-2-5-pro", resolution: "3840x2160" },
      { model: "ltx-2-5-fast", resolution: "1080x1080" },
      { model: "ltx-2-5-pro", resolution: "2160x3240" },
    ] as const;
    for (const { model, resolution } of cases) {
      const r = videoFromAudio.safe({ audio_uri: AUDIO, prompt: "hi", model, resolution });
      expect(r.ok, `${model} ${resolution}`).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    // The default model is LTX-2.3, which has only 16:9 and 9:16.
    const square = videoFromAudio.safe({ audio_uri: AUDIO, prompt: "hi", resolution: "1080x1080" });
    expect(square.ok).toBe(false);
    if (!square.ok) {
      const issue = square.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["resolution"]);
      expect(issue?.model).toBe("ltx-2-3-pro");
      expect(issue?.meta?.allowed).toContain("1280x720");
    }
  });

  test("fps is checked against the matrix, at the default tier when resolution is omitted", () => {
    const ok = videoFromAudio.safe({ audio_uri: AUDIO, prompt: "hi", model: "ltx-2-5-pro", fps: 48 });
    expect(ok.ok).toBe(true);
    const bad = safeUnchecked({ audio_uri: AUDIO, prompt: "hi", fps: 30 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const issue = bad.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["fps"]);
      expect(issue?.meta?.allowed).toEqual([24, 25, 48, 50]);
    }
  });

  test("ltx-2-3-fast gets the route refusal only, not a matrix one too", () => {
    const r = safeUnchecked({ audio_uri: AUDIO, prompt: "hi", model: "ltx-2-3-fast", fps: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(["unsupported_capability"]);
  });

  test("last_frame_uri and camera_motion ride the wire", () => {
    const v = videoFromAudio({
      audio_uri: AUDIO,
      image_uri: "https://example.com/first.png",
      last_frame_uri: "https://example.com/last.png",
      camera_motion: "jib_up",
    });
    expect(Object.keys(v)).toEqual(["audio_uri", "image_uri", "last_frame_uri", "camera_motion"]);
  });

  test("last_frame_uri requires image_uri", () => {
    const r = videoFromAudio.safe({
      audio_uri: AUDIO,
      prompt: "hi",
      last_frame_uri: "https://example.com/last.png",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["last_frame_uri"]);
    }
  });

  test("camera_motion is the closed enum", () => {
    const r = safeUnchecked({ audio_uri: AUDIO, prompt: "hi", camera_motion: "orbit" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["camera_motion"]);
  });

  test("no cost estimate — billing follows the input audio", () => {
    const r = videoFromAudio.safe({ audio_uri: "https://example.com/vo.mp3", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
