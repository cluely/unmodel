import { describe, expect, test } from "bun:test";
import {
  video,
  videoPriceUSD,
  videoBillingTier,
  videoSynthesisUrl,
  videoTaskUrl,
  DEFAULT_BASE_URL,
  VIDEO_SYNTHESIS_URL,
  VIDEO_MODEL_RULES,
  VIDEO_PRICE_PER_SECOND_USD,
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

describe("alibaba.video wire shape", () => {
  test("the whole params object is the JSON body; the route is async", () => {
    const v = video({
      model: "wan2.7-t2v",
      input: { prompt: "A corgi runs on a beach at sunset" },
      parameters: { resolution: "1080P", duration: 5 },
    });
    expect(Object.keys(v)).toEqual(["model", "input", "parameters"]);
    expect(v.request.url).toBe(VIDEO_SYNTHESIS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // Mandatory: without it DashScope answers "does not support synchronous calls".
    expect(v.request.headers["x-dashscope-async"]).toBe("enable");
  });

  test("URL helpers take a workspace-scoped base; the legacy intl domain is the default", () => {
    expect(videoSynthesisUrl()).toBe(
      `${DEFAULT_BASE_URL}/api/v1/services/aigc/video-generation/video-synthesis`,
    );
    expect(videoSynthesisUrl("https://ws-123.ap-southeast-1.maas.aliyuncs.com/")).toBe(
      "https://ws-123.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    );
    expect(videoTaskUrl("abc-123")).toBe(`${DEFAULT_BASE_URL}/api/v1/tasks/abc-123`);
    expect(videoTaskUrl("t1", "https://ws.eu-central-1.maas.aliyuncs.com")).toBe(
      "https://ws.eu-central-1.maas.aliyuncs.com/api/v1/tasks/t1",
    );
  });

  test("unknown params warn but pass through", () => {
    const r = safeUnchecked({
      model: "wan2.7-t2v",
      input: { prompt: "hi" },
      template: "flying",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("alibaba.video model gate", () => {
  test("every catalogued video model has a rule row and is in the enum", () => {
    expect([...VIDEO_MODEL_IDS].sort()).toEqual(Object.keys(videoModels).sort());
    expect(Object.keys(VIDEO_MODEL_RULES).sort()).toEqual(Object.keys(videoModels).sort());
  });

  test("an undocumented model is invalid_enum_value plus unknown_model", () => {
    const r = video.safe({ model: "wan9.9-t2v", input: { prompt: "hi" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.errors[0]?.path).toEqual(["model"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    }
  });
});

describe("alibaba.video input rules", () => {
  test("text-to-video requires a prompt", () => {
    const r = video.safe({ model: "happyhorse-1.1-t2v", input: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["input", "prompt"]);
  });

  test("prompt over the per-model cap is over_output_limit (wan2.2 caps at 800)", () => {
    const r = video.safe({
      model: "wan2.2-t2v-plus",
      input: { prompt: "x".repeat(801) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(800);
    }
    expect(
      video.safe({ model: "wan2.2-t2v-plus", input: { prompt: "x".repeat(800) } }).ok,
    ).toBe(true);
  });

  test("negative_prompt is a wan field; HappyHorse rejects it", () => {
    expect(
      video.safe({
        model: "wan2.7-t2v",
        input: { prompt: "hi", negative_prompt: "blurry" },
      }).ok,
    ).toBe(true);
    const r = video.safe({
      model: "happyhorse-1.1-t2v",
      input: { prompt: "hi", negative_prompt: "blurry" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["input", "negative_prompt"]);
  });

  test("audio_url is wan2.7/2.6/2.5 t2v only", () => {
    expect(
      video.safe({
        model: "wan2.6-t2v",
        input: { prompt: "hi", audio_url: "https://cdn.example/song.mp3" },
      }).ok,
    ).toBe(true);
    const r = video.safe({
      model: "wan2.2-t2v-plus",
      input: { prompt: "hi", audio_url: "https://cdn.example/song.mp3" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["input", "audio_url"]);
  });

  test("media on a pure text-to-video model is unsupported_param", () => {
    const r = video.safe({
      model: "wan2.7-t2v",
      input: { prompt: "hi", media: [{ type: "first_frame", url: IMAGE }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["input", "media"]);
  });

  test("HappyHorse i2v requires media and may omit the prompt", () => {
    const missing = video.safe({ model: "happyhorse-1.1-i2v", input: { prompt: "hi" } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["input", "media"]);
    expect(
      video.safe({
        model: "happyhorse-1.1-i2v",
        input: { media: [{ type: "first_frame", url: IMAGE }] },
      }).ok,
    ).toBe(true);
  });

  test("HappyHorse r2v takes 1–9 reference images, and only reference images", () => {
    const refs = (n: number) =>
      Array.from({ length: n }, () => ({ type: "reference_image" as const, url: IMAGE }));
    expect(
      video.safe({ model: "happyhorse-1.1-r2v", input: { prompt: "hi", media: refs(9) } }).ok,
    ).toBe(true);
    const tooMany = video.safe({
      model: "happyhorse-1.1-r2v",
      input: { prompt: "hi", media: refs(10) },
    });
    expect(tooMany.ok).toBe(false);

    const wrongType = video.safe({
      model: "happyhorse-1.1-r2v",
      input: { prompt: "hi", media: [{ type: "first_frame", url: IMAGE }] },
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.errors[0]?.path).toEqual(["input", "media", 0, "type"]);
    }
  });

  test("video-edit takes exactly one video plus up to 5 reference images", () => {
    expect(
      video.safe({
        model: "happyhorse-1.0-video-edit",
        input: {
          prompt: "make it snow",
          media: [
            { type: "video", url: CLIP },
            { type: "reference_image", url: IMAGE },
          ],
        },
      }).ok,
    ).toBe(true);
    const noVideo = video.safe({
      model: "happyhorse-1.0-video-edit",
      input: { prompt: "make it snow", media: [{ type: "reference_image", url: IMAGE }] },
    });
    expect(noVideo.ok).toBe(false);
  });

  test("wan2.7-i2v needs a first_frame or first_clip; driving_audio pairs with first_frame", () => {
    expect(
      video.safe({
        model: "wan2.7-i2v-2026-04-25",
        input: { media: [{ type: "first_frame", url: IMAGE }] },
      }).ok,
    ).toBe(true);
    expect(
      video.safe({
        model: "wan2.7-i2v-2026-04-25",
        input: { media: [{ type: "first_clip", url: CLIP }] },
      }).ok,
    ).toBe(true);
    const lastOnly = video.safe({
      model: "wan2.7-i2v-2026-04-25",
      input: { media: [{ type: "last_frame", url: IMAGE }] },
    });
    expect(lastOnly.ok).toBe(false);
    const clipWithAudio = video.safe({
      model: "wan2.7-i2v-2026-04-25",
      input: {
        media: [
          { type: "first_clip", url: CLIP },
          { type: "driving_audio", url: "https://cdn.example/voice.mp3" },
        ],
      },
    });
    expect(clipWithAudio.ok).toBe(false);
  });

  test("wan3.0-video takes prompt OR media, and caps reference images at 10", () => {
    expect(video.safe({ model: "wan3.0-video", input: { prompt: "hi" } }).ok).toBe(true);
    expect(
      video.safe({
        model: "wan3.0-video",
        input: { media: [{ type: "first_frame", url: IMAGE }] },
      }).ok,
    ).toBe(true);
    const neither = video.safe({ model: "wan3.0-video", input: {} });
    expect(neither.ok).toBe(false);

    const refs = Array.from({ length: 11 }, () => ({
      type: "reference_image" as const,
      url: IMAGE,
    }));
    expect(video.safe({ model: "wan3.0-video", input: { media: refs } }).ok).toBe(false);
  });
});

describe("alibaba.video parameters rules", () => {
  test("legacy models take `size`, tier models take `resolution` — never both spellings", () => {
    const sizeOnTier = video.safe({
      model: "wan2.7-t2v",
      input: { prompt: "hi" },
      parameters: { size: "1920*1080" },
    });
    expect(sizeOnTier.ok).toBe(false);
    if (!sizeOnTier.ok) expect(sizeOnTier.errors[0]?.path).toEqual(["parameters", "size"]);

    const resolutionOnLegacy = video.safe({
      model: "wan2.6-t2v",
      input: { prompt: "hi" },
      parameters: { resolution: "1080P" },
    });
    expect(resolutionOnLegacy.ok).toBe(false);
    if (!resolutionOnLegacy.ok) {
      expect(resolutionOnLegacy.errors[0]?.path).toEqual(["parameters", "resolution"]);
    }
  });

  test("size values are the documented per-model lists", () => {
    expect(
      video.safe({
        model: "wan2.6-t2v",
        input: { prompt: "hi" },
        parameters: { size: "1280*720" },
      }).ok,
    ).toBe(true);
    // 480p sizes exist on wan2.5 but not wan2.6.
    const r = video.safe({
      model: "wan2.6-t2v",
      input: { prompt: "hi" },
      parameters: { size: "832*480" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    expect(
      video.safe({
        model: "wan2.5-t2v-preview",
        input: { prompt: "hi" },
        parameters: { size: "832*480" },
      }).ok,
    ).toBe(true);
  });

  test("480P is wan3.0/wan2.5-tier only among the resolution models", () => {
    const r = video.safe({
      model: "happyhorse-1.1-t2v",
      input: { prompt: "hi" },
      parameters: { resolution: "480P" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["parameters", "resolution"]);
    expect(
      video.safe({
        model: "wan3.0-video",
        input: { prompt: "hi" },
        parameters: { resolution: "480P" },
      }).ok,
    ).toBe(true);
  });

  test("ratio is refused where the frame follows the input", () => {
    const r = video.safe({
      model: "wan2.7-i2v-2026-04-25",
      input: { media: [{ type: "first_frame", url: IMAGE }] },
      parameters: { ratio: "16:9" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["parameters", "ratio"]);
    // The HappyHorse t2v ratio enum is wider than wan's.
    expect(
      video.safe({
        model: "happyhorse-1.1-t2v",
        input: { prompt: "hi" },
        parameters: { ratio: "21:9" },
      }).ok,
    ).toBe(true);
    expect(
      video.safe({
        model: "wan2.7-t2v",
        input: { prompt: "hi" },
        parameters: { ratio: "21:9" },
      }).ok,
    ).toBe(false);
  });

  test("durations follow each model's documented values", () => {
    // wan2.6-t2v: 2–15; wan2.6-t2v-us: 5 or 10; wan2.2: fixed 5.
    expect(
      video.safe({ model: "wan2.6-t2v", input: { prompt: "hi" }, parameters: { duration: 15 } })
        .ok,
    ).toBe(true);
    expect(
      video.safe({ model: "wan2.6-t2v", input: { prompt: "hi" }, parameters: { duration: 20 } })
        .ok,
    ).toBe(false);
    expect(
      video.safe({
        model: "wan2.6-t2v-us",
        input: { prompt: "hi" },
        parameters: { duration: 7 },
      }).ok,
    ).toBe(false);
    expect(
      video.safe({
        model: "wan2.2-t2v-plus",
        input: { prompt: "hi" },
        parameters: { duration: 10 },
      }).ok,
    ).toBe(false);
    // wan3.0: 2–30, and -1 is smart-duration mode.
    expect(
      video.safe({ model: "wan3.0-video", input: { prompt: "hi" }, parameters: { duration: 30 } })
        .ok,
    ).toBe(true);
    expect(
      video.safe({ model: "wan3.0-video", input: { prompt: "hi" }, parameters: { duration: -1 } })
        .ok,
    ).toBe(true);
    expect(
      video.safe({ model: "wan3.0-video", input: { prompt: "hi" }, parameters: { duration: 31 } })
        .ok,
    ).toBe(false);
    // video-edit has no duration param at all.
    expect(
      video.safe({
        model: "happyhorse-1.0-video-edit",
        input: { prompt: "hi", media: [{ type: "video", url: CLIP }] },
        parameters: { duration: 5 },
      }).ok,
    ).toBe(false);
  });

  test("protocol-specific parameters are gated per model", () => {
    const cases = [
      { model: "wan2.7-t2v", parameters: { shot_type: "single" as const } },
      { model: "wan2.7-t2v", parameters: { audio: true } },
      { model: "wan2.7-t2v", parameters: { audio_setting: "auto" as const } },
      { model: "happyhorse-1.1-t2v", parameters: { prompt_extend: true } },
    ];
    for (const { model, parameters } of cases) {
      const r = video.safe({ model, input: { prompt: "hi" }, parameters });
      expect(r.ok, `${Object.keys(parameters)[0]} should be refused on ${model}`).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
    }
    expect(
      video.safe({
        model: "wan2.6-t2v",
        input: { prompt: "hi" },
        parameters: { shot_type: "multi", prompt_extend: true },
      }).ok,
    ).toBe(true);
    expect(
      video.safe({
        model: "wan3.0-video",
        input: { prompt: "hi" },
        parameters: { audio: false, ratio: "adaptive" },
      }).ok,
    ).toBe(true);
  });

  test("seed outside [0, 2147483647] is invalid_shape", () => {
    const r = safeUnchecked({
      model: "wan2.7-t2v",
      input: { prompt: "hi" },
      parameters: { seed: -1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("alibaba.video pricing (Singapore USD tables, 2026-08-24)", () => {
  test("per-second rates times duration, at the requested tier", () => {
    expect(videoPriceUSD("wan2.7-t2v", { resolution: "720P", duration: 10 })).toBeCloseTo(1, 10);
    // Defaults: 1080P at 5 seconds.
    expect(videoPriceUSD("wan2.7-t2v")).toBeCloseTo(0.75, 10);
    // Legacy sizes bill by their tier.
    expect(
      videoPriceUSD("wan2.5-t2v-preview", { size: "832*480", duration: 5 }),
    ).toBeCloseTo(0.25, 10);
    expect(videoBillingTier("wan2.5-t2v-preview", { size: "832*480" })).toBe("480P");
    // wan2.1-turbo's default size is 1280*720 → the 720P rate.
    expect(videoPriceUSD("wan2.1-t2v-turbo")).toBeCloseTo(0.18, 10);
    expect(videoPriceUSD("happyhorse-1.1-t2v")).toBeCloseTo(0.9, 10);
    expect(videoPriceUSD("happyhorse-1.0-t2v", { resolution: "720P" })).toBeCloseTo(0.7, 10);
    // No published international rate → no estimate.
    expect(videoPriceUSD("wan3.0-video")).toBeUndefined();
    // Bills input+output duration the request does not carry → no estimate.
    expect(videoPriceUSD("happyhorse-1.0-video-edit")).toBeUndefined();
    // Smart duration prices at run time.
    expect(videoPriceUSD("wan3.0-video", { duration: -1 })).toBeUndefined();
  });

  test("every priced model resolves a rate for each of its documented tiers", () => {
    for (const [model, tiers] of Object.entries(VIDEO_PRICE_PER_SECOND_USD)) {
      for (const rate of Object.values(tiers)) {
        expect(rate, `${model} rate`).toBeGreaterThan(0);
      }
      expect(Object.keys(videoModels)).toContain(model);
    }
  });

  test("the estimate flows into maxCostUSD", () => {
    const r = video.safe(
      {
        model: "happyhorse-1.1-t2v",
        input: { prompt: "hi" },
        parameters: { resolution: "1080P", duration: 15 },
      },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);

    const priced = video.safe({
      model: "wan2.7-t2v",
      input: { prompt: "hi" },
      parameters: { resolution: "720P", duration: 8 },
    });
    expect(priced.ok).toBe(true);
    if (priced.ok) expect(priced.estimate.costUSD).toBeCloseTo(0.8, 10);
  });

  test("the catalog rate is the default configuration's per-second price", () => {
    expect(videoModels["wan2.7-t2v"].cost?.perVideoSecond).toBeCloseTo(0.15, 10);
    expect(videoModels["happyhorse-1.0-t2v"].cost?.perVideoSecond).toBeCloseTo(0.24, 10);
    // wan3.0-video has no published international rate, so no cost key at all.
    expect("cost" in videoModels["wan3.0-video"]).toBe(false);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = video as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "happyhorse-1.1-i2v", input: { prompt: "hi" } });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("alibaba.video catalog", () => {
  test("video rows are video-shaped non-token models", () => {
    for (const info of Object.values(videoModels)) {
      expect(info.limit.context).toBe(0);
      expect(info.modalities.output).toEqual(["video"]);
    }
  });
});
