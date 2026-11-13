import { describe, expect, test } from "bun:test";
import { videoV3, textToVideoV3Url, TEXT_TO_VIDEO_V3_RULES } from "./video-v3";
import { videoV3FromImage, imageToVideoV3Url, IMAGE_TO_VIDEO_V3_RULES } from "./video-v3-from-image";
import { videoOmni, omniVideoUrl, OMNI_VIDEO_RULES } from "./video-omni";
import {
  DURATIONS_3_30,
  KLING_AUDIO_MODES,
  KLING_BASE_URL,
  KLING_RESOLUTIONS,
} from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = videoV3.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("kling.videoV3 happy path", () => {
  test("model is stripped from the body into the URL path", () => {
    const v = videoV3({
      model: "kling-3.0",
      prompt: "a girl on a train watching the fields go by",
      settings: { resolution: "1080p", aspect_ratio: "16:9", duration: 10 },
    });
    expect(Object.keys(v)).toEqual(["prompt", "settings"]);
    expect(v.request.url).toBe(`${KLING_BASE_URL}/text-to-video/kling-3.0`);
    expect(v.request.url).toBe(textToVideoV3Url("kling-3.0"));
    expect(v.request.method).toBe("POST");
  });

  test("unknown model warns but validates", () => {
    const r = videoV3.safe({ model: "kling-9.9", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("the corroborated model_name spellings are unknown on this route", () => {
    const r = videoV3.safe({ model: "kling-v3", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("kling.videoV3 settings rules", () => {
  test("4K is a Kling 3.0-only tier", () => {
    expect(
      videoV3.safe({ model: "kling-3.0", prompt: "hi", settings: { resolution: "4k" } }).ok,
    ).toBe(true);

    const turbo = videoV3.safe({
      model: "kling-3.0-turbo",
      prompt: "hi",
      settings: { resolution: "4k" },
    });
    expect(turbo.ok).toBe(false);
    if (!turbo.ok) {
      const issue = turbo.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["settings", "resolution"]);
      expect(issue?.meta?.allowed).toEqual(["720p", "1080p"]);
    }
  });

  test("2.6 and 2.5-turbo only offer 5s and 10s", () => {
    const r = videoV3.safe({
      model: "kling-2.6",
      prompt: "hi",
      settings: { duration: 8 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toEqual([5, 10]);

    expect(
      videoV3.safe({ model: "kling-3.0", prompt: "hi", settings: { duration: 8 } }).ok,
    ).toBe(true);
  });

  test("audio and multi_shot are per-model switches", () => {
    const audio = videoV3.safe({
      model: "kling-2.5-turbo",
      prompt: "hi",
      settings: { audio: "native" },
    });
    expect(audio.ok).toBe(false);
    if (!audio.ok) {
      expect(audio.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "settings",
        "audio",
      ]);
    }

    const multiShot = videoV3.safe({
      model: "kling-2.6",
      prompt: "hi",
      settings: { multi_shot: true },
    });
    expect(multiShot.ok).toBe(false);
    if (!multiShot.ok) {
      expect(multiShot.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "settings",
        "multi_shot",
      ]);
    }
  });

  test("every KlingResolution / KlingDuration preset passes on Kling 3.0", () => {
    // Keep in sync with KlingResolution and KlingDuration in shared.ts —
    // kling-3.0 is the model that offers both sets whole on these two routes
    // (720p/1080p/4k and 3–15s); TEXT_TO_VIDEO_V3_RULES /
    // IMAGE_TO_VIDEO_V3_RULES narrow them for the other models.
    const resolutions = ["720p", "1080p", "4k"] as const;
    const durations = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
    const frame = [{ type: "first_frame", url: "https://example.com/a.png" }] as const;

    for (const resolution of resolutions) {
      const t2v = videoV3.safe({ model: "kling-3.0", prompt: "hi", settings: { resolution } });
      expect(t2v.ok, `text-to-video ${resolution} should validate`).toBe(true);
      if (t2v.ok) expect(t2v.warnings, `text-to-video ${resolution}`).toEqual([]);

      const i2v = videoV3FromImage.safe({
        model: "kling-3.0",
        contents: [...frame],
        settings: { resolution },
      });
      expect(i2v.ok, `image-to-video ${resolution} should validate`).toBe(true);
      if (i2v.ok) expect(i2v.warnings, `image-to-video ${resolution}`).toEqual([]);
    }
    for (const duration of durations) {
      const t2v = videoV3.safe({ model: "kling-3.0", prompt: "hi", settings: { duration } });
      expect(t2v.ok, `text-to-video ${duration}s should validate`).toBe(true);
      if (t2v.ok) expect(t2v.warnings, `text-to-video ${duration}s`).toEqual([]);

      const i2v = videoV3FromImage.safe({
        model: "kling-3.0",
        contents: [...frame],
        settings: { duration },
      });
      expect(i2v.ok, `image-to-video ${duration}s should validate`).toBe(true);
      if (i2v.ok) expect(i2v.warnings, `image-to-video ${duration}s`).toEqual([]);
    }
  });

  test("these routes offer two of the three KlingAudio modes", () => {
    // Keep in sync with KlingAudio in shared.ts: the union carries every
    // documented mode, and "original" (keep the input video's audio) belongs
    // to omni-video alone — here it is narrowed away at runtime.
    for (const audio of ["native", "off"] as const) {
      const r = videoV3.safe({ model: "kling-3.0", prompt: "hi", settings: { audio } });
      expect(r.ok, `audio ${audio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `audio ${audio}`).toEqual([]);
    }

    const original = videoV3.safe({
      model: "kling-3.0",
      prompt: "hi",
      settings: { audio: "original" },
    });
    expect(original.ok).toBe(false);
    if (!original.ok) {
      const issue = original.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["settings", "audio"]);
      expect(issue?.meta?.allowed).toEqual(["native", "off"]);
    }
  });

  test("prompt caps at 3072 characters", () => {
    const r = safeUnchecked({ model: "kling-3.0", prompt: "a".repeat(3073) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });
});

describe("kling.videoV3 cost estimation", () => {
  test("silent and native-audio tiers differ", () => {
    const silent = videoV3.safe({
      model: "kling-3.0",
      prompt: "hi",
      settings: { resolution: "1080p", duration: 10 },
    });
    expect(silent.ok).toBe(true);
    if (silent.ok) expect(silent.estimate.costUSD).toBeCloseTo(1.12, 10); // $0.112/s

    const audio = videoV3.safe({
      model: "kling-3.0",
      prompt: "hi",
      settings: { resolution: "1080p", duration: 10, audio: "native" },
    });
    expect(audio.ok).toBe(true);
    if (audio.ok) expect(audio.estimate.costUSD).toBeCloseTo(1.68, 10); // $0.168/s
  });

  test("defaults to 720p × 5s when settings are omitted", () => {
    const r = videoV3.safe({ model: "kling-2.5-turbo", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.21, 10); // $0.042/s × 5
  });

  test("Kling 2.6 has no published 720p native-audio rate", () => {
    const r = videoV3.safe({
      model: "kling-2.6",
      prompt: "hi",
      settings: { resolution: "720p", duration: 5, audio: "native" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("kling.videoV3FromImage", () => {
  test("wire-pure body on the model-scoped URL", () => {
    const v = videoV3FromImage({
      model: "kling-2.6",
      contents: [
        { type: "prompt", text: "she turns to the window" },
        { type: "first_frame", url: "https://example.com/frame.png" },
      ],
      settings: { resolution: "1080p", duration: 10 },
    });
    expect(Object.keys(v)).toEqual(["contents", "settings"]);
    expect(v.request.url).toBe(imageToVideoV3Url("kling-2.6"));
  });

  test("a first frame is required", () => {
    const r = videoV3FromImage.safe({
      model: "kling-3.0",
      contents: [{ type: "last_frame", url: "https://example.com/end.png" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_shape")?.message).toContain(
        "last-frame-only",
      );
    }
  });

  test("content types are per model", () => {
    const r = videoV3FromImage.safe({
      model: "kling-3.0-turbo",
      contents: [
        { type: "first_frame", url: "https://example.com/a.png" },
        { type: "last_frame", url: "https://example.com/b.png" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["contents", 1, "type"]);
      expect(issue?.meta?.allowed).toEqual(["prompt", "first_frame"]);
    }
  });

  test("aspect_ratio has no place on this route", () => {
    // The field is a compile error on ImageToVideoSettings; JS callers that
    // send it anyway get the runtime report.
    const safeI2v = videoV3FromImage.safe as unknown as (
      params: unknown,
    ) => ValidateResult<Record<string, unknown>>;
    const r = safeI2v({
      model: "kling-3.0",
      contents: [{ type: "first_frame", url: "https://example.com/a.png" }],
      settings: { aspect_ratio: "16:9" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "settings",
        "aspect_ratio",
      ]);
    }
  });

  test("at most 3 Elements per task", () => {
    const r = videoV3FromImage.safe({
      model: "kling-3.0",
      contents: [
        { type: "first_frame", url: "https://example.com/a.png" },
        { type: "element", element_id: "1", id: "e1" },
        { type: "element", element_id: "2", id: "e2" },
        { type: "element", element_id: "3", id: "e3" },
        { type: "element", element_id: "4", id: "e4" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(3);
  });
});

describe("kling.videoOmni", () => {
  test("model is stripped from the body into the URL path", () => {
    const v = videoOmni({
      model: "kling-3.0-omni",
      contents: [
        { type: "prompt", text: "restyle the clip as a rainy night scene" },
        { type: "base_video", url: "https://example.com/clip.mp4" },
      ],
      settings: { resolution: "1080p", duration: 8 },
      options: { external_task_id: "job-1" },
    });
    expect(Object.keys(v)).toEqual(["contents", "settings", "options"]);
    expect(Object.keys(v)).not.toContain("model");
    expect(v.request.url).toBe(`${KLING_BASE_URL}/omni-video/kling-3.0-omni`);
    expect(v.request.url).toBe(omniVideoUrl("kling-3.0-omni"));
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    // toSdk("kling") is wire-shaped here, so it must not resurrect `model` either.
    expect(Object.keys(v.toSdk("kling") as object)).not.toContain("model");
  });

  test("a video input picks the dearer billing tier", () => {
    const noVideo = videoOmni.safe({
      model: "kling-3.0-omni",
      contents: [{ type: "prompt", text: "hi" }],
      settings: { resolution: "1080p", duration: 10 },
    });
    expect(noVideo.ok).toBe(true);
    if (noVideo.ok) expect(noVideo.estimate.costUSD).toBeCloseTo(1.12, 10); // $0.112/s

    const withVideo = videoOmni.safe({
      model: "kling-3.0-omni",
      contents: [
        { type: "prompt", text: "hi" },
        { type: "base_video", url: "https://example.com/clip.mp4" },
      ],
      settings: { resolution: "1080p", duration: 10 },
    });
    expect(withVideo.ok).toBe(true);
    if (withVideo.ok) expect(withVideo.estimate.costUSD).toBeCloseTo(1.68, 10); // $0.168/s
  });

  test("kling-o1 caps at 1080p and 10 seconds and has no native audio mode", () => {
    expect(omniVideoUrl("kling-o1")).toBe(`${KLING_BASE_URL}/omni-video/kling-o1`);

    const r = videoOmni.safe({
      model: "kling-o1",
      contents: [{ type: "prompt", text: "hi" }],
      settings: { resolution: "4k", duration: 15, audio: "native" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path.join("."));
      expect(paths).toContain("settings.resolution");
      expect(paths).toContain("settings.duration");
      expect(paths).toContain("settings.audio");
    }
  });

  test("every KlingResolution / KlingDuration / KlingAudio preset passes here", () => {
    // Keep in sync with KlingResolution, KlingDuration and KlingAudio in
    // shared.ts. kling-3.0-omni is the one model that offers all three sets
    // whole (720p/1080p/4k, 3–15s, native/original/off); the other models
    // narrow them per the route rule tables.
    const resolutions = ["720p", "1080p", "4k"] as const;
    const durations = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
    const audioModes = ["native", "original", "off"] as const;
    const model = "kling-3.0-omni";
    const contents = () => [{ type: "prompt", text: "hi" }];

    for (const resolution of resolutions) {
      const r = videoOmni.safe({ model, contents: contents(), settings: { resolution } });
      expect(r.ok, `resolution ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `resolution ${resolution}`).toEqual([]);
    }
    for (const duration of durations) {
      const r = videoOmni.safe({ model, contents: contents(), settings: { duration } });
      expect(r.ok, `duration ${duration} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `duration ${duration}`).toEqual([]);
    }
    for (const audio of audioModes) {
      const r = videoOmni.safe({ model, contents: contents(), settings: { audio } });
      expect(r.ok, `audio ${audio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `audio ${audio}`).toEqual([]);
    }
  });

  test("3.0 Omni and O1 take up to 7 Elements — the ceiling of every documented case", () => {
    const elements = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ type: "element", element_id: `${i}`, id: `e${i}` }));
    const prompt = { type: "prompt", text: "hi" };
    for (const model of ["kling-3.0-omni", "kling-o1"] as const) {
      expect(videoOmni.safe({ model, contents: [prompt, ...elements(7)] }).ok, model).toBe(true);
      const eight = videoOmni.safe({ model, contents: [prompt, ...elements(8)] });
      expect(eight.ok, model).toBe(false);
      if (!eight.ok) expect(eight.errors[0]?.meta?.max).toBe(7);
    }
  });

  test("the text-to-video-only models have no omni route", () => {
    const r = videoOmni.safe({
      model: "kling-2.6",
      contents: [{ type: "prompt", text: "hi" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.meta?.supported).toEqual([
        "kling-3.0-omni",
        "kling-o1",
        "kling-4.0",
        "kling-4.0-flash",
      ]);
    }
  });
});

describe("Kling 4.0 / 4.0 Flash", () => {
  const frame = (type: string, url = "https://example.com/a.png") => ({ type, url });
  const prompt = { type: "prompt", text: "hi" } as const;

  test("both ids validate on all three routes with no warning", () => {
    for (const model of ["kling-4.0", "kling-4.0-flash"] as const) {
      const t2v = videoV3.safe({ model, prompt: "hi", settings: { duration: 10 } });
      expect(t2v.ok, `${model} text-to-video`).toBe(true);
      if (t2v.ok) expect(t2v.warnings, model).toEqual([]);
      expect(t2v.ok && t2v.params.request.url).toBe(textToVideoV3Url(model));

      const i2v = videoV3FromImage.safe({ model, contents: [prompt, frame("first_frame")] });
      expect(i2v.ok, `${model} image-to-video`).toBe(true);
      if (i2v.ok) expect(i2v.warnings, model).toEqual([]);

      const omni = videoOmni.safe({ model, contents: [prompt, frame("refer_image")] });
      expect(omni.ok, `${model} omni-video`).toBe(true);
      if (omni.ok) expect(omni.warnings, model).toEqual([]);
    }
  });

  test("they price per second at their default resolution", () => {
    // $0.235/s at 4.0's default 1080p; $0.157/s at 720p.
    const four = videoV3.safe({ model: "kling-4.0", prompt: "hi", settings: { duration: 10 } });
    expect(four.ok && four.estimate.costUSD).toBeCloseTo(2.35, 10);
    const four720 = videoV3.safe({
      model: "kling-4.0",
      prompt: "hi",
      settings: { duration: 10, resolution: "720p" },
    });
    expect(four720.ok && four720.estimate.costUSD).toBeCloseTo(1.57, 10);
    // Flash is 720p only: $0.094/s.
    const flash = videoV3.safe({ model: "kling-4.0-flash", prompt: "hi", settings: { duration: 10 } });
    expect(flash.ok && flash.estimate.costUSD).toBeCloseTo(0.94, 10);
  });

  test("an omitted duration has no estimate — the prompt sets it", () => {
    const r = videoV3.safe({ model: "kling-4.0", prompt: "Generate a 15-second video of a fox" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("a video input bills a total duration of at least output × 2 — a floor", () => {
    const r = videoOmni.safe({
      model: "kling-4.0",
      contents: [prompt, frame("base_video", "https://example.com/clip.mp4")],
      settings: { duration: 10 },
    });
    // $0.141/s × (10 × 2) at 1080p.
    expect(r.ok && r.estimate.costUSD).toBeCloseTo(2.82, 10);
    const flash = videoOmni.safe({
      model: "kling-4.0-flash",
      contents: [prompt, frame("feature_video", "https://example.com/clip.mp4")],
      settings: { duration: 10 },
    });
    // $0.063/s × (10 × 2).
    expect(flash.ok && flash.estimate.costUSD).toBeCloseTo(1.26, 10);
  });

  test("durations run 3–30 on 4.0 and 3–20 on Flash", () => {
    expect(videoV3.safe({ model: "kling-4.0", prompt: "hi", settings: { duration: 30 } }).ok).toBe(true);
    const over = safeUnchecked({ model: "kling-4.0", prompt: "hi", settings: { duration: 31 } });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.path).toEqual(["settings", "duration"]);

    expect(
      videoV3.safe({ model: "kling-4.0-flash", prompt: "hi", settings: { duration: 20 } }).ok,
    ).toBe(true);
    const flash = videoV3.safe({ model: "kling-4.0-flash", prompt: "hi", settings: { duration: 21 } });
    expect(flash.ok).toBe(false);
    if (!flash.ok) expect(flash.errors[0]?.meta?.allowed).toHaveLength(18);
  });

  test("Flash is 720p only, and neither takes 4K", () => {
    const flash = videoV3.safe({
      model: "kling-4.0-flash",
      prompt: "hi",
      settings: { resolution: "1080p" },
    });
    expect(flash.ok).toBe(false);
    if (!flash.ok) expect(flash.errors[0]?.meta?.allowed).toEqual(["720p"]);
    expect(
      videoV3.safe({ model: "kling-4.0", prompt: "hi", settings: { resolution: "4k" } }).ok,
    ).toBe(false);
  });

  test("21:9 is theirs, and adaptive is their omni route's", () => {
    expect(
      videoV3.safe({ model: "kling-4.0", prompt: "hi", settings: { aspect_ratio: "21:9" } }).ok,
    ).toBe(true);
    const older = videoV3.safe({ model: "kling-3.0", prompt: "hi", settings: { aspect_ratio: "21:9" } });
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.errors[0]?.path).toEqual(["settings", "aspect_ratio"]);

    expect(
      videoOmni.safe({
        model: "kling-4.0-flash",
        contents: [prompt],
        settings: { aspect_ratio: "adaptive" },
      }).ok,
    ).toBe(true);
    const t2v = videoV3.safe({ model: "kling-4.0", prompt: "hi", settings: { aspect_ratio: "adaptive" } });
    expect(t2v.ok).toBe(false);
    if (!t2v.ok) expect(t2v.errors[0]?.meta?.allowed).toEqual(["21:9", "16:9", "9:16", "1:1"]);
  });

  test("omni audio is native or original — there is no off; t2v and i2v have no switch", () => {
    const clip = frame("base_video", "https://example.com/clip.mp4");
    expect(
      videoOmni.safe({ model: "kling-4.0", contents: [prompt, clip], settings: { audio: "original" } })
        .ok,
    ).toBe(true);
    const off = videoOmni.safe({ model: "kling-4.0", contents: [prompt], settings: { audio: "off" } });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.errors[0]?.meta?.allowed).toEqual(["native", "original"]);

    const t2v = videoV3.safe({ model: "kling-4.0", prompt: "hi", settings: { audio: "native" } });
    expect(t2v.ok).toBe(false);
    if (!t2v.ok) expect(t2v.errors[0]?.code).toBe("unsupported_param");
  });

  test('omni audio "original" needs a base or feature video, and takes no voice', () => {
    const original = { audio: "original" } as const;
    const base = frame("base_video", "https://example.com/clip.mp4");
    const feature = frame("feature_video", "https://example.com/clip.mp4");
    for (const model of ["kling-4.0", "kling-4.0-flash"] as const) {
      expect(videoOmni.safe({ model, contents: [prompt, base], settings: original }).ok, model).toBe(
        true,
      );
      expect(
        videoOmni.safe({ model, contents: [prompt, feature], settings: original }).ok,
        model,
      ).toBe(true);
      const bare = videoOmni.safe({ model, contents: [prompt], settings: original });
      expect(bare.ok, model).toBe(false);
      if (!bare.ok) {
        expect(bare.errors).toHaveLength(1);
        expect(bare.errors[0]).toMatchObject({ code: "invalid_shape", path: ["settings", "audio"] });
      }
      // "native" asks for nothing from the inputs.
      expect(
        videoOmni.safe({ model, contents: [prompt], settings: { audio: "native" } }).ok,
        model,
      ).toBe(true);
    }

    const voice = { type: "voice", voice_id: "v-1", id: "voice_1" };
    const voiced = videoOmni.safe({
      model: "kling-4.0",
      contents: [prompt, base, voice],
      settings: original,
    });
    expect(voiced.ok).toBe(false);
    if (!voiced.ok) {
      expect(voiced.errors).toHaveLength(1);
      expect(voiced.errors[0]).toMatchObject({ code: "invalid_shape", path: ["contents", 2] });
    }
  });

  test("4.0's image route takes middle frames and needs no first frame; Flash needs one", () => {
    const keyframes = videoV3FromImage.safe({
      model: "kling-4.0",
      contents: [prompt, frame("middle_frame"), frame("last_frame")],
    });
    expect(keyframes.ok).toBe(true);
    if (keyframes.ok) expect(keyframes.warnings).toEqual([]);

    const flash = videoV3FromImage.safe({
      model: "kling-4.0-flash",
      contents: [prompt, frame("middle_frame")],
    });
    expect(flash.ok).toBe(false);
    if (!flash.ok) {
      expect(flash.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([
        "prompt",
        "first_frame",
      ]);
      expect(flash.errors.find((e) => e.code === "invalid_shape")?.message).toContain(
        "first_frame",
      );
    }
  });

  test("4.0's omni route takes voices; Flash's takes none", () => {
    const voice = { type: "voice", voice_id: "v-1", id: "voice_1" };
    expect(videoOmni.safe({ model: "kling-4.0", contents: [prompt, voice] }).ok).toBe(true);
    const flash = videoOmni.safe({ model: "kling-4.0-flash", contents: [prompt, voice] });
    expect(flash.ok).toBe(false);
    if (!flash.ok) expect(flash.errors[0]?.path).toEqual(["contents", 1, "type"]);
  });

  test("their omni route takes up to 7 Elements", () => {
    const elements = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ type: "element", element_id: `${i}`, id: `e${i}` }));
    expect(videoOmni.safe({ model: "kling-4.0", contents: [prompt, ...elements(7)] }).ok).toBe(true);
    const eight = videoOmni.safe({ model: "kling-4.0-flash", contents: [prompt, ...elements(8)] });
    expect(eight.ok).toBe(false);
    if (!eight.ok) expect(eight.errors[0]?.meta?.max).toBe(7);
  });

  test("the prompt budget is 26,000 English or 11,000 non-English characters, mixed pro rata", () => {
    expect(videoV3.safe({ model: "kling-4.0", prompt: "a".repeat(26_000) }).ok).toBe(true);
    const english = videoV3.safe({ model: "kling-4.0", prompt: "a".repeat(26_001) });
    expect(english.ok).toBe(false);
    if (!english.ok) expect(english.errors[0]?.path).toEqual(["prompt"]);

    expect(videoV3.safe({ model: "kling-4.0-flash", prompt: "狐".repeat(11_000) }).ok).toBe(true);
    expect(videoV3.safe({ model: "kling-4.0-flash", prompt: "狐".repeat(11_001) }).ok).toBe(false);

    // 13,000 / 26,000 + 5,500 / 11,000 = 1 exactly — and one more of either is over.
    expect(
      videoV3.safe({ model: "kling-4.0", prompt: "a".repeat(13_000) + "狐".repeat(5_500) }).ok,
    ).toBe(true);
    const mixed = videoV3.safe({ model: "kling-4.0", prompt: "a".repeat(13_000) + "狐".repeat(5_501) });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.errors[0]?.meta).toMatchObject({ english: 13_000, nonEnglish: 5_501 });

    // Latin letters with diacritics, punctuation and smart quotes count as English.
    expect(videoV3.safe({ model: "kling-4.0", prompt: "é’".repeat(13_000) }).ok).toBe(true);
  });

  test("the budget applies to the prompt entry in contents too", () => {
    const long = { type: "prompt", text: "狐".repeat(11_001) };
    const i2v = videoV3FromImage.safe({ model: "kling-4.0", contents: [long, frame("first_frame")] });
    expect(i2v.ok).toBe(false);
    if (!i2v.ok) expect(i2v.errors[0]?.path).toEqual(["contents", 0, "text"]);
    const omni = videoOmni.safe({ model: "kling-4.0-flash", contents: [long] });
    expect(omni.ok).toBe(false);
    expect(
      videoOmni.safe({ model: "kling-4.0", contents: [{ type: "prompt", text: "a".repeat(20_000) }] })
        .ok,
    ).toBe(true);
  });
});

describe("kling settings unions cover the route rule tables", () => {
  test("every documented value lands in KlingResolution / KlingDuration / KlingAudio", () => {
    // The three unions in shared.ts are the autocomplete for these tables, so
    // a new tier, length or audio mode has to be added there too — otherwise
    // the types would advertise less than the validators accept.
    for (const table of [TEXT_TO_VIDEO_V3_RULES, IMAGE_TO_VIDEO_V3_RULES, OMNI_VIDEO_RULES]) {
      for (const [model, rules] of Object.entries(table)) {
        for (const resolution of rules.resolutions) {
          expect(KLING_RESOLUTIONS as readonly string[], model).toContain(resolution);
        }
        for (const duration of rules.durations) {
          expect(DURATIONS_3_30 as readonly number[], model).toContain(duration);
        }
        for (const audio of rules.audio ?? []) {
          expect(KLING_AUDIO_MODES as readonly string[], model).toContain(audio);
        }
      }
    }
  });
});
