import { describe, expect, test } from "bun:test";
import {
  videoV2,
  videoV2QueryUrl,
  VIDEO_GENERATION_V2_URL,
  VIDEO_V2_QUERY_URL,
  VIDEO_V2_MAX_REFERENCE_IMAGES,
  VIDEO_V2_USD_PER_SECOND,
  VIDEO_V2_USD_PER_EXTRA_IMAGE,
  VIDEO_V2_RESOLUTIONS,
  VIDEO_V2_DURATIONS,
  VIDEO_V2_RATIOS,
} from "./video-v2";
import { videoV2Models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = videoV2.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const text = (value = "A neon-lit street at night") => ({ type: "text" as const, text: value });
const image = (role?: string) => ({
  type: "image_url" as const,
  image_url: { url: "https://cdn.example/a.jpg" },
  ...(role !== undefined && { role }),
});

describe("minimax.videoV2 wire shape", () => {
  test("the whole params object is the JSON body; the route is async", () => {
    const v = videoV2({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "768P",
      duration: 6,
      ratio: "16:9",
    });
    expect(Object.keys(v)).toEqual(["model", "content", "resolution", "duration", "ratio"]);
    expect(v.request.url).toBe(VIDEO_GENERATION_V2_URL);
    expect(videoV2QueryUrl("abc123")).toBe(`${VIDEO_V2_QUERY_URL}/abc123`);
  });

  test("only MiniMax-H3 is accepted", () => {
    const r = videoV2.safe({
      model: "MiniMax-Hailuo-2.3",
      content: [text()],
      resolution: "768P",
      duration: 6,
      ratio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model"]);
  });

  test("an off-catalog model warns unknown_model alongside the enum error", () => {
    // The v2 catalog holds MiniMax-H3 only, so every other id — including the
    // v1 route's real models — misses the catalog as well as the enum.
    const r = videoV2.safe({
      model: "MiniMax-Hailuo-2.3",
      content: [text()],
      resolution: "768P",
      duration: 6,
      ratio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.model).toBe("MiniMax-Hailuo-2.3");
    }
  });

  // safeUnchecked: `resolution`/`duration`/`ratio` are closed unions at compile
  // time now, so these deliberately-invalid values have to bypass the types to
  // reach the runtime checks they are testing.
  test("resolution and duration are enum-checked", () => {
    const badResolution = safeUnchecked({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "4K",
      duration: 6,
      ratio: "16:9",
    });
    expect(badResolution.ok).toBe(false);
    if (!badResolution.ok) expect(badResolution.errors[0]?.path).toEqual(["resolution"]);

    const badDuration = safeUnchecked({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "2K",
      duration: 16,
      ratio: "16:9",
    });
    expect(badDuration.ok).toBe(false);
    if (!badDuration.ok) expect(badDuration.errors[0]?.path).toEqual(["duration"]);

    const badRatio = safeUnchecked({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "768P",
      duration: 6,
      ratio: "banana",
    });
    expect(badRatio.ok).toBe(false);
    if (!badRatio.ok) expect(badRatio.errors[0]?.path).toEqual(["ratio"]);
  });

  test("every documented resolution / duration / ratio preset validates", () => {
    // Keep in sync with MinimaxVideoV2Resolution, MinimaxVideoV2Duration and
    // MinimaxVideoV2Ratio — the unions are closed, so every value they
    // advertise has to pass the runtime checks that back them.
    for (const resolution of VIDEO_V2_RESOLUTIONS) {
      const r = videoV2.safe({
        model: "MiniMax-H3",
        content: [text()],
        resolution,
        duration: 6,
        ratio: "16:9",
      });
      expect(r.ok, `resolution ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `resolution ${resolution} should be warning-free`).toEqual([]);
    }
    for (const duration of VIDEO_V2_DURATIONS) {
      const r = videoV2.safe({
        model: "MiniMax-H3",
        content: [text()],
        resolution: "768P",
        duration,
        ratio: "16:9",
      });
      expect(r.ok, `duration ${duration} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `duration ${duration} should be warning-free`).toEqual([]);
    }
    for (const ratio of VIDEO_V2_RATIOS) {
      // "adaptive" is legal on the wire but not for text-to-video, so it is
      // exercised in the image-to-video scenario where the docs allow it.
      const content = ratio === "adaptive" ? [text(), image()] : [text()];
      const r = videoV2.safe({
        model: "MiniMax-H3",
        content,
        resolution: "768P",
        duration: 6,
        ratio,
      });
      expect(r.ok, `ratio ${ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `ratio ${ratio} should be warning-free`).toEqual([]);
    }
  });
});

describe("minimax.videoV2 content rules", () => {
  test("a non-empty text item is always required", () => {
    const r = videoV2.safe({
      model: "MiniMax-H3",
      content: [image()],
      resolution: "768P",
      duration: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path.join(".") === "content")).toBe(true);

    const empty = videoV2.safe({
      model: "MiniMax-H3",
      content: [{ type: "text", text: "   " }],
      resolution: "768P",
      duration: 6,
      ratio: "16:9",
    });
    expect(empty.ok).toBe(false);
  });

  test("image-to-video and reference-to-video cannot be mixed", () => {
    const r = videoV2.safe({
      model: "MiniMax-H3",
      content: [text(), image("first_frame"), image("reference_image")],
      resolution: "768P",
      duration: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("mutually exclusive"))).toBe(true);
    }
  });

  test("first/last frame counts are capped at one each", () => {
    const r = videoV2.safe({
      model: "MiniMax-H3",
      content: [text(), image("first_frame"), image("first_frame")],
      resolution: "768P",
      duration: 6,
    });
    expect(r.ok).toBe(false);

    const ok = videoV2.safe({
      model: "MiniMax-H3",
      content: [text(), image("first_frame"), image("last_frame")],
      resolution: "768P",
      duration: 6,
    });
    expect(ok.ok).toBe(true);
  });

  test("reference images are capped at 9", () => {
    const content = [
      text(),
      ...Array.from({ length: VIDEO_V2_MAX_REFERENCE_IMAGES + 1 }, () =>
        image("reference_image"),
      ),
    ];
    const r = videoV2.safe({
      model: "MiniMax-H3",
      content,
      resolution: "768P",
      duration: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta).toMatchObject({ max: VIDEO_V2_MAX_REFERENCE_IMAGES });
  });

  test("an undocumented content type or role is invalid_enum_value", () => {
    const r = safeUnchecked({
      model: "MiniMax-H3",
      content: [text(), { type: "pdf_url" }],
      resolution: "768P",
      duration: 6,
      ratio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["content", 1, "type"]);

    const badRole = safeUnchecked({
      model: "MiniMax-H3",
      content: [text(), { ...image(), role: "middle_frame" }],
      resolution: "768P",
      duration: 6,
    });
    expect(badRole.ok).toBe(false);
  });

  test("text-to-video requires a concrete ratio", () => {
    const missing = videoV2.safe({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "768P",
      duration: 6,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["ratio"]);

    const adaptive = videoV2.safe({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "768P",
      duration: 6,
      ratio: "adaptive",
    });
    expect(adaptive.ok).toBe(false);

    // Image-to-video may omit it (the input image decides).
    expect(
      videoV2.safe({
        model: "MiniMax-H3",
        content: [text(), image("first_frame")],
        resolution: "768P",
        duration: 6,
      }).ok,
    ).toBe(true);
  });
});

describe("minimax.videoV2 pricing", () => {
  test("output seconds are billed per resolution", () => {
    expect(VIDEO_V2_USD_PER_SECOND["768P"]).toBe(0.08);
    expect(videoV2Models["MiniMax-H3"].cost.perVideoSecond).toBe(0.08);
    const p768 = videoV2.safe({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "768P",
      duration: 10,
      ratio: "16:9",
    });
    expect(p768.ok).toBe(true);
    if (p768.ok) expect(p768.estimate.costUSD).toBeCloseTo(0.8, 10);

    const p2k = videoV2.safe({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "2K",
      duration: 10,
      ratio: "16:9",
    });
    expect(p2k.ok).toBe(true);
    if (p2k.ok) expect(p2k.estimate.costUSD).toBeCloseTo(1.3, 10);
  });

  test("input images beyond the first five add $0.04 each", () => {
    const content = [text(), ...Array.from({ length: 7 }, () => image("reference_image"))];
    const r = videoV2.safe({
      model: "MiniMax-H3",
      content,
      resolution: "768P",
      duration: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeCloseTo(0.08 * 6 + 2 * VIDEO_V2_USD_PER_EXTRA_IMAGE, 10);
    }
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = videoV2 as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "MiniMax-H3", content: [text()], resolution: "768P", duration: 6 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
