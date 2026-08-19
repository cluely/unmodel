import { describe, expect, test } from "bun:test";
import { textToVideo, TEXT_TO_VIDEO_URL } from "./text-to-video";
import { imageToVideo, IMAGE_TO_VIDEO_URL } from "./image-to-video";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = textToVideo.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("pixverse.textToVideo happy path", () => {
  test("wire-pure body with URL and method", () => {
    const v = textToVideo({
      model: "v6",
      prompt: "a neon-lit alley in the rain",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
    });
    expect(Object.keys(v)).toEqual(["model", "prompt", "aspect_ratio", "quality", "duration"]);
    expect(v.request.url).toBe(TEXT_TO_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    // API-KEY and Ai-trace-id are the caller's to add.
    expect(Object.keys(v.request.headers)).toEqual(["content-type"]);
  });

  test("unknown model warns but validates", () => {
    const r = textToVideo.safe({
      model: "v7",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("pixverse.textToVideo model rules", () => {
  test("21:9 is a v6/c1-only aspect ratio", () => {
    expect(
      textToVideo.safe({
        model: "v6",
        prompt: "hi",
        aspect_ratio: "21:9",
        quality: "720p",
        duration: 5,
      }).ok,
    ).toBe(true);

    const legacy = textToVideo.safe({
      model: "v5.5",
      prompt: "hi",
      aspect_ratio: "21:9",
      quality: "720p",
      duration: 5,
    });
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) {
      const issue = legacy.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["aspect_ratio"]);
      expect(issue?.meta?.allowed).toEqual(["16:9", "4:3", "1:1", "3:4", "9:16"]);
    }
  });

  test("v6 takes 1-15s, v5 only 5 or 8", () => {
    expect(
      textToVideo.safe({
        model: "v6",
        prompt: "hi",
        aspect_ratio: "16:9",
        quality: "720p",
        duration: 15,
      }).ok,
    ).toBe(true);

    const over = textToVideo.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 16,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.meta?.max).toBe(15);

    const v5 = textToVideo.safe({
      model: "v5",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 10,
    });
    expect(v5.ok).toBe(false);
    if (!v5.ok) expect(v5.errors[0]?.meta?.allowed).toEqual([5, 8]);
  });

  test("1080p excludes the 10-second duration on v5.5 / v5.6", () => {
    const r = textToVideo.safe({
      model: "v5.6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "1080p",
      duration: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.message).toContain("1080p");
    }
  });

  test("generate_audio_switch is v5.5-and-up only", () => {
    const r = textToVideo.safe({
      model: "v5",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      generate_audio_switch: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["generate_audio_switch"]);
      expect(issue?.meta?.supported).toEqual(["v5.5", "v5.6", "v6", "c1"]);
    }
  });

  test("the lip-sync TTS fields are v5-and-below only", () => {
    const r = textToVideo.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      lip_sync_tts_switch: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "lip_sync_tts_switch",
      ]);
    }
  });

  test("seed is bounded and quality is closed", () => {
    const seed = safeUnchecked({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      seed: 2_147_483_648,
    });
    expect(seed.ok).toBe(false);
    if (!seed.ok) expect(seed.errors[0]?.path).toEqual(["seed"]);

    const quality = safeUnchecked({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "4k",
      duration: 5,
    });
    expect(quality.ok).toBe(false);
    if (!quality.ok) expect(quality.errors[0]?.path).toEqual(["quality"]);
  });
});

describe("pixverse.textToVideo cost estimation", () => {
  test("v6 bills per second by quality and audio", () => {
    const silent = textToVideo.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
    });
    expect(silent.ok).toBe(true);
    if (silent.ok) expect(silent.estimate.costUSD).toBeCloseTo(0.45, 10); // 9 cr/s × 5

    const withAudio = textToVideo.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      generate_audio_switch: true,
    });
    expect(withAudio.ok).toBe(true);
    if (withAudio.ok) expect(withAudio.estimate.costUSD).toBeCloseTo(0.6, 10); // 12 cr/s × 5
  });

  test("v5.5 uses the fixed per-generation table, incl. the multi-clip column", () => {
    const single = textToVideo.safe({
      model: "v5.5",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 8,
    });
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.estimate.costUSD).toBeCloseTo(1.2, 10); // 120 credits

    const multi = textToVideo.safe({
      model: "v5.5",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 8,
      generate_audio_switch: true,
      generate_multi_clip_switch: true,
    });
    expect(multi.ok).toBe(true);
    if (multi.ok) expect(multi.estimate.costUSD).toBeCloseTo(1.6, 10); // 160 credits
  });

  test("over-budget is reported", () => {
    const r = textToVideo.safe(
      { model: "v6", prompt: "hi", aspect_ratio: "16:9", quality: "1080p", duration: 15 },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });
});

describe("pixverse.imageToVideo", () => {
  test("wire-pure body with the upload id", () => {
    const v = imageToVideo({
      model: "v6",
      img_id: 12345,
      prompt: "the camera pushes in",
      quality: "720p",
      duration: 5,
    });
    expect(v.request.url).toBe(IMAGE_TO_VIDEO_URL);
    expect(Object.keys(v)).toEqual(["model", "img_id", "prompt", "quality", "duration"]);
  });

  test("img_ids needs a template_id", () => {
    const r = imageToVideo.safe({
      model: "v6",
      img_id: 1,
      img_ids: [1, 2],
      prompt: "hi",
      quality: "720p",
      duration: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["img_ids"]);
    }
    expect(
      imageToVideo.safe({
        model: "v6",
        img_id: 1,
        img_ids: [1, 2],
        template_id: 302325299692608,
        prompt: "hi",
        quality: "720p",
        duration: 5,
      }).ok,
    ).toBe(true);
  });

  test("v4.5 motion_mode picks the fast credit column", () => {
    const normal = imageToVideo.safe({
      model: "v4.5",
      img_id: 1,
      prompt: "hi",
      quality: "720p",
      duration: 5,
    });
    expect(normal.ok).toBe(true);
    if (normal.ok) expect(normal.estimate.costUSD).toBeCloseTo(0.6, 10); // 60 credits

    const fast = imageToVideo.safe({
      model: "v4.5",
      img_id: 1,
      prompt: "hi",
      quality: "720p",
      duration: 5,
      motion_mode: "fast",
    });
    expect(fast.ok).toBe(true);
    if (fast.ok) expect(fast.estimate.costUSD).toBeCloseTo(1.2, 10); // 120 credits
  });
});
