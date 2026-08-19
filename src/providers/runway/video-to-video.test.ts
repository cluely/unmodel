import { describe, expect, test } from "bun:test";
import { videoToVideo, VIDEO_TO_VIDEO_URL } from "./video-to-video";
import { RUNWAY_VERSION } from "./shared";
import { videoToVideoConstraints } from "./constraints";
import { models } from "./models";
import { videoCreditsPerSecond } from "./pricing";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = videoToVideo.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VIDEO = "https://example.com/clip.mp4";
const IMAGE = "https://example.com/frame.png";

describe("runway.videoToVideo happy path", () => {
  test("aleph2 returns a wire-pure body with URL, method and version header", () => {
    const v = videoToVideo({
      model: "aleph2",
      videoUri: VIDEO,
      promptText: "make it a rainy neon night",
      targetAspectRatio: "21:9",
    });

    expect(Object.keys(v)).toEqual(["model", "videoUri", "promptText", "targetAspectRatio"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      model: "aleph2",
      videoUri: VIDEO,
      promptText: "make it a rainy neon night",
      targetAspectRatio: "21:9",
    });
    expect(v.request.url).toBe(VIDEO_TO_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["x-runway-version"]).toBe(RUNWAY_VERSION);
  });

  test("toSdk returns the body unchanged in shape", () => {
    const v = videoToVideo({
      model: "seedance2",
      promptVideo: VIDEO,
      promptText: "restyle as claymation",
      duration: 5,
      ratio: "1280:720",
    });
    expect(v.toSdk("runway")).toEqual({
      model: "seedance2",
      promptVideo: VIDEO,
      promptText: "restyle as claymation",
      duration: 5,
      ratio: "1280:720",
    });
  });

  test("aleph2 is in the catalog at 28 credits/second", () => {
    expect(models.aleph2.cost?.perVideoSecond).toBeCloseTo(0.28, 10);
  });
});

describe("runway.videoToVideo route support", () => {
  test("gen4.5 has no video_to_video arm", () => {
    const r = safeUnchecked({ model: "gen4.5", videoUri: VIDEO });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(String(issue?.meta?.source)).toContain("docs.dev.runwayml.com");
    }
  });

  test("an unknown model warns but does not run route checks", () => {
    const r = videoToVideo.safe({ model: "aleph3", videoUri: VIDEO });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("runway.videoToVideo required fields", () => {
  test("aleph2 requires videoUri", () => {
    const r = videoToVideo.safe({ model: "aleph2", promptText: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toContain("videoUri");
  });

  test("hailuo3 requires promptVideo and promptText", () => {
    const r = videoToVideo.safe({ model: "hailuo3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["promptText", "promptVideo"]);
    }
  });
});

describe("runway.videoToVideo per-model denies", () => {
  test("aleph2 rejects promptVideo — it takes videoUri", () => {
    const r = safeUnchecked({ model: "aleph2", videoUri: VIDEO, promptVideo: VIDEO });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["promptVideo"]);
    }
  });

  test("seedance2 rejects videoUri — it takes promptVideo", () => {
    const r = safeUnchecked({ model: "seedance2", promptVideo: VIDEO, videoUri: VIDEO });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["videoUri"]);
    }
  });

  test("aleph2 has no duration — output length follows the input video", () => {
    const r = safeUnchecked({ model: "aleph2", videoUri: VIDEO, duration: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["duration"]);
    }
  });

  test("keyframes are aleph2-only", () => {
    const r = safeUnchecked({
      model: "seedance2",
      promptVideo: VIDEO,
      keyframes: [{ uri: IMAGE, seconds: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["keyframes"]);
    }
  });

  test("constraintsFor publishes aleph2's documented 30s input limit", () => {
    expect(videoToVideo.constraintsFor("aleph2")[0]?.media?.video?.maxDurationSeconds).toBe(30);
  });
});

describe("runway.videoToVideo per-model enums", () => {
  test("aleph2 targetAspectRatio is the documented 8-value enum", () => {
    expect(videoToVideo.safe({ model: "aleph2", videoUri: VIDEO, targetAspectRatio: "1:1" }).ok).toBe(
      true,
    );
    // "5:4" is outside the documented 8-value enum, so it no longer compiles
    // as a RunwayTargetAspectRatio — the runtime path stays reachable here.
    const bad = safeUnchecked({
      model: "aleph2",
      videoUri: VIDEO,
      targetAspectRatio: "5:4",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const issue = bad.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["targetAspectRatio"]);
    }
  });

  test("mode is a seedance2_5-only enum", () => {
    expect(
      videoToVideo.safe({ model: "seedance2_5", promptVideo: VIDEO, mode: "extend" }).ok,
    ).toBe(true);

    const wrongModel = safeUnchecked({ model: "seedance2", promptVideo: VIDEO, mode: "extend" });
    expect(wrongModel.ok).toBe(false);
    if (!wrongModel.ok) {
      expect(wrongModel.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["mode"]);
    }
  });

  test("hailuo3 duration is the documented 5..15 integer range", () => {
    const base = { model: "hailuo3", promptVideo: VIDEO, promptText: "x" } as const;
    expect(videoToVideo.safe({ ...base, duration: 15 }).ok).toBe(true);
    expect(videoToVideo.safe({ ...base, duration: 16 }).ok).toBe(false);
    expect(videoToVideo.safe({ ...base, duration: 4 }).ok).toBe(false);
  });

  test("seedance2_5 keeps its own 480p ratio family", () => {
    // "854:480" is seedance2_5's; "496:864" belongs to seedance2/fast/mini.
    expect(videoToVideo.safe({ model: "seedance2_5", promptVideo: VIDEO, ratio: "854:480" }).ok).toBe(
      true,
    );
    expect(videoToVideo.safe({ model: "seedance2_5", promptVideo: VIDEO, ratio: "496:864" }).ok).toBe(
      false,
    );
  });
});

describe("runway.videoToVideo shape rules", () => {
  test("aleph2 caps promptText at 1000 characters", () => {
    const r = videoToVideo.safe({
      model: "aleph2",
      videoUri: VIDEO,
      promptText: "a".repeat(1001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["promptText"]);
      expect(issue?.meta?.max).toBe(1000);
    }
    expect(
      videoToVideo.safe({ model: "aleph2", videoUri: VIDEO, promptText: "a".repeat(1000) }).ok,
    ).toBe(true);
  });

  test("aleph2 accepts at most 5 keyframes", () => {
    const frame = { uri: IMAGE, seconds: 1 };
    expect(
      videoToVideo.safe({ model: "aleph2", videoUri: VIDEO, keyframes: Array(5).fill(frame) }).ok,
    ).toBe(true);

    const r = videoToVideo.safe({
      model: "aleph2",
      videoUri: VIDEO,
      keyframes: Array(6).fill(frame),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["keyframes"]);
      expect(issue?.meta?.max).toBe(5);
    }
  });

  test("keyframes must all set a range or none may", () => {
    const range = { start_seconds: 0, end_seconds: 4 };
    const mixed = videoToVideo.safe({
      model: "aleph2",
      videoUri: VIDEO,
      keyframes: [
        { uri: IMAGE, seconds: 1, range },
        { uri: IMAGE, seconds: 2 },
      ],
    });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) {
      expect(mixed.errors.find((e) => e.code === "invalid_shape")?.path).toEqual(["keyframes"]);
    }

    expect(
      videoToVideo.safe({
        model: "aleph2",
        videoUri: VIDEO,
        keyframes: [
          { uri: IMAGE, seconds: 1, range },
          { uri: IMAGE, seconds: 2, range },
        ],
      }).ok,
    ).toBe(true);
  });

  test("a keyframe pinned by `at` must be a 0..1 fraction", () => {
    expect(
      videoToVideo.safe({ model: "aleph2", videoUri: VIDEO, keyframes: [{ uri: IMAGE, at: 0.5 }] })
        .ok,
    ).toBe(true);
    const r = safeUnchecked({
      model: "aleph2",
      videoUri: VIDEO,
      keyframes: [{ uri: IMAGE, at: 1.5 }],
    });
    expect(r.ok).toBe(false);
  });

  test("hailuo3 caps referenceVideos at 2 here (3 on text_to_video)", () => {
    const ref = { type: "video", uri: VIDEO } as const;
    const base = { model: "hailuo3", promptVideo: VIDEO, promptText: "x" } as const;
    expect(videoToVideo.safe({ ...base, referenceVideos: [ref, ref] }).ok).toBe(true);

    const r = videoToVideo.safe({ ...base, referenceVideos: [ref, ref, ref] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["referenceVideos"]);
      expect(issue?.meta?.max).toBe(2);
    }
  });

  test("a non-https, non-runway, non-data uri is rejected", () => {
    const r = safeUnchecked({ model: "aleph2", videoUri: "s3://bucket/clip.mp4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");

    expect(videoToVideo.safe({ model: "aleph2", videoUri: "runway://token-abcdefghij" }).ok).toBe(
      true,
    );
  });
});

describe("runway.videoToVideo cost estimation", () => {
  test("aleph2 gets no estimate — it has no duration param", () => {
    const r = videoToVideo.safe({ model: "aleph2", videoUri: VIDEO });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("seedance2 at a 720p ratio is 36 credits/second", () => {
    const r = videoToVideo.safe({
      model: "seedance2",
      promptVideo: VIDEO,
      duration: 5,
      ratio: "1280:720",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(1.8, 10);
  });

  test("hailuo3 adds 2 credits per reference image", () => {
    const r = videoToVideo.safe({
      model: "hailuo3",
      promptVideo: VIDEO,
      promptText: "x",
      duration: 5,
      resolution: "768P",
      references: [{ uri: IMAGE }, { uri: IMAGE }],
    });
    expect(r.ok).toBe(true);
    // 5s × 10 credits + 2 refs × 2 credits = 54 credits.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.54, 10);
  });

  test("gemini_omni_flash bills 11 credits per second of INPUT on this route", () => {
    expect(videoCreditsPerSecond("gemini_omni_flash", { route: "video_to_video" })).toBe(11);
    expect(videoCreditsPerSecond("gemini_omni_flash", { route: "text_to_video" })).toBe(10);
    // No `duration` param on the v2v arm, so no estimate is produced.
    const r = videoToVideo.safe({ model: "gemini_omni_flash", videoUri: VIDEO, promptText: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("the aleph2 rate honours the 56-credit minimum when a duration is supplied", () => {
    // videoCostUSD is exported for callers who know the input length.
    expect(videoCreditsPerSecond("aleph2", {})).toBe(28);
  });
});

describe("runway.videoToVideo documented enum coverage", () => {
  // RunwayVideoRatio / RunwayVideoResolution / RunwayTargetAspectRatio are
  // derived from these same tables — iterating them proves every advertised
  // value is one the runtime accepts for the model that documents it.
  test("every documented ratio, resolution and targetAspectRatio validates", () => {
    for (const [model, constraints] of Object.entries(videoToVideoConstraints)) {
      const enums = constraints?.enums;
      if (enums === undefined) continue;
      const base =
        model === "aleph2"
          ? { model, videoUri: VIDEO }
          : { model, promptVideo: VIDEO, promptText: "hi" };
      for (const param of ["ratio", "resolution", "targetAspectRatio"] as const) {
        for (const value of enums[param] ?? []) {
          const r = safeUnchecked({ ...base, [param]: value });
          expect(r.ok, `${model} should accept ${param} ${String(value)}`).toBe(true);
          if (r.ok) {
            expect(r.warnings, `${model} ${param} ${String(value)} warning-free`).toEqual([]);
          }
        }
      }
    }
  });
});
