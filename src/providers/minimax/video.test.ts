import { describe, expect, test } from "bun:test";
import {
  video,
  videoQueryUrl,
  videoPriceUSD,
  VIDEO_GENERATION_URL,
  VIDEO_QUERY_URL,
  VIDEO_PROMPT_MAX_CHARACTERS,
  VIDEO_RESOLUTIONS,
} from "./video";
import { videoModels, VIDEO_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const IMAGE = "https://cdn.example/frame.jpg";

describe("minimax.video wire shape", () => {
  test("the whole params object is the JSON body; the route is async", () => {
    const v = video({
      model: "MiniMax-Hailuo-2.3",
      prompt: "A man picks up a book [Pedestal up], then reads [Static shot].",
      duration: 6,
      resolution: "1080P",
    });
    expect(Object.keys(v)).toEqual(["model", "prompt", "duration", "resolution"]);
    expect(v.request.url).toBe(VIDEO_GENERATION_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(videoQueryUrl("106916112212032")).toBe(
      `${VIDEO_QUERY_URL}?task_id=106916112212032`,
    );
  });

  test("unknown params warn but pass through", () => {
    const r = safeUnchecked({ model: "T2V-01", prompt: "hi", aigc_watermark: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("minimax.video model gate", () => {
  test("every catalogued video model is in the enum", () => {
    expect([...VIDEO_MODEL_IDS].sort()).toEqual(Object.keys(videoModels).sort());
  });

  test("an undocumented model is invalid_enum_value", () => {
    const r = video.safe({ model: "MiniMax-Hailuo-3", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model"]);
  });

  test("an off-catalog model warns unknown_model alongside the enum error", () => {
    const r = video.safe({ model: "NOPE-v9", prompt: "a cat" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.model).toBe("NOPE-v9");
    }
  });

  test("MiniMax-H3 is not accepted here: it is the /v2 route", () => {
    const r = video.safe({ model: "MiniMax-H3", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("minimax.video scenario rules", () => {
  test("text-to-video requires a prompt", () => {
    const r = video.safe({ model: "T2V-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });

  test("T2V models reject first_frame_image", () => {
    const r = video.safe({
      model: "T2V-01-Director",
      prompt: "hi",
      first_frame_image: IMAGE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["first_frame_image"]);
  });

  test("I2V models require first_frame_image and may omit the prompt", () => {
    const missing = video.safe({ model: "I2V-01", prompt: "hi" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["first_frame_image"]);
    expect(video.safe({ model: "I2V-01", first_frame_image: IMAGE }).ok).toBe(true);
  });

  test("last_frame_image is MiniMax-Hailuo-02 only", () => {
    expect(
      video.safe({
        model: "MiniMax-Hailuo-02",
        first_frame_image: IMAGE,
        last_frame_image: IMAGE,
      }).ok,
    ).toBe(true);
    const r = video.safe({
      model: "MiniMax-Hailuo-2.3",
      first_frame_image: IMAGE,
      last_frame_image: IMAGE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["last_frame_image"]);
  });

  test("subject_reference is S2V-01 only, with exactly one image", () => {
    const ok = video.safe({
      model: "S2V-01",
      prompt: "hi",
      subject_reference: [{ type: "character", image: [IMAGE] }],
    });
    expect(ok.ok).toBe(true);

    const missing = video.safe({ model: "S2V-01", prompt: "hi" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["subject_reference"]);

    const twoImages = video.safe({
      model: "S2V-01",
      prompt: "hi",
      subject_reference: [{ type: "character", image: [IMAGE, IMAGE] }],
    });
    expect(twoImages.ok).toBe(false);
    if (!twoImages.ok) {
      expect(twoImages.errors[0]?.path).toEqual(["subject_reference", 0, "image"]);
    }

    const wrongModel = video.safe({
      model: "T2V-01",
      prompt: "hi",
      subject_reference: [{ type: "character", image: [IMAGE] }],
    });
    expect(wrongModel.ok).toBe(false);
  });

  test("fast_pretreatment is Hailuo-only", () => {
    expect(
      video.safe({
        model: "MiniMax-Hailuo-2.3",
        prompt: "hi",
        fast_pretreatment: true,
      }).ok,
    ).toBe(true);
    const r = video.safe({ model: "T2V-01", prompt: "hi", fast_pretreatment: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["fast_pretreatment"]);
  });

  test("Hailuo-2.3-Fast is image-to-video only", () => {
    const r = video.safe({ model: "MiniMax-Hailuo-2.3-Fast", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["first_frame_image"]);
    expect(
      video.safe({ model: "MiniMax-Hailuo-2.3-Fast", first_frame_image: IMAGE }).ok,
    ).toBe(true);
  });

  test("prompt over 2000 characters is invalid_shape", () => {
    const r = video.safe({
      model: "T2V-01",
      prompt: "x".repeat(VIDEO_PROMPT_MAX_CHARACTERS + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });
});

describe("minimax.video resolution and duration", () => {
  test("1080P is 6 seconds only", () => {
    expect(
      video.safe({
        model: "MiniMax-Hailuo-2.3",
        prompt: "hi",
        resolution: "1080P",
        duration: 6,
      }).ok,
    ).toBe(true);
    const r = video.safe({
      model: "MiniMax-Hailuo-2.3",
      prompt: "hi",
      resolution: "1080P",
      duration: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["duration"]);
      expect(r.errors[0]?.meta?.allowed).toEqual([6]);
    }
  });

  test("the 01 generation is 720P / 6s only", () => {
    expect(video.safe({ model: "T2V-01", prompt: "hi", resolution: "720P" }).ok).toBe(
      true,
    );
    const wrongResolution = video.safe({
      model: "T2V-01",
      prompt: "hi",
      resolution: "1080P",
    });
    expect(wrongResolution.ok).toBe(false);
    if (!wrongResolution.ok) expect(wrongResolution.errors[0]?.path).toEqual(["resolution"]);

    const wrongDuration = video.safe({ model: "T2V-01", prompt: "hi", duration: 10 });
    expect(wrongDuration.ok).toBe(false);
  });

  test("512P is image-to-video only, and never with a last frame", () => {
    expect(
      video.safe({
        model: "MiniMax-Hailuo-02",
        first_frame_image: IMAGE,
        resolution: "512P",
        duration: 10,
      }).ok,
    ).toBe(true);

    const textToVideo = video.safe({
      model: "MiniMax-Hailuo-02",
      prompt: "hi",
      resolution: "512P",
    });
    expect(textToVideo.ok).toBe(false);
    if (!textToVideo.ok) expect(textToVideo.errors[0]?.code).toBe("unsupported_capability");

    const withLastFrame = video.safe({
      model: "MiniMax-Hailuo-02",
      first_frame_image: IMAGE,
      last_frame_image: IMAGE,
      resolution: "512P",
    });
    expect(withLastFrame.ok).toBe(false);
  });

  test("the default resolution (768P) is what an omitted resolution is checked against", () => {
    expect(
      video.safe({ model: "MiniMax-Hailuo-2.3", prompt: "hi", duration: 10 }).ok,
    ).toBe(true);
  });

  test("every documented resolution validates on a model that documents it", () => {
    // Keep in sync with MinimaxVideoResolution — the union is closed now, so
    // each value it advertises must pass on the model whose VIDEO_MODEL_RULES
    // entry lists it (512P is image-to-video only; the 01 generation is 720P).
    const cases = [
      { resolution: "512P", model: "MiniMax-Hailuo-02", first_frame_image: IMAGE },
      { resolution: "720P", model: "T2V-01", prompt: "hi" },
      { resolution: "768P", model: "MiniMax-Hailuo-2.3", prompt: "hi" },
      { resolution: "1080P", model: "MiniMax-Hailuo-2.3", prompt: "hi" },
    ] as const;
    expect(cases.map((c) => c.resolution)).toEqual([...VIDEO_RESOLUTIONS]);
    for (const { resolution, model, ...inputs } of cases) {
      const r = video.safe({ model, resolution, duration: 6, ...inputs });
      expect(r.ok, `resolution ${resolution} should validate on ${model}`).toBe(true);
      if (r.ok) expect(r.warnings, `resolution ${resolution} should be warning-free`).toEqual([]);
    }
  });
});

describe("minimax.video pricing", () => {
  test("flat per-video list prices", () => {
    expect(videoPriceUSD("MiniMax-Hailuo-2.3", "768P", 6)).toBe(0.28);
    expect(videoPriceUSD("MiniMax-Hailuo-2.3", "768P", 10)).toBe(0.56);
    expect(videoPriceUSD("MiniMax-Hailuo-2.3", "1080P", 6)).toBe(0.49);
    expect(videoPriceUSD("MiniMax-Hailuo-2.3-Fast", "768P", 6)).toBe(0.19);
    expect(videoPriceUSD("MiniMax-Hailuo-02", "512P", 10)).toBe(0.15);
    // Defaults: 768P at 6 seconds.
    expect(videoPriceUSD("MiniMax-Hailuo-02")).toBe(0.28);
    // The 01 generation publishes no rate.
    expect(videoPriceUSD("T2V-01", "720P", 6)).toBeUndefined();
  });

  test("the estimate uses the exact model/resolution/duration price", () => {
    const r = video.safe({
      model: "MiniMax-Hailuo-2.3",
      prompt: "hi",
      resolution: "768P",
      duration: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.56, 10);

    const unpriced = video.safe({ model: "T2V-01", prompt: "hi" });
    expect(unpriced.ok).toBe(true);
    if (unpriced.ok) expect(unpriced.estimate.costUSD).toBeUndefined();
  });

  test("the catalog rate is the default configuration's per-second price", () => {
    expect(videoModels["MiniMax-Hailuo-2.3"].cost?.perVideoSecond).toBeCloseTo(0.28 / 6, 10);
  });

  test("maxCostUSD turns an expensive video into over_budget", () => {
    const r = video.safe(
      { model: "MiniMax-Hailuo-2.3", prompt: "hi", resolution: "1080P" },
      { maxCostUSD: 0.3 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = video as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "I2V-01" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
