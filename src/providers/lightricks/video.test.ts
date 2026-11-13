import { describe, expect, test } from "bun:test";
import { video, TEXT_TO_VIDEO_URL } from "./video";
import {
  GENERATION_MODELS,
  LONG_DURATIONS,
  LTX_FPS_VALUES,
  LTX_RESOLUTIONS,
  RESOLUTION_SHAPES,
  SUPPORT_MATRIX,
} from "./shared";
import { LIGHTRICKS_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("lightricks.video happy path", () => {
  test("returns a wire-pure body on the v2 async URL", () => {
    const v = video({
      model: "ltx-2-3-pro",
      prompt: "a lighthouse beam sweeps across the water",
      resolution: "1920x1080",
      duration: 8,
    });
    expect(Object.keys(v)).toEqual(["model", "prompt", "resolution", "duration"]);
    expect(v.request.url).toBe(TEXT_TO_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("the one generation route is the v2 job API", () => {
    expect(TEXT_TO_VIDEO_URL).toBe("https://api.ltx.io/v2/text-to-video");
  });

  test("unknown model warns but validates", () => {
    const r = video.safe({
      model: "ltx-3",
      prompt: "hi",
      resolution: "1280x720",
      duration: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("lightricks.video support matrix", () => {
  test("ltx-2-5-pro reaches 1440p and 4K at 48fps", () => {
    for (const resolution of ["2560x1440", "3840x2160", "2160x3840"] as const) {
      const r = video.safe({ model: "ltx-2-5-pro", prompt: "hi", resolution, duration: 6, fps: 48 });
      expect(r.ok, resolution).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("ltx-2-5-pro still caps at 10s and at the four published frame rates", () => {
    const long = video.safe({ model: "ltx-2-5-pro", prompt: "hi", resolution: "3840x2160", duration: 12 });
    expect(long.ok).toBe(false);
    if (!long.ok) {
      const issue = long.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["duration"]);
      expect(issue?.meta?.allowed).toEqual([6, 8, 10]);
    }
    const fps = safeUnchecked({
      model: "ltx-2-5-pro",
      prompt: "hi",
      resolution: "1920x1080",
      duration: 6,
      fps: 30,
    });
    expect(fps.ok).toBe(false);
    if (!fps.ok) {
      const issue = fps.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["fps"]);
      expect(issue?.meta?.allowed).toEqual([24, 25, 48, 50]);
    }
  });

  test("LTX-2.5 takes the 1:1, 3:2 and 2:3 sizes at every tier", () => {
    for (const model of ["ltx-2-5-fast", "ltx-2-5-pro"] as const) {
      for (const resolution of ["720x720", "1620x1080", "1440x2160", "3240x2160"] as const) {
        const r = video.safe({ model, prompt: "hi", resolution, duration: 6 });
        expect(r.ok, `${model} ${resolution}`).toBe(true);
        if (r.ok) expect(r.warnings).toEqual([]);
      }
    }
  });

  test("LTX-2.3 refuses them, naming its 16:9 and 9:16 sizes", () => {
    for (const model of ["ltx-2-3-fast", "ltx-2-3-pro"] as const) {
      const r = video.safe({ model, prompt: "hi", resolution: "1080x1080", duration: 6 });
      expect(r.ok, model).toBe(false);
      if (r.ok) continue;
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["resolution"]);
      expect(issue?.meta?.allowed).toEqual([
        "1280x720",
        "720x1280",
        "1920x1080",
        "1080x1920",
        "2560x1440",
        "1440x2560",
        "3840x2160",
        "2160x3840",
      ]);
    }
  });

  test("long durations are 24/25fps-only on the fast variants", () => {
    expect(
      video.safe({
        model: "ltx-2-3-fast",
        prompt: "hi",
        resolution: "1280x720",
        duration: 20,
      }).ok,
    ).toBe(true);

    const at48 = video.safe({
      model: "ltx-2-3-fast",
      prompt: "hi",
      resolution: "1280x720",
      duration: 20,
      fps: 48,
    });
    expect(at48.ok).toBe(false);
    if (!at48.ok) {
      const issue = at48.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["duration"]);
      expect(issue?.meta?.allowed).toEqual([6, 8, 10]);
    }
  });

  test("pro variants cap at 10 seconds", () => {
    const r = video.safe({
      model: "ltx-2-3-pro",
      prompt: "hi",
      resolution: "1280x720",
      duration: 12,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["duration"]);
  });

  test("automatic duration is LTX-2.5-only", () => {
    expect(
      video.safe({
        model: "ltx-2-5-fast",
        prompt: "hi",
        resolution: "1280x720",
        duration: null,
      }).ok,
    ).toBe(true);

    const pro23 = video.safe({
      model: "ltx-2-3-pro",
      prompt: "hi",
      resolution: "1280x720",
      duration: null,
    });
    expect(pro23.ok).toBe(false);
    if (!pro23.ok) {
      expect(pro23.errors.find((e) => e.code === "unsupported_capability")?.path).toEqual([
        "duration",
      ]);
    }
  });

  test("duration is required by the spec", () => {
    const r = safeUnchecked({ model: "ltx-2-3-pro", prompt: "hi", resolution: "1280x720" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["duration"]);
  });
});

describe("lightricks.video preset unions", () => {
  test("every LtxResolution preset passes on a model whose matrix covers them all", () => {
    // Keep in sync with LtxResolution in shared.ts. LTX-2.5 renders all four
    // tiers in all five shapes at the default 24fps with a 6s duration (LTX-2.3
    // has only 16:9 and 9:16), so the whole preset list is looped against
    // ltx-2-5-pro.
    for (const resolution of LTX_RESOLUTIONS) {
      const r = video.safe({
        model: "ltx-2-5-pro",
        prompt: "hi",
        resolution,
        duration: 6,
      });
      expect(r.ok, `preset ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${resolution} should be warning-free`).toEqual([]);
    }
  });

  test("every LtxFps preset passes on a model whose matrix covers them all", () => {
    // Keep in sync with LtxFps in shared.ts. The pro variants publish
    // 24/25/48/50 at every tier (the fast variants only reach 48/50 with the
    // short durations), so ltx-2-3-pro covers the whole union at one
    // resolution × duration.
    for (const fps of LTX_FPS_VALUES) {
      const r = video.safe({
        model: "ltx-2-3-pro",
        prompt: "hi",
        resolution: "1920x1080",
        duration: 6,
        fps,
      });
      expect(r.ok, `preset ${fps}fps should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${fps}fps should be warning-free`).toEqual([]);
    }
  });

  test("every LtxDuration preset passes on a model whose matrix covers them all", () => {
    // Keep in sync with LtxDuration in shared.ts. The long-form durations are
    // 24/25fps-only and fast-variant-only (the pro variants cap at 10s), so the
    // full union is looped against ltx-2-3-fast at 720p and the default 24fps —
    // the combination the matrix documents as covering all eight values.
    for (const duration of LONG_DURATIONS) {
      const r = video.safe({
        model: "ltx-2-3-fast",
        prompt: "hi",
        resolution: "1280x720",
        duration,
      });
      expect(r.ok, `preset ${duration}s should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${duration}s should be warning-free`).toEqual([]);
    }
  });
});

describe("lightricks.video cost estimation", () => {
  test("rate follows the resolution tier", () => {
    const hd = video.safe({
      model: "ltx-2-3-pro",
      prompt: "hi",
      resolution: "1920x1080",
      duration: 10,
    });
    expect(hd.ok).toBe(true);
    if (hd.ok) expect(hd.estimate.costUSD).toBeCloseTo(0.8, 10); // $0.08/s

    const fourK = video.safe({
      model: "ltx-2-3-pro",
      prompt: "hi",
      resolution: "3840x2160",
      duration: 10,
    });
    expect(fourK.ok).toBe(true);
    if (fourK.ok) expect(fourK.estimate.costUSD).toBeCloseTo(3.2, 10); // $0.32/s
  });

  test("ltx-2-5-pro prices its 1440p and 4K tiers", () => {
    const qhd = video.safe({ model: "ltx-2-5-pro", prompt: "hi", resolution: "2560x1440", duration: 6 });
    expect(qhd.ok).toBe(true);
    if (qhd.ok) expect(qhd.estimate.costUSD).toBeCloseTo(1.5, 10); // $0.25/s
    const fourK = video.safe({ model: "ltx-2-5-pro", prompt: "hi", resolution: "3840x2160", duration: 10 });
    expect(fourK.ok).toBe(true);
    if (fourK.ok) expect(fourK.estimate.costUSD).toBeCloseTo(3.9, 10); // $0.39/s
  });

  test("a 1:1, 3:2 or 2:3 size bills at its short side's tier", () => {
    const square = video.safe({ model: "ltx-2-5-fast", prompt: "hi", resolution: "1080x1080", duration: 10 });
    expect(square.ok).toBe(true);
    if (square.ok) expect(square.estimate.costUSD).toBeCloseTo(1.3, 10); // 1080p, $0.13/s
    const wide = video.safe({ model: "ltx-2-5-pro", prompt: "hi", resolution: "3240x2160", duration: 6 });
    expect(wide.ok).toBe(true);
    if (wide.ok) expect(wide.estimate.costUSD).toBeCloseTo(2.34, 10); // 4K, $0.39/s
  });

  test("automatic duration produces no estimate", () => {
    const r = video.safe({
      model: "ltx-2-5-fast",
      prompt: "hi",
      resolution: "1280x720",
      duration: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("over-budget is reported", () => {
    const r = video.safe(
      { model: "ltx-2-5-fast", prompt: "hi", resolution: "3840x2160", duration: 10 },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });
});

describe("lightricks.video support matrix coverage", () => {
  test("an off-matrix resolution and fps are rejected", () => {
    const res = safeUnchecked({
      model: "ltx-2-3-pro",
      prompt: "x",
      duration: 6,
      resolution: "99999x99999",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual(["resolution"]);

    const fps = safeUnchecked({
      model: "ltx-2-3-fast",
      prompt: "x",
      duration: 6,
      resolution: "1920x1080",
      fps: 10_000,
    });
    expect(fps.ok).toBe(false);
    if (!fps.ok) expect(fps.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual(["fps"]);
  });

  test("every documented model id is matrix-checked", () => {
    for (const model of GENERATION_MODELS) {
      expect(SUPPORT_MATRIX[model]).toBeDefined();
      expect(RESOLUTION_SHAPES[model]).toBeDefined();
    }
  });

  test("the unified rows say what the matrix enforces", () => {
    // `unmodel/video` narrows `resolution` and `aspectRatio` from these rows at
    // compile time; the endpoint enforces SUPPORT_MATRIX × RESOLUTION_SHAPES at
    // run time. A row wider than the matrix offers a value the endpoint
    // refuses; a narrower one hides a value LTX serves.
    expect([...MODELS]).toEqual([...GENERATION_MODELS]);
    for (const model of MODELS) {
      const row = LIGHTRICKS_VIDEO_MODEL_PARAMS[model];
      const tiers = new Set((SUPPORT_MATRIX[model] ?? []).flatMap((r) => r.tiers));
      expect([...row.resolutions], model).toEqual([...tiers]);
      expect([...row.ratios], model).toEqual([...(RESOLUTION_SHAPES[model] ?? [])]);
    }
  });
});
