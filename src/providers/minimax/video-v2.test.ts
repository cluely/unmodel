import { describe, expect, test } from "bun:test";
import {
  videoV2,
  videoV2QueryUrl,
  VIDEO_GENERATION_V2_URL,
  VIDEO_V2_QUERY_URL,
  VIDEO_V2_MAX_REFERENCE_IMAGES,
  VIDEO_V2_MODEL_IDS,
  VIDEO_V2_MODEL_RULES,
  VIDEO_V2_PROMPT_EXPANSION_MODES,
  VIDEO_V2_RATIOS,
} from "./video-v2";
import type { MinimaxV2Role, MinimaxVideoV2Resolution } from "./video-v2";
import { videoV2Models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = videoV2.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const text = (value = "A neon-lit street at night") => ({ type: "text" as const, text: value });
// `role` is the closed wire vocabulary now, so the fixture helper says so. The
// off-list negative tests below go through `safeUnchecked`, which is where an
// untyped runtime value belongs.
const image = (role?: MinimaxV2Role) => ({
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

  test("only the H3 line is accepted", () => {
    expect([...VIDEO_V2_MODEL_IDS]).toEqual([
      "MiniMax-H3",
      "MiniMax-H3-Highspeed",
      "MiniMax-H3-Lite",
      "MiniMax-H3-Max",
    ]);
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
    // The v2 catalog holds the H3 line only, so every other id — including the
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

  test("every model's documented resolution / duration / ratio preset validates", () => {
    // Keep in sync with MinimaxVideoV2Resolution, MinimaxVideoV2Duration and
    // MinimaxVideoV2Ratio — the unions are closed, so every value a model's
    // rule advertises has to pass the runtime checks that back them.
    for (const model of VIDEO_V2_MODEL_IDS) {
      const rule = VIDEO_V2_MODEL_RULES[model as keyof typeof VIDEO_V2_MODEL_RULES];
      for (const resolution of Object.keys(rule.usdPerSecond) as MinimaxVideoV2Resolution[]) {
        const r = videoV2.safe({ model, content: [text()], resolution, duration: 6, ratio: "16:9" });
        expect(r.ok, `${model} ${resolution} should validate`).toBe(true);
        if (r.ok) expect(r.warnings, `${model} ${resolution} should be warning-free`).toEqual([]);
      }
      for (const duration of rule.durations) {
        const r = videoV2.safe({ model, content: [text()], resolution: "768P", duration, ratio: "16:9" });
        expect(r.ok, `${model} duration ${duration} should validate`).toBe(true);
        if (r.ok) expect(r.warnings, `${model} duration ${duration} should be warning-free`).toEqual([]);
      }
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

describe("minimax.videoV2 per-model rules", () => {
  test("MiniMax-H3 renders 768P/2K; the other three 480P/768P", () => {
    const h3At480 = videoV2.safe({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "480P",
      duration: 6,
      ratio: "16:9",
    });
    expect(h3At480.ok).toBe(false);
    if (!h3At480.ok) {
      expect(h3At480.errors[0]?.path).toEqual(["resolution"]);
      expect(h3At480.errors[0]?.message).toContain('"768P", "2K" for "MiniMax-H3"');
    }
    for (const model of ["MiniMax-H3-Highspeed", "MiniMax-H3-Lite", "MiniMax-H3-Max"] as const) {
      const at2k = videoV2.safe({ model, content: [text()], resolution: "2K", duration: 6, ratio: "16:9" });
      expect(at2k.ok, model).toBe(false);
      if (!at2k.ok) expect(at2k.errors[0]?.message).toContain(`"480P", "768P" for "${model}"`);
    }
  });

  test("MiniMax-H3-Max starts at 5 seconds; the others at 4", () => {
    const max4 = videoV2.safe({
      model: "MiniMax-H3-Max",
      content: [text()],
      resolution: "768P",
      duration: 4,
      ratio: "16:9",
    });
    expect(max4.ok).toBe(false);
    if (!max4.ok) {
      expect(max4.errors[0]?.path).toEqual(["duration"]);
      expect(max4.errors[0]?.message).toContain('between 5 and 15 seconds for "MiniMax-H3-Max"');
    }
    for (const model of ["MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite"] as const) {
      const r = videoV2.safe({ model, content: [text()], resolution: "768P", duration: 4, ratio: "16:9" });
      expect(r.ok, model).toBe(true);
    }
  });

  test("MiniMax-H3-Lite needs a concrete ratio for reference-to-video", () => {
    const content = [text(), image("reference_image")];
    for (const ratio of [undefined, "adaptive"] as const) {
      const r = videoV2.safe({
        model: "MiniMax-H3-Lite",
        content,
        resolution: "768P",
        duration: 6,
        ...(ratio !== undefined && { ratio }),
      });
      expect(r.ok, `ratio ${ratio}`).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.path).toEqual(["ratio"]);
        expect(r.errors[0]?.message).toContain('"MiniMax-H3-Lite" does not support an "adaptive"');
      }
    }
    expect(
      videoV2.safe({ model: "MiniMax-H3-Lite", content, resolution: "768P", duration: 6, ratio: "9:16" })
        .ok,
    ).toBe(true);
    // The other models default reference-to-video to "adaptive" without complaint.
    expect(
      videoV2.safe({ model: "MiniMax-H3-Highspeed", content, resolution: "768P", duration: 6 }).ok,
    ).toBe(true);
  });

  test("extra.prompt_expansion_mode is MiniMax-H3-Max's, and closed", () => {
    for (const mode of VIDEO_V2_PROMPT_EXPANSION_MODES) {
      const r = videoV2.safe({
        model: "MiniMax-H3-Max",
        content: [text()],
        resolution: "768P",
        duration: 6,
        ratio: "16:9",
        extra: { prompt_expansion_mode: mode },
      });
      expect(r.ok, mode).toBe(true);
      if (r.ok) expect(r.warnings, mode).toEqual([]);
    }

    // "Do not pass `balance`, an empty string, a Boolean value, or other
    // undeclared fields."
    const base = { model: "MiniMax-H3-Max", content: [text()], resolution: "768P", duration: 6, ratio: "16:9" };
    for (const mode of ["balance", ""]) {
      const r = safeUnchecked({ ...base, extra: { prompt_expansion_mode: mode } });
      expect(r.ok, JSON.stringify(mode)).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["extra", "prompt_expansion_mode"]);
    }
    expect(safeUnchecked({ ...base, extra: { prompt_expansion_mode: true } }).ok).toBe(false);
    expect(safeUnchecked({ ...base, extra: { seed: 1 } }).ok).toBe(false);

    // Documented for MiniMax-H3-Max only: elsewhere it is flagged, not refused.
    const onH3 = videoV2.safe({
      model: "MiniMax-H3",
      content: [text()],
      resolution: "768P",
      duration: 6,
      ratio: "16:9",
      extra: { prompt_expansion_mode: "quality" },
    });
    expect(onH3.ok).toBe(true);
    if (onH3.ok) {
      expect(onH3.warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["extra"]]]);
    }
  });
});

describe("minimax.videoV2 pricing", () => {
  test("every model prices per second at each resolution it renders", () => {
    const expected: Record<string, Partial<Record<MinimaxVideoV2Resolution, number>>> = {
      "MiniMax-H3": { "768P": 0.08, "2K": 0.13 },
      "MiniMax-H3-Highspeed": { "480P": 0.04, "768P": 0.06 },
      "MiniMax-H3-Lite": { "480P": 0.025, "768P": 0.04 },
      "MiniMax-H3-Max": { "480P": 0.05, "768P": 0.08 },
    };
    for (const [model, rates] of Object.entries(expected)) {
      // The catalog row carries the 768P rate, the one tier all four render.
      const row: { cost: { perVideoSecond: number } } =
        videoV2Models[model as keyof typeof videoV2Models];
      expect(row.cost.perVideoSecond).toBe(rates["768P"]!);
      for (const [resolution, rate] of Object.entries(rates)) {
        const r = videoV2.safe({
          model,
          content: [text()],
          resolution: resolution as MinimaxVideoV2Resolution,
          duration: 10,
          ratio: "16:9",
        });
        expect(r.ok, `${model} ${resolution}`).toBe(true);
        if (r.ok) expect(r.estimate.costUSD, `${model} ${resolution}`).toBeCloseTo(rate * 10, 10);
      }
    }
  });

  test("MiniMax-H3-Max bills images beyond the first two at $0.074", () => {
    const content = [text(), ...Array.from({ length: 4 }, () => image("reference_image"))];
    const r = videoV2.safe({ model: "MiniMax-H3-Max", content, resolution: "480P", duration: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05 * 5 + 2 * 0.074, 10);
  });

  test("output seconds are billed per resolution", () => {
    expect(VIDEO_V2_MODEL_RULES["MiniMax-H3"].usdPerSecond["768P"]).toBe(0.08);
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
      expect(r.estimate.costUSD).toBeCloseTo(
        0.08 * 6 + 2 * VIDEO_V2_MODEL_RULES["MiniMax-H3"].usdPerExtraImage,
        10,
      );
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
