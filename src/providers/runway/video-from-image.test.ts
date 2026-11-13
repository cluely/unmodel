import { describe, expect, test } from "bun:test";
import { videoFromImage, IMAGE_TO_VIDEO_URL } from "./video-from-image";
import { RUNWAY_VERSION } from "./shared";
import { videoFromImageConstraints } from "./constraints";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = videoFromImage.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const IMAGE = "https://example.com/frame.png";

describe("runway.videoFromImage happy path", () => {
  test("returns a wire-pure body with URL, method and version header", () => {
    const v = videoFromImage({
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
    const v = videoFromImage({
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
    const r = videoFromImage.safe({ model: "gen5", promptImage: IMAGE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("an image model on the video route warns as unknown_model", () => {
    const r = videoFromImage.safe({ model: "gen4_image", promptImage: IMAGE });
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

describe("runway.videoFromImage shape and required fields", () => {
  test("missing promptImage is invalid_shape", () => {
    const r = safeUnchecked({ model: "gen4_turbo", ratio: "1280:720" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("gen4_turbo without its required ratio is invalid_shape", () => {
    const r = videoFromImage.safe({ model: "gen4_turbo", promptImage: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["ratio"]);
    }
  });

  test("gen4.5 requires promptText, ratio and duration", () => {
    const r = videoFromImage.safe({ model: "gen4.5", promptImage: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["duration", "promptText", "ratio"]);
    }
  });

  test("required fields are not enforced for unknown models", () => {
    const r = videoFromImage.safe({ model: "gen5", promptImage: IMAGE });
    expect(r.ok).toBe(true);
  });

  test("seed outside 0..4294967295 is invalid_shape", () => {
    const r = safeUnchecked({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1280:720", seed: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = videoFromImage as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "gen4_turbo" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("runway.videoFromImage per-model enums", () => {
  test("a ratio outside gen4_turbo's enum is invalid_enum_value with source", () => {
    const r = videoFromImage.safe({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1920:1080" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["ratio"]);
      expect(issue?.model).toBe("gen4_turbo");
    }
  });

  test("veo3.1 accepts 1920:1080 but only durations 4, 6, 8", () => {
    const ok = videoFromImage.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1920:1080",
      duration: 8,
    });
    expect(ok.ok).toBe(true);

    const bad = videoFromImage.safe({
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
    const over = videoFromImage.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 11,
    });
    expect(over.ok).toBe(false);
    const atMax = videoFromImage.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 10,
    });
    expect(atMax.ok).toBe(true);
  });

  test("hailuo3 resolution is 2K or 768P", () => {
    const r = videoFromImage.safe({
      model: "hailuo3",
      promptImage: IMAGE,
      promptText: "a horse",
      resolution: "1080p",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("runway.videoFromImage per-model denies", () => {
  test("audio on gen4_turbo is unsupported_param with a doc source", () => {
    const r = videoFromImage.safe({
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

  test("seed is a veo3.1 / seedance param; gemini_omni_flash denies it", () => {
    // "`seed` (integer) - 0-4294967295" on every veo3.1 and seedance arm.
    expect(
      videoFromImage.safe({ model: "veo3.1", promptImage: IMAGE, ratio: "1280:720", seed: 7 }).ok,
    ).toBe(true);
    expect(videoFromImage.safe({ model: "seedance2_5", promptImage: IMAGE, seed: 7 }).ok).toBe(true);
    const r = videoFromImage.safe({ model: "gemini_omni_flash", promptImage: IMAGE, seed: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["seed"]);
    }
  });

  test("constraintsFor exposes the deny table", () => {
    const deny = videoFromImage.constraintsFor("gen4_turbo")[0]?.deny?.audio;
    expect(deny?.reason).toContain("image_to_video");
    expect(deny?.source).toContain("docs.dev.runwayml.com");
  });
});

describe("runway.videoFromImage cost estimation", () => {
  test("gen4_turbo is 5 credits/second ($0.05/s)", () => {
    const r = videoFromImage.safe({
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
    const withAudio = videoFromImage.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 8,
    });
    expect(withAudio.ok).toBe(true);
    if (withAudio.ok) expect(withAudio.estimate.costUSD).toBeCloseTo(3.2, 10);

    const noAudio = videoFromImage.safe({
      model: "veo3.1",
      promptImage: IMAGE,
      ratio: "1280:720",
      duration: 8,
      audio: false,
    });
    expect(noAudio.ok).toBe(true);
    if (noAudio.ok) expect(noAudio.estimate.costUSD).toBeCloseTo(1.6, 10);
  });

  test("seedance2_mini bills its 720p rate, seedance2_fast its 44-credit minimum", () => {
    // 4s × 15 credits = 60 (the 480p/720p split of its sizes is undocumented,
    // so the 720p rate stands).
    const mini = videoFromImage.safe({ model: "seedance2_mini", promptImage: IMAGE, duration: 4 });
    expect(mini.ok).toBe(true);
    if (mini.ok) expect(mini.estimate.costUSD).toBeCloseTo(0.6, 10);
    // 4s × 24 credits = 96, over the 44-credit minimum.
    const fast = videoFromImage.safe({ model: "seedance2_fast", promptImage: IMAGE, duration: 4 });
    if (fast.ok) expect(fast.estimate.costUSD).toBeCloseTo(0.96, 10);
    expect("cost" in models.seedance2_mini).toBe(false);
    expect("cost" in models.seedance2_fast).toBe(false);
  });

  test("no duration → no estimate", () => {
    const r = videoFromImage.safe({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1280:720" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("prores output adds the documented 5 credits/second surcharge", () => {
    const r = videoFromImage.safe({
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

    const mp4 = videoFromImage.safe({
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
    const r = videoFromImage.safe({
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
    const r = videoFromImage.safe(
      { model: "gen4.5", promptImage: IMAGE, promptText: "x", ratio: "1280:720", duration: 10 },
      { maxCostUSD: 1 },
    );
    // 10s × 12 credits = 120 credits = $1.20 > $1.00
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("runway.videoFromImage shape rules", () => {
  test("promptText is capped per model (1000 on gen4.5, 15000 on seedance2_5)", () => {
    const long = "a".repeat(1001);
    const r = videoFromImage.safe({
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
    expect(videoFromImage.safe({ model: "seedance2_5", promptImage: IMAGE, promptText: long }).ok).toBe(
      true,
    );
  });

  test("happyhorse_1_0 has the documented minLength of 2", () => {
    const base = { model: "happyhorse_1_0", promptImage: IMAGE } as const;
    expect(videoFromImage.safe({ ...base, promptText: "ab" }).ok).toBe(true);
    expect(videoFromImage.safe({ ...base, promptText: "a" }).ok).toBe(false);
  });

  test("gen4_turbo takes exactly one prompt image and it must be position first", () => {
    const two = videoFromImage.safe({
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

    const last = videoFromImage.safe({
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
    const ok = videoFromImage.safe({
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
    const r = videoFromImage.safe({
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
    expect(videoFromImage.safe({ model: "seedance2", promptImage: [{ uri: IMAGE }] }).ok).toBe(true);
  });

  test("a bare prompt-image string counts as one image", () => {
    expect(videoFromImage.safe({ model: "gen4_turbo", promptImage: IMAGE, ratio: "1280:720" }).ok).toBe(
      true,
    );
  });

  test("seedance2_5 caps referenceAudio at 10 and seedance2 at 3", () => {
    const audio = { type: "audio", uri: "https://example.com/a.mp3" } as const;
    expect(
      videoFromImage.safe({ model: "seedance2", promptImage: IMAGE, referenceAudio: [audio, audio, audio] })
        .ok,
    ).toBe(true);
    const over = videoFromImage.safe({
      model: "seedance2",
      promptImage: IMAGE,
      referenceAudio: Array(4).fill(audio),
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(3);

    expect(
      videoFromImage.safe({
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

describe("runway.videoFromImage documented enum coverage", () => {
  // RunwayVideoRatio and RunwayVideoResolution are derived from these same
  // tables — iterating them proves every advertised value is one the runtime
  // accepts for the model that documents it.
  test("every documented ratio and resolution validates on its own model", () => {
    for (const [model, constraints] of Object.entries(videoFromImageConstraints)) {
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

describe("runway.videoFromImage — Kling, WAN, H3 Max, Grok Lite and Gemini Omni 1.x arms", () => {
  const TEXT = "a fox runs";

  test.each([
    ["kling2.5_turbo_pro", { promptText: TEXT, duration: 5 }, 0.6],
    ["kling3.0_standard", { duration: 5 }, 0.65],
    ["kling3.0_pro", { duration: 5, audio: false }, 0.6],
    ["kling3.0_4k", { duration: 5 }, 2.15],
    ["klingO3_standard", { duration: 5 }, 0.65],
    ["klingO3_pro", { duration: 5 }, 0.85],
    ["klingO3_4k", { duration: 5 }, 2.15],
    // List price, rounded up: 15.7 × 5 = 78.5 → 79 credits.
    ["kling_4", { duration: 5 }, 0.79],
    ["kling_4", { duration: 5, ratio: "auto_1080p" }, 1.18],
    // 9.4 × 3 = 28.2, floored by the 29-credit minimum.
    ["kling_4_flash", { duration: 3 }, 0.29],
    ["kling_4_flash", { duration: 5 }, 0.47],
    // Default `auto_1080p`: 20 credits/s.
    ["wan3", { promptText: TEXT, duration: 5 }, 1],
    ["wan3", { promptText: TEXT, duration: 5, ratio: "832:480" }, 0.25],
    ["wan3_prime", { promptText: TEXT, duration: 5, ratio: "auto_720p" }, 0.7],
    ["h3_max", { promptText: TEXT, duration: 5, resolution: "480p" }, 0.25],
    ["h3_max", { promptText: TEXT, duration: 5 }, 0.4],
    // 2 credits/s at the default 480p + 1 credit for the start frame.
    ["grok_imagine_1_5_lite", { duration: 5 }, 0.11],
    ["grok_imagine_1_5_lite", { duration: 5, ratio: "auto_1080p" }, 0.71],
    // 10 credits/s at 720p + 1 per keyframe.
    ["gemini_omni_flash_1.1", { promptText: TEXT, duration: 5, ratio: "1280:720" }, 0.51],
    // Default 720p: 7 credits/s + 1 per keyframe; "auto" reserves 15 s.
    ["gemini_omni_flash_1.2", { promptText: TEXT, duration: 5 }, 0.36],
    ["gemini_omni_flash_1.2", { promptText: TEXT, duration: "auto" }, 1.06],
  ] as const)("%s validates warning-free and prices (%o)", (model, extra, usd) => {
    const r = safeUnchecked({ model, promptImage: IMAGE, ...extra });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.estimate.costUSD).toBeCloseTo(usd, 10);
  });

  test("the catalog carries each documented default rate", () => {
    expect(models["kling2.5_turbo_pro"].cost?.perVideoSecond).toBeCloseTo(0.12, 10);
    expect(models["kling3.0_standard"].cost?.perVideoSecond).toBeCloseTo(0.13, 10);
    expect(models.kling_4_flash.cost?.perVideoSecond).toBeCloseTo(0.094, 10);
    expect(models.wan3.cost?.perVideoSecond).toBeCloseTo(0.2, 10);
    expect(models.grok_imagine_1_5_lite.cost?.perVideoSecond).toBeCloseTo(0.02, 10);
    expect(models["gemini_omni_flash_1.2"].cost?.perVideoSecond).toBeCloseTo(0.07, 10);
    // Time-bound, or tier-dependent with no documented default: no number.
    expect("cost" in models.kling_4).toBe(false);
    expect("cost" in models.wan3_prime).toBe(false);
    expect("cost" in models.h3_max).toBe(false);
    expect("cost" in models["gemini_omni_flash_1.1"]).toBe(false);
  });

  test("kling_4 with a reference video bills the input-video rate on twice the output", () => {
    // 9.4 × (5 + 5), the input-video term floored at the output duration.
    const r = safeUnchecked({
      model: "kling_4",
      promptImage: IMAGE,
      promptText: TEXT,
      duration: 5,
      referenceVideos: [{ uri: "https://example.com/clip.mp4" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.94, 10);
  });

  test('gemini_omni_flash_1.1 takes duration "auto" (no documented reservation); integer-only arms refuse it', () => {
    const r = safeUnchecked({
      model: "gemini_omni_flash_1.1",
      promptImage: IMAGE,
      promptText: TEXT,
      duration: "auto",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    const gen = safeUnchecked({
      model: "gen4.5",
      promptImage: IMAGE,
      promptText: TEXT,
      ratio: "1280:720",
      duration: "auto",
    });
    expect(gen.ok).toBe(false);
    if (!gen.ok) expect(gen.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("the Kling 2.5 / 3.0 / O3 arms require positions and carry minLength 2", () => {
    const unpositioned = safeUnchecked({ model: "kling3.0_pro", promptImage: [{ uri: IMAGE }] });
    expect(unpositioned.ok).toBe(false);
    const short = safeUnchecked({ model: "kling2.5_turbo_pro", promptImage: IMAGE, promptText: "a" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors[0]?.meta?.min).toBe(2);
    const firstLast = safeUnchecked({
      model: "klingO3_4k",
      promptImage: [
        { uri: IMAGE, position: "first" },
        { uri: IMAGE, position: "last" },
      ],
    });
    expect(firstLast.ok).toBe(true);
  });

  test("cfgScale is 0–1 and only on kling2.5_turbo_pro / Kling 3.0", () => {
    expect(safeUnchecked({ model: "kling3.0_standard", promptImage: IMAGE, cfgScale: 0.7 }).ok).toBe(true);
    expect(safeUnchecked({ model: "kling3.0_standard", promptImage: IMAGE, cfgScale: 1.5 }).ok).toBe(false);
    const o3 = safeUnchecked({ model: "klingO3_standard", promptImage: IMAGE, cfgScale: 0.5 });
    expect(o3.ok).toBe(false);
    if (!o3.ok) expect(o3.errors[0]).toMatchObject({ code: "unsupported_param", path: ["cfgScale"] });
  });

  test("multiPrompt segments must total 3–15 seconds", () => {
    const segment = (duration: number) => ({ prompt: "a fox", duration });
    const ok = safeUnchecked({
      model: "kling3.0_standard",
      promptImage: IMAGE,
      providerSettings: { multiPrompt: [segment(5), segment(5)] },
    });
    expect(ok.ok).toBe(true);
    const over = safeUnchecked({
      model: "kling3.0_standard",
      promptImage: IMAGE,
      providerSettings: { multiPrompt: [segment(10), segment(6)] },
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors[0]).toMatchObject({ path: ["providerSettings", "multiPrompt"] });
      expect(over.errors[0]?.meta?.total).toBe(16);
    }
  });

  test('shotType "intelligence" requires promptText', () => {
    const base = {
      model: "kling3.0_pro",
      promptImage: IMAGE,
      providerSettings: { shotType: "intelligence" },
    };
    const bare = safeUnchecked(base);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.errors[0]).toMatchObject({ code: "invalid_shape", path: ["promptText"] });
    expect(safeUnchecked({ ...base, promptText: TEXT }).ok).toBe(true);
  });

  test("keepOriginalSound is video_to_video's; the image_to_video object is closed", () => {
    const r = safeUnchecked({
      model: "klingO3_standard",
      promptImage: IMAGE,
      providerSettings: { keepOriginalSound: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("Kling O3: a last keyframe and multiPrompt cannot be combined", () => {
    const multiPrompt = [{ prompt: "a fox", duration: 5 }];
    const last = safeUnchecked({
      model: "klingO3_pro",
      promptImage: [
        { uri: IMAGE, position: "first" },
        { uri: IMAGE, position: "last" },
      ],
      providerSettings: { multiPrompt },
    });
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.errors[0]?.path).toEqual(["promptImage", 1, "position"]);
    const first = safeUnchecked({
      model: "klingO3_pro",
      promptImage: [{ uri: IMAGE, position: "first" }],
      providerSettings: { multiPrompt },
    });
    expect(first.ok).toBe(true);
  });

  test("Kling O3 references: a bare URI or items, up to 7 images with the keyframes", () => {
    expect(safeUnchecked({ model: "klingO3_standard", promptImage: IMAGE, references: IMAGE }).ok).toBe(
      true,
    );
    const seven = safeUnchecked({
      model: "klingO3_standard",
      promptImage: IMAGE,
      references: Array(6).fill({ uri: IMAGE }),
    });
    expect(seven.ok).toBe(true);
    const eight = safeUnchecked({
      model: "klingO3_standard",
      promptImage: IMAGE,
      references: Array(7).fill({ uri: IMAGE }),
    });
    expect(eight.ok).toBe(false);
    if (!eight.ok) expect(eight.errors[0]?.meta?.max).toBe(7);
  });

  test("kling_4: one first frame, up to 8 middle frames, one last frame", () => {
    const frame = (position: string) => ({ uri: IMAGE, position });
    const ok = safeUnchecked({
      model: "kling_4",
      promptImage: [frame("first"), frame("middle"), frame("middle"), frame("last")],
    });
    expect(ok.ok).toBe(true);
    const noFirst = safeUnchecked({ model: "kling_4", promptImage: [frame("middle")] });
    expect(noFirst.ok).toBe(false);
    const nineMiddle = safeUnchecked({
      model: "kling_4",
      promptImage: [frame("first"), ...Array(9).fill(frame("middle"))],
    });
    expect(nineMiddle.ok).toBe(false);
    if (!nineMiddle.ok) {
      expect(nineMiddle.errors[0]?.meta).toMatchObject({ position: "middle", max: 8 });
    }
    // `middle` is kling_4's alone.
    const veo = safeUnchecked({
      model: "veo3.1",
      promptImage: [frame("first"), frame("middle")],
      ratio: "1280:720",
    });
    expect(veo.ok).toBe(false);
    if (!veo.ok) expect(veo.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("kling_4: frames and references together are at most 10", () => {
    const frames = [
      { uri: IMAGE, position: "first" },
      ...Array(4).fill({ uri: IMAGE, position: "middle" }),
    ];
    const ten = safeUnchecked({
      model: "kling_4",
      promptImage: frames,
      promptText: TEXT,
      references: Array(5).fill({ uri: IMAGE }),
    });
    expect(ten.ok).toBe(true);
    const eleven = safeUnchecked({
      model: "kling_4",
      promptImage: frames,
      promptText: TEXT,
      references: Array(6).fill({ uri: IMAGE }),
    });
    expect(eleven.ok).toBe(false);
    if (!eleven.ok) {
      expect(eleven.errors[0]).toMatchObject({ path: ["references"], meta: { max: 10, count: 11 } });
    }
  });

  test("kling_4 / kling_4_flash require promptText once a reference rides along", () => {
    expect(safeUnchecked({ model: "kling_4", promptImage: IMAGE }).ok).toBe(true);
    const refs = safeUnchecked({
      model: "kling_4_flash",
      promptImage: IMAGE,
      references: [{ uri: IMAGE }],
    });
    expect(refs.ok).toBe(false);
    if (!refs.ok) expect(refs.errors[0]).toMatchObject({ code: "invalid_shape", path: ["promptText"] });
    expect(
      safeUnchecked({
        model: "kling_4_flash",
        promptImage: IMAGE,
        references: [{ uri: IMAGE }],
        promptText: TEXT,
      }).ok,
    ).toBe(true);
  });

  test("kling_4_flash reference videos are bare { uri } items; wan3's carry type", () => {
    const clip = "https://example.com/clip.mp4";
    const typed = safeUnchecked({
      model: "kling_4_flash",
      promptImage: IMAGE,
      promptText: TEXT,
      referenceVideos: [{ type: "video", uri: clip }],
    });
    expect(typed.ok).toBe(false);
    if (!typed.ok) {
      expect(typed.errors[0]).toMatchObject({
        code: "unsupported_param",
        path: ["referenceVideos", 0, "type"],
      });
    }
    expect(
      safeUnchecked({
        model: "kling_4_flash",
        promptImage: IMAGE,
        promptText: TEXT,
        referenceVideos: [{ uri: clip }],
      }).ok,
    ).toBe(true);
    const untyped = safeUnchecked({
      model: "wan3",
      promptImage: IMAGE,
      promptText: TEXT,
      referenceVideos: [{ uri: clip }],
    });
    expect(untyped.ok).toBe(false);
    if (!untyped.ok) expect(untyped.errors[0]?.path).toEqual(["referenceVideos", 0, "type"]);
  });

  test("references must be an array on kling_4 (a bare URI is the Kling O3 form)", () => {
    const r = safeUnchecked({ model: "kling_4", promptImage: IMAGE, promptText: TEXT, references: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: "invalid_shape", path: ["references"] });
  });

  test("wan3: keyframe requests take an auto_* ratio, and keyframes cannot mix with references", () => {
    const keyframes = [
      { uri: IMAGE, position: "first" },
      { uri: IMAGE, position: "last" },
    ];
    const pinned = safeUnchecked({
      model: "wan3",
      promptImage: keyframes,
      promptText: TEXT,
      ratio: "1280:720",
    });
    expect(pinned.ok).toBe(false);
    if (!pinned.ok) expect(pinned.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["ratio"] });
    expect(
      safeUnchecked({ model: "wan3", promptImage: keyframes, promptText: TEXT, ratio: "auto_720p" }).ok,
    ).toBe(true);
    expect(safeUnchecked({ model: "wan3", promptImage: keyframes, promptText: TEXT }).ok).toBe(true);
    // Unpositioned references may take a pixel ratio.
    expect(
      safeUnchecked({
        model: "wan3",
        promptImage: [{ uri: IMAGE }, { uri: IMAGE }],
        promptText: TEXT,
        ratio: "1280:720",
      }).ok,
    ).toBe(true);
    const mixed = safeUnchecked({
      model: "wan3_prime",
      promptImage: [{ uri: IMAGE, position: "first" }, { uri: IMAGE }],
      promptText: TEXT,
    });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.errors[0]).toMatchObject({ code: "invalid_shape", path: ["promptImage"] });
  });

  test("h3_max: a last frame requires a first frame", () => {
    const lone = safeUnchecked({
      model: "h3_max",
      promptImage: [{ uri: IMAGE, position: "last" }],
      promptText: TEXT,
    });
    expect(lone.ok).toBe(false);
    if (!lone.ok) expect(lone.errors[0]?.meta).toMatchObject({ position: "first", min: 1, count: 0 });
    const both = safeUnchecked({
      model: "h3_max",
      promptImage: [
        { uri: IMAGE, position: "first" },
        { uri: IMAGE, position: "last" },
      ],
      promptText: TEXT,
    });
    expect(both.ok).toBe(true);
  });

  test("h3_max takes promptExpansionMode and seed; other arms deny promptExpansionMode", () => {
    expect(
      safeUnchecked({
        model: "h3_max",
        promptImage: IMAGE,
        promptText: TEXT,
        promptExpansionMode: "disabled",
        seed: 7,
      }).ok,
    ).toBe(true);
    const bad = safeUnchecked({
      model: "h3_max",
      promptImage: IMAGE,
      promptText: TEXT,
      promptExpansionMode: "max",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.code).toBe("invalid_enum_value");
    const gen = safeUnchecked({
      model: "gen4.5",
      promptImage: IMAGE,
      promptText: TEXT,
      ratio: "1280:720",
      duration: 5,
      promptExpansionMode: "disabled",
    });
    expect(gen.ok).toBe(false);
  });
});

describe("runway.videoFromImage — corrected arms and rates (2026-11-12)", () => {
  test('the seedance arms take duration "auto", estimated at the variant maximum', () => {
    // "`auto` is billed at the variant maximum up front": 15 s × 15 credits.
    const mini = videoFromImage.safe({ model: "seedance2_mini", promptImage: IMAGE, duration: "auto" });
    expect(mini.ok).toBe(true);
    if (mini.ok) expect(mini.estimate.costUSD).toBeCloseTo(2.25, 10);
    // 30 s × 30 credits at the default 1280:720.
    const s25 = videoFromImage.safe({ model: "seedance2_5", promptImage: IMAGE, duration: "auto" });
    if (s25.ok) expect(s25.estimate.costUSD).toBeCloseTo(9, 10);
    expect(videoFromImage.safe({ model: "seedance2", promptImage: IMAGE, duration: 16 }).ok).toBe(false);
  });

  test("seedance2_5: mov output, 1080p and 4K sizes — 4K has no published 2.5 rate", () => {
    const hd = videoFromImage.safe({
      model: "seedance2_5",
      promptImage: IMAGE,
      ratio: "1920:1080",
      duration: 5,
      outputFormat: "mov",
    });
    expect(hd.ok).toBe(true);
    if (hd.ok) expect(hd.estimate.costUSD).toBeCloseTo(3.4, 10); // 68 cr/s, mov like mp4
    const uhd = videoFromImage.safe({ model: "seedance2_5", promptImage: IMAGE, ratio: "3840:2160", duration: 5 });
    expect(uhd.ok).toBe(true);
    if (uhd.ok) expect(uhd.estimate.costUSD).toBeUndefined();
    expect(models.seedance2_5.cost?.perVideoSecond).toBeCloseTo(0.3, 10);
    const prores = safeUnchecked({ model: "seedance2_5", promptImage: IMAGE, outputFormat: "prores" });
    expect(prores.ok).toBe(false);
    if (!prores.ok) expect(prores.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("seedance2 / fast / mini prompts run to 10000 characters", () => {
    expect(videoFromImage.safe({ model: "seedance2_fast", promptImage: IMAGE, promptText: "a".repeat(10000) }).ok).toBe(
      true,
    );
    const over = videoFromImage.safe({ model: "seedance2_fast", promptImage: IMAGE, promptText: "a".repeat(10001) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.meta?.max).toBe(10000);
  });

  test("hailuo3 takes 768p / 2k (and the deprecated 768P / 2K); 2K is the catalog default", () => {
    const low = videoFromImage.safe({
      model: "hailuo3",
      promptImage: IMAGE,
      promptText: "a horse",
      resolution: "768p",
      duration: 5,
    });
    expect(low.ok).toBe(true);
    // 10 cr/s + 2 for the start frame.
    if (low.ok) expect(low.estimate.costUSD).toBeCloseTo(0.52, 10);
    expect(models.hailuo3.cost?.perVideoSecond).toBeCloseTo(0.15, 10);
  });

  test("happyhorse_1_0 image-to-video defaults to 720P and takes the lower-case casing", () => {
    const omitted = videoFromImage.safe({ model: "happyhorse_1_0", promptImage: IMAGE, duration: 4 });
    expect(omitted.ok).toBe(true);
    if (omitted.ok) expect(omitted.estimate.costUSD).toBeCloseTo(0.6, 10);
    const lower = videoFromImage.safe({ model: "happyhorse_1_0", promptImage: IMAGE, duration: 4, resolution: "1080p" });
    expect(lower.ok).toBe(true);
    if (lower.ok) expect(lower.estimate.costUSD).toBeCloseTo(1.2, 10);
  });

  test("grok_imagine_1_5 defaults to 480p: 10 credits/s + 1 for the start frame", () => {
    const r = videoFromImage.safe({ model: "grok_imagine_1_5", promptImage: IMAGE, duration: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.51, 10);
    expect(models.grok_imagine_1_5.cost?.perVideoSecond).toBeCloseTo(0.1, 10);
  });

  test("gen4.5's 10-bit and HDR outputs carry the 20 credits/s surcharge", () => {
    const r = videoFromImage.safe({
      model: "gen4.5",
      promptImage: IMAGE,
      promptText: "x",
      ratio: "1280:720",
      duration: 5,
      outputFormat: "hdr10",
    });
    expect(r.ok).toBe(true);
    // 5 s × (12 + 20) credits.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(1.6, 10);
    const turbo = videoFromImage.safe({
      model: "gen4_turbo",
      promptImage: IMAGE,
      ratio: "1280:720",
      outputFormat: "hdr10",
    });
    expect(turbo.ok).toBe(false);
  });
});
