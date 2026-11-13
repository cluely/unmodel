import { describe, expect, test } from "bun:test";
import { video, TEXT_TO_VIDEO_URL } from "./video";
import { videoFromImage, IMAGE_TO_VIDEO_URL } from "./video-from-image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("pixverse.video happy path", () => {
  test("wire-pure body with URL and method", () => {
    const v = video({
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
    const r = video.safe({
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

describe("pixverse.video model rules", () => {
  test("21:9 is a v6/c1-only aspect ratio", () => {
    expect(
      video.safe({
        model: "v6",
        prompt: "hi",
        aspect_ratio: "21:9",
        quality: "720p",
        duration: 5,
      }).ok,
    ).toBe(true);

    const legacy = video.safe({
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
      video.safe({
        model: "v6",
        prompt: "hi",
        aspect_ratio: "16:9",
        quality: "720p",
        duration: 15,
      }).ok,
    ).toBe(true);

    const over = video.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 16,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.meta?.max).toBe(15);

    const v5 = video.safe({
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
    const r = video.safe({
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
    const r = video.safe({
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
      expect(issue?.meta?.supported).toEqual(["v5.5", "v5.6", "v6", "c1", "v6-max"]);
    }
  });

  test("the lip-sync TTS fields are v5-and-below only", () => {
    const r = video.safe({
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

  test("a switch sent as its default `false` passes on any model", () => {
    const r = video.safe({
      model: "v5.6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      generate_multi_clip_switch: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
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

describe("pixverse v6-max", () => {
  test("validates and prices per second on both routes", () => {
    const text = video.safe({
      model: "v6-max",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
    });
    expect(text.ok).toBe(true);
    if (text.ok) {
      expect(text.warnings).toEqual([]);
      expect(text.estimate.costUSD).toBeCloseTo(55 / 225, 10); // 11 cr/s × 5
    }

    const image = videoFromImage.safe({
      model: "v6-max",
      img_id: 1,
      prompt: "hi",
      quality: "1080p",
      duration: 5,
      generate_audio_switch: true,
    });
    expect(image.ok).toBe(true);
    if (image.ok) {
      expect(image.warnings).toEqual([]);
      expect(image.estimate.costUSD).toBeCloseTo(140 / 225, 10); // 28 cr/s × 5
    }
  });

  test("takes 1-15s and the wide ratio set", () => {
    expect(
      video.safe({
        model: "v6-max",
        prompt: "hi",
        aspect_ratio: "21:9",
        quality: "360p",
        duration: 1,
      }).ok,
    ).toBe(true);

    const over = video.safe({
      model: "v6-max",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 16,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.meta?.max).toBe(15);
  });

  test("refuses template_id, which v6 takes", () => {
    const base = {
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      template_id: 302325299692608,
    } as const;
    expect(video.safe({ ...base, model: "v6" }).ok).toBe(true);

    const text = video.safe({ ...base, model: "v6-max" });
    expect(text.ok).toBe(false);
    if (!text.ok) {
      const issue = text.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["template_id"]);
      expect(issue?.message).toContain("c1, v6, v5.6, v5");
    }

    const image = videoFromImage.safe({
      model: "v6-max",
      img_id: 1,
      template_id: 302325299692608,
      prompt: "hi",
      quality: "720p",
      duration: 5,
    });
    expect(image.ok).toBe(false);
    if (!image.ok) {
      expect(image.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "template_id",
      ]);
    }
  });
});

describe("pixverse.video cost estimation", () => {
  test("v6 bills per second by quality and audio", () => {
    const silent = video.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
    });
    expect(silent.ok).toBe(true);
    // 9 cr/s × 5 at "225 Credits = USD 1" — the page's own "US$0.040/s" × 5.
    if (silent.ok) expect(silent.estimate.costUSD).toBeCloseTo(45 / 225, 10);

    const withAudio = video.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      generate_audio_switch: true,
    });
    expect(withAudio.ok).toBe(true);
    if (withAudio.ok) expect(withAudio.estimate.costUSD).toBeCloseTo(60 / 225, 10); // 12 cr/s × 5
  });

  test("v5.5 uses the fixed per-generation table, incl. the multi-clip column", () => {
    const single = video.safe({
      model: "v5.5",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 8,
    });
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.estimate.costUSD).toBeCloseTo(120 / 225, 10); // 120 credits

    const multi = video.safe({
      model: "v5.5",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 8,
      generate_audio_switch: true,
      generate_multi_clip_switch: true,
    });
    expect(multi.ok).toBe(true);
    if (multi.ok) expect(multi.estimate.costUSD).toBeCloseTo(160 / 225, 10); // 160 credits
  });

  test("v5.6 at 5 seconds adds a flat 45 credits for audio", () => {
    const r = video.safe({
      model: "v5.6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      generate_audio_switch: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(90 / 225, 10); // "**90 Credits**<br>US$0.400"
  });

  test("over-budget is reported", () => {
    // 18 cr/s × 15 = 270 credits = $1.20.
    const r = video.safe(
      { model: "v6", prompt: "hi", aspect_ratio: "16:9", quality: "1080p", duration: 15 },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });
});

describe("pixverse.videoFromImage", () => {
  test("wire-pure body with the upload id", () => {
    const v = videoFromImage({
      model: "v6",
      img_id: 12345,
      prompt: "the camera pushes in",
      quality: "720p",
      duration: 5,
    });
    expect(v.request.url).toBe(IMAGE_TO_VIDEO_URL);
    expect(Object.keys(v)).toEqual(["model", "img_id", "prompt", "quality", "duration"]);
  });

  test("img_ids needs a template_id, which then stands in for img_id", () => {
    const r = videoFromImage.safe({
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
    // A multi-image template takes the ordered `img_ids` and no `img_id`.
    const template = videoFromImage.safe({
      model: "v6",
      img_ids: [1, 2],
      template_id: 302325299692608,
      prompt: "hi",
      quality: "720p",
      duration: 5,
    });
    expect(template.ok).toBe(true);
    if (template.ok) expect(template.warnings).toEqual([]);
  });

  test("img_id is required when there is no template_id", () => {
    // @ts-expect-error — without `template_id`, the type requires `img_id` too.
    const r = videoFromImage.safe({ model: "v6", prompt: "hi", quality: "720p", duration: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["img_id"]);
      expect(issue?.message).toContain("POST /openapi/v2/image/upload");
    }
  });

  test("prompt is capped at 2048 characters, not text-to-video's 5000", () => {
    const base = { model: "v6", img_id: 1, quality: "720p", duration: 5 } as const;
    expect(videoFromImage.safe({ ...base, prompt: "a".repeat(2048) }).ok).toBe(true);
    const over = videoFromImage.safe({ ...base, prompt: "a".repeat(2049) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.path).toEqual(["prompt"]);
    expect(
      video.safe({
        model: "v6",
        prompt: "a".repeat(2049),
        aspect_ratio: "16:9",
        quality: "720p",
        duration: 5,
      }).ok,
    ).toBe(true);
  });

  test("lip_sync_switch is typed and v5-and-below only", () => {
    const base = { img_id: 1, prompt: "hi", quality: "720p", duration: 5 } as const;
    const legacy = videoFromImage.safe({ ...base, model: "v5", lip_sync_switch: true });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.warnings).toEqual([]);

    const modern = videoFromImage.safe({ ...base, model: "v6", lip_sync_switch: true });
    expect(modern.ok).toBe(false);
    if (!modern.ok) {
      const issue = modern.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["lip_sync_switch"]);
      expect(issue?.meta?.supported).toEqual(["v5", "v4.5", "v4", "v3.5"]);
    }
  });

  test("a switch sent as its default `false` passes on any model", () => {
    const base = { img_id: 1, prompt: "hi", quality: "720p", duration: 5 } as const;
    for (const model of ["c1", "v6-max"] as const) {
      const r = videoFromImage.safe({ ...base, model, generate_multi_clip_switch: false });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    expect(videoFromImage.safe({ ...base, model: "v5", generate_audio_switch: false }).ok).toBe(true);
    expect(videoFromImage.safe({ ...base, model: "v6", lip_sync_switch: false }).ok).toBe(true);
    // `true` stays gated.
    expect(videoFromImage.safe({ ...base, model: "c1", generate_multi_clip_switch: true }).ok).toBe(
      false,
    );
  });

  test("a template task refuses a `true` multi-clip switch", () => {
    const template = {
      img_id: 1,
      template_id: 302325299692608,
      prompt: "hi",
      quality: "720p",
      duration: 5,
    } as const;
    for (const model of ["v6", "v5.5"] as const) {
      const r = videoFromImage.safe({ ...template, model, generate_multi_clip_switch: true });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => e.path)).toEqual([["generate_multi_clip_switch"]]);
        expect(r.errors[0]?.message).toContain("`template_id`");
      }
    }
    // A model outside the gate gets the model refusal alone, not a second issue.
    const v56 = videoFromImage.safe({ ...template, model: "v5.6", generate_multi_clip_switch: true });
    expect(v56.ok).toBe(false);
    if (!v56.ok) {
      expect(v56.errors).toHaveLength(1);
      expect(v56.errors[0]?.meta?.supported).toEqual(["v5.5", "v6"]);
    }

    expect(
      videoFromImage.safe({ ...template, model: "v6", generate_multi_clip_switch: false }).ok,
    ).toBe(true);
    const ordinary = videoFromImage.safe({
      model: "v6",
      img_id: 1,
      prompt: "hi",
      quality: "720p",
      duration: 5,
      generate_multi_clip_switch: true,
    });
    expect(ordinary.ok).toBe(true);
  });

  test("a template_id lifts the sound-effect / lip-sync gate, on this route only", () => {
    const base = { img_id: 1, prompt: "hi", quality: "720p", duration: 5 } as const;
    const template = videoFromImage.safe({
      ...base,
      model: "v6",
      template_id: 302325299692608,
      sound_effect_switch: true,
    });
    expect(template.ok).toBe(true);
    if (template.ok) expect(template.warnings).toEqual([]);

    const ordinary = videoFromImage.safe({ ...base, model: "v6", sound_effect_switch: true });
    expect(ordinary.ok).toBe(false);
    if (!ordinary.ok) {
      const issue = ordinary.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["sound_effect_switch"]);
      expect(issue?.message).toContain("or with a `template_id`");
    }

    // The lift cannot reopen v6-max, which refuses the template itself.
    const max = videoFromImage.safe({
      ...base,
      model: "v6-max",
      template_id: 302325299692608,
      sound_effect_switch: true,
    });
    expect(max.ok).toBe(false);
    if (!max.ok) expect(max.errors.map((e) => e.path)).toEqual([["template_id"]]);

    // Text-to-video documents only "Supported in v5 models and below".
    const text = video.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      template_id: 302325299692608,
      lip_sync_tts_switch: true,
    });
    expect(text.ok).toBe(false);
    if (!text.ok) {
      expect(text.errors.map((e) => e.path)).toEqual([["lip_sync_tts_switch"]]);
    }
  });

  test("v4.5 / v4 / v3.5 have no published rate, so no estimate", () => {
    for (const model of ["v4.5", "v4", "v3.5"] as const) {
      const r = videoFromImage.safe({ model, img_id: 1, prompt: "hi", quality: "720p", duration: 5 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });
});

describe("webhook_id", () => {
  test("is a typed field on both routes", () => {
    const text = video.safe({
      model: "v6",
      prompt: "hi",
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
      webhook_id: "replace-with-your-webhook-id",
    });
    expect(text.ok).toBe(true);
    if (text.ok) expect(text.warnings).toEqual([]);

    const image = videoFromImage.safe({
      model: "v6",
      img_id: 1,
      prompt: "hi",
      quality: "720p",
      duration: 5,
      webhook_id: "replace-with-your-webhook-id",
    });
    expect(image.ok).toBe(true);
    if (image.ok) expect(image.warnings).toEqual([]);
  });
});
