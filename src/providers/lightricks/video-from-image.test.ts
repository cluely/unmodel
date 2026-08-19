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

  test("last_frame_uri is rejected on the deprecated LTX-2 models", () => {
    const r = videoFromImage.safe({
      model: "ltx-2-pro",
      image_uri: "https://example.com/a.png",
      last_frame_uri: "https://example.com/b.png",
      prompt: "hi",
      resolution: "1280x720",
      duration: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "last_frame_uri",
      ]);
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

  test("every LtxResolution and LtxFps preset passes on ltx-2-3-pro", () => {
    // Keep in sync with LtxResolution / LtxFps in shared.ts — ltx-2-3-pro is
    // the model whose published matrix accepts all four tiers and all four
    // frame rates at a 6s duration, so both unions are looped against it.
    for (const resolution of LTX_RESOLUTIONS) {
      const r = videoFromImage.safe({
        model: "ltx-2-3-pro",
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
        model: "ltx-2-3-pro",
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

  test("resolution is 1080p-only here", () => {
    const r = safeUnchecked({
      audio_uri: "https://example.com/vo.mp3",
      prompt: "hi",
      resolution: "1280x720",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["resolution"]);
  });

  test("no cost estimate — billing follows the input audio", () => {
    const r = videoFromAudio.safe({ audio_uri: "https://example.com/vo.mp3", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("lightricks.videoFromImage deprecated LTX-2 support matrix", () => {
  // Same gap as text-to-video: both arms share `checkSupportMatrix`, so the
  // deprecation-notice matrix has to bound `duration` on this route too.
  test.each(["ltx-2-fast", "ltx-2-pro"])("%s rejects an absurd duration", (model) => {
    const r = videoFromImage.safe({
      model,
      image_uri: "https://example.com/a.png",
      prompt: "x",
      duration: 10_000_000_000,
      resolution: "1920x1080",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual(["duration"]);
  });

  test.each(["ltx-2-fast", "ltx-2-pro"])("%s accepts a documented duration", (model) => {
    const r = videoFromImage.safe({
      model,
      image_uri: "https://example.com/a.png",
      prompt: "x",
      duration: 8,
      resolution: "1920x1080",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("deprecated_model");
  });
});
