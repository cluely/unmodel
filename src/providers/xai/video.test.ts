import { describe, expect, test } from "bun:test";
import {
  video,
  videoEdit,
  videoExtend,
  videoStatusUrl,
  videoPriceUSD,
  VIDEO_GENERATIONS_URL,
  VIDEO_EDITS_URL,
  VIDEO_EXTENSIONS_URL,
  VIDEO_STATUS_URL,
  VIDEO_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
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
const CLIP = "https://cdn.example/clip.mp4";

describe("xai.video wire shape", () => {
  test("the whole params object is the JSON body; the route is async", () => {
    const v = video({
      model: "grok-imagine-video-1.5",
      prompt: "Make the water crash down and slowly pan out the camera",
      image: { url: IMAGE },
      duration: 12,
      resolution: "720p",
    });
    expect(Object.keys(v)).toEqual(["model", "prompt", "image", "duration", "resolution"]);
    expect(v.request.url).toBe(VIDEO_GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(videoStatusUrl("d97415a1-5796-b7ec-379f-4e6819e08fdf")).toBe(
      `${VIDEO_STATUS_URL}/d97415a1-5796-b7ec-379f-4e6819e08fdf`,
    );
  });

  test("unknown params warn but pass through", () => {
    const r = safeUnchecked({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      watermark: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("documented enums validate", () => {
    for (const resolution of VIDEO_RESOLUTIONS) {
      expect(video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", resolution }).ok).toBe(
        true,
      );
    }
    for (const aspect_ratio of VIDEO_ASPECT_RATIOS) {
      expect(
        video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", aspect_ratio }).ok,
      ).toBe(true);
    }
    expect(
      safeUnchecked({ model: "grok-imagine-video-1.5", prompt: "hi", resolution: "4k" }).ok,
    ).toBe(false);
  });
});

describe("xai.video model gate", () => {
  test("every catalogued video model is in the enum", () => {
    expect([...VIDEO_MODEL_IDS].sort()).toEqual(Object.keys(videoModels).sort());
  });

  test("an image id is invalid_enum_value here, with unknown_model alongside", () => {
    const r = video.safe({ model: "grok-imagine-image-2.0", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    }
  });

  test("an omitted model is legal on the wire: checks are skipped, no estimate", () => {
    const r = video.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeUndefined();
    }
  });
});

describe("xai.video input pairing", () => {
  test("image and reference_images cannot be combined", () => {
    const r = video.safe({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      image: { url: IMAGE },
      reference_images: [{ url: IMAGE }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["reference_images"]);
  });

  test("a media input takes url XOR file_id", () => {
    expect(
      video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", image: { file_id: "f1" } }).ok,
    ).toBe(true);
    const both = video.safe({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      image: { url: IMAGE, file_id: "f1" },
    });
    expect(both.ok).toBe(false);
    const neither = video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", image: {} });
    expect(neither.ok).toBe(false);
  });

  test("reference_audios: at most 3, each url XOR voice_id", () => {
    expect(
      video.safe({
        model: "grok-imagine-video-1.5",
        prompt: "<AUDIO_0> narrates",
        reference_audios: [{ voice_id: "eve" }],
      }).ok,
    ).toBe(true);
    const four = video.safe({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      reference_audios: [
        { voice_id: "eve" },
        { voice_id: "eve" },
        { voice_id: "eve" },
        { voice_id: "eve" },
      ],
    });
    expect(four.ok).toBe(false);
    if (!four.ok) expect(four.errors[0]?.path).toEqual(["reference_audios"]);
    const both = video.safe({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      reference_audios: [{ voice_id: "eve", url: "https://cdn.example/voice.mp3" }],
    });
    expect(both.ok).toBe(false);
  });

  test("1080p is refused for reference-to-video", () => {
    expect(
      video.safe({
        model: "grok-imagine-video-1.5",
        prompt: "hi",
        image: { url: IMAGE },
        resolution: "1080p",
      }).ok,
    ).toBe(true);
    const r = video.safe({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      reference_images: [{ url: IMAGE }],
      resolution: "1080p",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });

  test("duration must be an integer between 1 and 15", () => {
    expect(video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", duration: 15 }).ok).toBe(
      true,
    );
    const r = video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", duration: 16 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["duration"]);
  });

  test("prompt is required", () => {
    const r = safeUnchecked({ model: "grok-imagine-video-1.5", image: { url: IMAGE } });
    expect(r.ok).toBe(false);
  });
});

describe("xai.videoEdit and xai.videoExtend", () => {
  test("edits: video is required, POSTs to /v1/videos/edits, no estimate", () => {
    const v = videoEdit({
      model: "grok-imagine-video-1.5",
      prompt: "Render it as a watercolor",
      video: { url: CLIP },
    });
    expect(v.request.url).toBe(VIDEO_EDITS_URL);
    const r = videoEdit.safe({
      model: "grok-imagine-video-1.5",
      prompt: "Render it as a watercolor",
      video: { url: CLIP },
    });
    expect(r.ok).toBe(true);
    // Output length matches the input clip (capped at 8.7 s), which the
    // request cannot know — so no cost estimate.
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("extensions: duration is 2–10, default 6 prices the estimate", () => {
    const v = videoExtend({
      model: "grok-imagine-video-1.5",
      prompt: "The camera keeps rising",
      video: { url: CLIP },
    });
    expect(v.request.url).toBe(VIDEO_EXTENSIONS_URL);

    const r = videoExtend.safe({
      model: "grok-imagine-video-1.5",
      prompt: "The camera keeps rising",
      video: { url: CLIP },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.08 * 6, 10);

    const bad = videoExtend.safe({
      model: "grok-imagine-video-1.5",
      prompt: "hi",
      video: { url: CLIP },
      duration: 12,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.path).toEqual(["duration"]);
  });
});

describe("xai.video pricing", () => {
  test("per-second rates from the models page", () => {
    expect(videoModels["grok-imagine-video"].cost?.perVideoSecond).toBe(0.05);
    expect(videoModels["grok-imagine-video-1.5"].cost?.perVideoSecond).toBe(0.08);
    expect(videoPriceUSD("grok-imagine-video-1.5", 10)).toBeCloseTo(0.8, 10);
    expect(videoPriceUSD("grok-imagine-video", 10)).toBeCloseTo(0.5, 10);
    expect(videoPriceUSD(undefined, 10)).toBeUndefined();
    expect(videoPriceUSD("nope", 10)).toBeUndefined();
  });

  test("the estimate uses the requested duration, defaulting to 8 seconds", () => {
    const explicit = video.safe({ model: "grok-imagine-video-1.5", prompt: "hi", duration: 10 });
    expect(explicit.ok).toBe(true);
    if (explicit.ok) expect(explicit.estimate.costUSD).toBeCloseTo(0.8, 10);

    const defaulted = video.safe({ model: "grok-imagine-video", prompt: "hi" });
    expect(defaulted.ok).toBe(true);
    if (defaulted.ok) expect(defaulted.estimate.costUSD).toBeCloseTo(0.05 * 8, 10);
  });

  test("maxCostUSD turns an expensive clip into over_budget", () => {
    const r = video.safe(
      { model: "grok-imagine-video-1.5", prompt: "hi", duration: 15 },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = video as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "grok-imagine-video-1.5", prompt: "hi", duration: 99 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
