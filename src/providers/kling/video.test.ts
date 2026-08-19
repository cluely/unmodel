import { describe, expect, test } from "bun:test";
import { video, TEXT2VIDEO_URL } from "./video";
import { videoFromImage, IMAGE2VIDEO_URL } from "./video-from-image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("kling.video happy path", () => {
  test("wire-pure body with URL and method", () => {
    const v = video({
      model_name: "kling-v2-6",
      prompt: "a slow push-in through a rainy neon alley",
      mode: "pro",
      duration: "10",
    });
    expect(Object.keys(v)).toEqual(["model_name", "prompt", "mode", "duration"]);
    expect(v.request.url).toBe(TEXT2VIDEO_URL);
    expect(v.request.method).toBe("POST");
  });

  test("model_name defaults to kling-v1", () => {
    const r = video.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    // kling-v1 at 720P/5s: $0.028/s × 5.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.14, 10);
  });

  test("path-segment model ids are unknown on the /v1 route", () => {
    const r = video.safe({ model_name: "kling-3.0", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("kling.video capability gates", () => {
  test("kling-v2-1 is image-to-video only", () => {
    const r = video.safe({ model_name: "kling-v2-1", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model_name"]);
      expect(issue?.meta?.supported).not.toContain("kling-v2-1");
    }
  });

  test("camera_control is kling-v1 only", () => {
    expect(
      video.safe({
        model_name: "kling-v1",
        prompt: "hi",
        camera_control: { type: "down_back" },
      }).ok,
    ).toBe(true);

    const r = video.safe({
      model_name: "kling-v1-6",
      prompt: "hi",
      camera_control: { type: "down_back" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_capability")?.path).toEqual([
        "camera_control",
      ]);
    }
  });

  test("cfg_scale is not supported on the kling-v2.x models", () => {
    const r = video.safe({ model_name: "kling-v2-6", prompt: "hi", cfg_scale: 0.7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["cfg_scale"]);

    expect(video.safe({ model_name: "kling-v1-6", prompt: "hi", cfg_scale: 0.7 }).ok).toBe(
      true,
    );
  });

  test("native audio is kling-v3 / kling-v2-6 only", () => {
    expect(video.safe({ model_name: "kling-v3", prompt: "hi", sound: "on" }).ok).toBe(true);

    const r = video.safe({ model_name: "kling-v2-5-turbo", prompt: "hi", sound: "on" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["sound"]);
  });

  test("the master models are 1080P-only", () => {
    const r = video.safe({ model_name: "kling-v2-master", prompt: "hi", mode: "std" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["mode"]);
      expect(issue?.meta?.allowed).toEqual(["pro"]);
    }
  });

  test("duration is a string on this route and per-model", () => {
    const r = video.safe({ model_name: "kling-v2-5-turbo", prompt: "hi", duration: "8" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toEqual(["5", "10"]);

    expect(video.safe({ model_name: "kling-v3", prompt: "hi", duration: "8" }).ok).toBe(true);
  });
});

describe("kling.video shape rules", () => {
  test("multi_shot needs a shot_type, and customize needs multi_prompt", () => {
    const noType = video.safe({ model_name: "kling-v3", prompt: "hi", multi_shot: true });
    expect(noType.ok).toBe(false);
    if (!noType.ok) expect(noType.errors.map((e) => e.path[0])).toContain("shot_type");

    const customize = video.safe({
      model_name: "kling-v3",
      prompt: "hi",
      multi_shot: true,
      shot_type: "customize",
    });
    expect(customize.ok).toBe(false);
    if (!customize.ok) expect(customize.errors.map((e) => e.path[0])).toContain("multi_prompt");

    expect(
      video.safe({
        model_name: "kling-v3",
        multi_shot: true,
        shot_type: "customize",
        multi_prompt: [{ index: 1, prompt: "shot one", duration: "5" }],
      }).ok,
    ).toBe(true);
  });

  test("prompt is required when multi_shot is off", () => {
    const r = video.safe({ model_name: "kling-v3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toContain("prompt");
  });

  test("simple camera control takes exactly one non-zero axis", () => {
    expect(
      video.safe({
        model_name: "kling-v1",
        prompt: "hi",
        camera_control: { type: "simple", config: { pan: 5, tilt: 0 } },
      }).ok,
    ).toBe(true);

    const two = video.safe({
      model_name: "kling-v1",
      prompt: "hi",
      camera_control: { type: "simple", config: { pan: 5, zoom: 2 } },
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0]?.path).toEqual(["camera_control", "config"]);

    const preset = video.safe({
      model_name: "kling-v1",
      prompt: "hi",
      camera_control: { type: "forward_up", config: { pan: 1 } },
    });
    expect(preset.ok).toBe(false);
    if (!preset.ok) expect(preset.errors[0]?.code).toBe("unsupported_param");
  });

  test("camera axes are bounded to -10..10", () => {
    const r = safeUnchecked({
      model_name: "kling-v1",
      prompt: "hi",
      camera_control: { type: "simple", config: { pan: 11 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("kling.videoFromImage", () => {
  test("wire-pure body with a start frame", () => {
    const v = videoFromImage({
      model_name: "kling-v2-1",
      image: "https://example.com/frame.png",
      prompt: "she turns to the window",
      mode: "pro",
      duration: "5",
    });
    // `model_name` is a BODY field on this route: nothing is stripped.
    expect(Object.keys(v)).toEqual(["model_name", "image", "prompt", "mode", "duration"]);
    expect(v.request.url).toBe(IMAGE2VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    // kling-v2-1 at 1080P: $0.098/s × 5.
    const r = videoFromImage.safe({
      model_name: "kling-v2-1",
      image: "https://example.com/frame.png",
      prompt: "hi",
      mode: "pro",
      duration: "5",
    });
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.49, 10);
  });

  test("needs a start or end frame", () => {
    const r = videoFromImage.safe({ model_name: "kling-v1-6", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toContain("image");
  });

  test("image_tail, masks and camera_control are mutually exclusive", () => {
    const r = videoFromImage.safe({
      model_name: "kling-v1",
      image: "https://example.com/a.png",
      image_tail: "https://example.com/b.png",
      prompt: "hi",
      camera_control: { type: "down_back" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.meta?.conflicting).toEqual(["image_tail", "camera_control"]);
    }
  });

  test("element_list and voice_list cannot coexist and are capped", () => {
    const both = videoFromImage.safe({
      model_name: "kling-v3",
      image: "https://example.com/a.png",
      prompt: "hi",
      element_list: [{ element_id: 1 }],
      voice_list: [{ voice_id: "v1" }],
    });
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["voice_list"]);
    }

    const tooMany = videoFromImage.safe({
      model_name: "kling-v3",
      image: "https://example.com/a.png",
      prompt: "hi",
      element_list: [{ element_id: 1 }, { element_id: 2 }, { element_id: 3 }, { element_id: 4 }],
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(3);
    }
  });

  test("every KlingV1Duration preset passes on the model that offers the range", () => {
    // Keep in sync with KlingV1Duration in v1-routes.ts — the union is the
    // widest documented range (THREE_TO_FIFTEEN, kling-v3's 3–15s), so every
    // preset must validate on kling-v3; V1_MODEL_RULES narrows it elsewhere.
    const presets = [
      "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    ] as const;
    for (const duration of presets) {
      const t2v = video.safe({ model_name: "kling-v3", prompt: "hi", duration });
      expect(t2v.ok, `text2video preset ${duration} should validate`).toBe(true);
      if (t2v.ok) expect(t2v.warnings, `text2video preset ${duration}`).toEqual([]);

      const i2v = videoFromImage.safe({
        model_name: "kling-v3",
        image: "https://example.com/a.png",
        prompt: "hi",
        duration,
      });
      expect(i2v.ok, `image2video preset ${duration} should validate`).toBe(true);
      if (i2v.ok) expect(i2v.warnings, `image2video preset ${duration}`).toEqual([]);
    }
  });

  test("kling-v1-5 is accepted here but not on video", () => {
    expect(
      videoFromImage.safe({
        model_name: "kling-v1-5",
        image: "https://example.com/a.png",
        prompt: "hi",
      }).ok,
    ).toBe(true);
    expect(video.safe({ model_name: "kling-v1-5", prompt: "hi" }).ok).toBe(false);
  });
});
