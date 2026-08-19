import { describe, expect, test } from "bun:test";
import { imageToVideo, IMAGE_TO_VIDEO_URL } from "./image-to-video";
import { RUNWAY_VERSION } from "./shared";
import { imageToVideoConstraints } from "./constraints";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = imageToVideo.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const IMAGE = "https://example.com/frame.png";

describe("runway.imageToVideo happy path", () => {
  test("returns a wire-pure body with URL, method and version header", () => {
    const v = imageToVideo({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 5,
      seed: 42,
    });

    expect(Object.keys(v)).toEqual(["model", "promptImage", "ratio", "duration", "seed"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 5,
      seed: 42,
    });
    expect(v.request.url).toBe(IMAGE_TO_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.request.headers["x-runway-version"]).toBe(RUNWAY_VERSION);
  });

  test("toSdk returns the body unchanged in shape", () => {
    const v = imageToVideo({
      model: "gen4.5",
      promptImage: [{ uri: IMAGE, position: "first" }],
      promptText: "camera pans right",
      ratio: "1104:832",
      duration: 8,
    });
    expect(v.toSdk("runway")).toEqual({
      model: "gen4.5",
      promptImage: [{ uri: IMAGE, position: "first" }],
      promptText: "camera pans right",
      ratio: "1104:832",
      duration: 8,
    });
  });

  test("unknown model warns but validates", () => {
    const r = imageToVideo.safe({ model: "gen5", promptImage: IMAGE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("an image model on the video route warns as unknown_model", () => {
    const r = imageToVideo.safe({ model: "gen4_image", promptImage: IMAGE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      brand_new: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["brand_new"]);
    }
  });
});

describe("runway.imageToVideo shape and required fields", () => {
  test("missing promptImage is invalid_shape", () => {
    const r = safeUnchecked({ model: "gen4_turbo", ratio: "1280:720" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("gen4_turbo without its required ratio is invalid_shape", () => {
    const r = imageToVideo.safe({ model: "gen4_turbo", promptImage: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["ratio"]);
    }
  });

  test("gen4.5 requires promptText, ratio and duration", () => {
    const r = imageToVideo.safe({ model: "gen4.5", promptImage: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["duration", "promptText", "ratio"]);
    }
  });

  test("required fields are not enforced for unknown models", () => {
    const r = imageToVideo.safe({ model: "gen5", promptImage: IMAGE });
    expect(r.ok).toBe(true);
  });

  test("seed outside 0..4294967295 is invalid_shape", () => {
    const r = safeUnchecked({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1280:720", seed: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = imageToVideo as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "gen4_turbo" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("runway.imageToVideo per-model enums", () => {
  test("a ratio outside gen4_turbo's enum is invalid_enum_value with source", () => {
    const r = imageToVideo.safe({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1920:1080" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["ratio"]);
      expect(issue?.model).toBe("gen4_turbo");
    }
  });

  test("veo3.1 accepts 1920:1080 but only durations 4, 6, 8", () => {
    const ok = imageToVideo.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1920:1080",
      duration: 8,
    });
    expect(ok.ok).toBe(true);

    const bad = imageToVideo.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1920:1080",
      duration: 5,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const issue = bad.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["duration"]);
      expect(issue?.meta?.allowed).toEqual([4, 6, 8]);
    }
  });

  test("gen4_turbo duration is the documented 2..10 integer range", () => {
    const over = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 11,
    });
    expect(over.ok).toBe(false);
    const atMax = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 10,
    });
    expect(atMax.ok).toBe(true);
  });

  test("hailuo3 resolution is 2K or 768P", () => {
    const r = imageToVideo.safe({
      model: "hailuo3",
      promptImage: IMAGE,
      promptText: "a horse",
      resolution: "1080p",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("runway.imageToVideo per-model denies", () => {
  test("audio on gen4_turbo is unsupported_param with a doc source", () => {
    const r = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      audio: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["audio"]);
      expect(String(issue?.meta?.source)).toContain("docs.dev.runwayml.com");
    }
  });

  test("seed on veo3.1 is unsupported_param", () => {
    const r = imageToVideo.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1280:720",
      seed: 7,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["seed"]);
    }
  });

  test("constraintsFor exposes the deny table", () => {
    const deny = imageToVideo.constraintsFor("gen4_turbo")[0]?.deny?.audio;
    expect(deny?.reason).toContain("image_to_video");
    expect(deny?.source).toContain("docs.dev.runwayml.com");
  });
});

describe("runway.imageToVideo cost estimation", () => {
  test("gen4_turbo is 5 credits/second ($0.05/s)", () => {
    const r = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.25, 10);
    expect(models.gen4_turbo.cost?.perVideoSecond).toBeCloseTo(0.05, 10);
  });

  test("veo3.1 bills 40 credits/s with audio (default) and 20 without", () => {
    const withAudio = imageToVideo.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 8,
    });
    expect(withAudio.ok).toBe(true);
    if (withAudio.ok) expect(withAudio.estimate.costUSD).toBeCloseTo(3.2, 10);

    const noAudio = imageToVideo.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 8,
      audio: false,
    });
    expect(noAudio.ok).toBe(true);
    if (noAudio.ok) expect(noAudio.estimate.costUSD).toBeCloseTo(1.6, 10);
  });

  test("seedance2_mini applies the 64-credit minimum", () => {
    // 4s × 16 credits = 64 exactly; shorter is impossible (min duration 4).
    const r = imageToVideo.safe({ model: "seedance2_mini", promptImage: IMAGE, duration: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.64, 10);
  });

  test("no duration → no estimate", () => {
    const r = imageToVideo.safe({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1280:720" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("prores output adds the documented 5 credits/second surcharge", () => {
    const r = imageToVideo.safe({
      model: "gen4.5",
      promptImage: IMAGE,
      promptText: "x",
      ratio: "1280:720",
      duration: 5,
      outputFormat: "prores",
    });
    expect(r.ok).toBe(true);
    // 5s × (12 + 5) credits = 85 credits.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.85, 10);

    const mp4 = imageToVideo.safe({
      model: "gen4.5",
      promptImage: IMAGE,
      promptText: "x",
      ratio: "1280:720",
      duration: 5,
      outputFormat: "mp4",
    });
    if (mp4.ok) expect(mp4.estimate.costUSD).toBeCloseTo(0.6, 10);
  });

  test("hailuo3 charges 2 credits per prompt image", () => {
    const r = imageToVideo.safe({
      model: "hailuo3",
      promptImage: [{ uri: IMAGE }, { uri: IMAGE }],
      promptText: "x",
      resolution: "768P",
      duration: 5,
    });
    expect(r.ok).toBe(true);
    // 5s × 10 credits + 2 images × 2 credits = 54 credits.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.54, 10);
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = imageToVideo.safe(
      { model: "gen4.5", promptImage: IMAGE, promptText: "x", ratio: "1280:720", duration: 10 },
      { maxCostUSD: 1 },
    );
    // 10s × 12 credits = 120 credits = $1.20 > $1.00
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("runway.imageToVideo shape rules", () => {
  test("promptText is capped per model (1000 on gen4.5, 15000 on seedance2_5)", () => {
    const long = "a".repeat(1001);
    const r = imageToVideo.safe({
      model: "gen4.5",
      promptImage: IMAGE,
      promptText: long,
      ratio: "1280:720",
      duration: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["promptText"]);
      expect(issue?.meta?.max).toBe(1000);
    }
    // The same prompt is well within seedance2_5's 15000-char cap.
    expect(imageToVideo.safe({ model: "seedance2_5", promptImage: IMAGE, promptText: long }).ok).toBe(
      true,
    );
  });

  test("happyhorse_1_0 has the documented minLength of 2", () => {
    const base = { model: "happyhorse_1_0", promptImage: IMAGE } as const;
    expect(imageToVideo.safe({ ...base, promptText: "ab" }).ok).toBe(true);
    expect(imageToVideo.safe({ ...base, promptText: "a" }).ok).toBe(false);
  });

  test("gen4_turbo takes exactly one prompt image and it must be position first", () => {
    const two = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: [
        { uri: IMAGE, position: "first" },
        { uri: IMAGE, position: "first" },
      ],
      ratio: "1280:720",
    });
    expect(two.ok).toBe(false);
    if (!two.ok) {
      const issue = two.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["promptImage"]);
      expect(issue?.meta?.max).toBe(1);
    }

    const last = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: [{ uri: IMAGE, position: "last" }],
      ratio: "1280:720",
    });
    expect(last.ok).toBe(false);
    if (!last.ok) {
      const issue = last.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["promptImage", 0, "position"]);
      expect(issue?.meta?.allowed).toEqual(["first"]);
    }
  });

  test("veo3.1 takes up to two prompt images with first/last positions", () => {
    const ok = imageToVideo.safe({
      model: "veo3.1",
      promptImage: [
        { uri: IMAGE, position: "first" },
        { uri: IMAGE, position: "last" },
      ],
      ratio: "1280:720",
    });
    expect(ok.ok).toBe(true);
  });

  test("an omitted position is an error where the arm marks it required", () => {
    const r = imageToVideo.safe({
      model: "gen4_turbo",
      promptImage: [{ uri: IMAGE }],
      ratio: "1280:720",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_shape")?.path).toEqual([
        "promptImage",
        0,
        "position",
      ]);
    }
    // The seedance arms leave position optional.
    expect(imageToVideo.safe({ model: "seedance2", promptImage: [{ uri: IMAGE }] }).ok).toBe(true);
  });

  test("a bare prompt-image string counts as one image", () => {
    expect(imageToVideo.safe({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1280:720" }).ok).toBe(
      true,
    );
  });

  test("seedance2_5 caps referenceAudio at 10 and seedance2 at 3", () => {
    const audio = { type: "audio", uri: "https://example.com/a.mp3" } as const;
    expect(
      imageToVideo.safe({ model: "seedance2", promptImage: IMAGE, referenceAudio: [audio, audio, audio] })
        .ok,
    ).toBe(true);
    const over = imageToVideo.safe({
      model: "seedance2",
      promptImage: IMAGE,
      referenceAudio: Array(4).fill(audio),
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(3);

    expect(
      imageToVideo.safe({
        model: "seedance2_5",
        promptImage: IMAGE,
        referenceAudio: Array(10).fill(audio),
      }).ok,
    ).toBe(true);
  });

  test("aleph2 is video_to_video-only and rejected here", () => {
    const r = safeUnchecked({ model: "aleph2", promptImage: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.message).toContain("video_to_video");
    }
  });

  test("a prompt image URI must be https, runway:// or data:image/", () => {
    const r = safeUnchecked({ model: "gen4_turbo", promptImage: "ftp://x/y.png", ratio: "1280:720" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("runway.imageToVideo documented enum coverage", () => {
  // RunwayVideoRatio and RunwayVideoResolution are derived from these same
  // tables — iterating them proves every advertised value is one the runtime
  // accepts for the model that documents it.
  test("every documented ratio and resolution validates on its own model", () => {
    for (const [model, constraints] of Object.entries(imageToVideoConstraints)) {
      const enums = constraints?.enums;
      if (enums === undefined) continue;
      const duration = enums.duration?.[0];
      const base = {
        model,
        promptImage: IMAGE,
        promptText: "hi",
        // gen4.5 is the one arm that also requires `duration`.
        ...(duration !== undefined && { duration }),
      };
      for (const param of ["ratio", "resolution"] as const) {
        for (const value of enums[param] ?? []) {
          const r = safeUnchecked({
            ...base,
            // `resolution` arms still need a legal `ratio` when the model
            // requires one.
            ...(param === "resolution" &&
              enums.ratio?.[0] !== undefined && { ratio: enums.ratio[0] }),
            [param]: value,
          });
          expect(r.ok, `${model} should accept ${param} ${String(value)}`).toBe(true);
          if (r.ok) {
            expect(r.warnings, `${model} ${param} ${String(value)} warning-free`).toEqual([]);
          }
        }
      }
    }
  });
});
