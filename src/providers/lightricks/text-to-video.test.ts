import { describe, expect, test } from "bun:test";
import { textToVideo, TEXT_TO_VIDEO_URL, TEXT_TO_VIDEO_V1_URL } from "./text-to-video";
import {
  GENERATION_MODELS,
  LONG_DURATIONS,
  LTX_2_DEPRECATION_SOURCE,
  LTX_FPS_VALUES,
  LTX_RESOLUTIONS,
  SUPPORT_MATRIX,
} from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = textToVideo.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("lightricks.textToVideo happy path", () => {
  test("returns a wire-pure body on the v2 async URL", () => {
    const v = textToVideo({
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

  test("api_version is stripped from the body and swaps the path", () => {
    const v = textToVideo({
      model: "ltx-2-3-fast",
      prompt: "rain on a window",
      resolution: "1280x720",
      duration: 6,
      api_version: "v1",
    });
    expect(Object.keys(v)).not.toContain("api_version");
    expect(v.request.url).toBe(TEXT_TO_VIDEO_V1_URL);
  });

  test("unknown model warns but validates", () => {
    const r = textToVideo.safe({
      model: "ltx-3",
      prompt: "hi",
      resolution: "1280x720",
      duration: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("deprecated LTX-2 warns", () => {
    const r = textToVideo.safe({
      model: "ltx-2-pro",
      prompt: "hi",
      resolution: "1280x720",
      duration: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("deprecated_model");
  });
});

describe("lightricks.textToVideo support matrix", () => {
  test("ltx-2-5-pro tops out at 1080p", () => {
    const r = textToVideo.safe({
      model: "ltx-2-5-pro",
      prompt: "hi",
      resolution: "3840x2160",
      duration: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["resolution"]);
      expect(issue?.meta?.allowed).toEqual(["1280x720", "720x1280", "1920x1080", "1080x1920"]);
    }
  });

  test("ltx-2-5-pro does not offer 48fps", () => {
    const r = textToVideo.safe({
      model: "ltx-2-5-pro",
      prompt: "hi",
      resolution: "1920x1080",
      duration: 6,
      fps: 48,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["fps"]);
      expect(issue?.meta?.allowed).toEqual([24, 25, 50]);
    }
  });

  test("long durations are 24/25fps-only on the fast variants", () => {
    expect(
      textToVideo.safe({
        model: "ltx-2-3-fast",
        prompt: "hi",
        resolution: "1280x720",
        duration: 20,
      }).ok,
    ).toBe(true);

    const at48 = textToVideo.safe({
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
    const r = textToVideo.safe({
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
      textToVideo.safe({
        model: "ltx-2-5-fast",
        prompt: "hi",
        resolution: "1280x720",
        duration: null,
      }).ok,
    ).toBe(true);

    const pro23 = textToVideo.safe({
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

describe("lightricks.textToVideo preset unions", () => {
  test("every LtxResolution preset passes on a model whose matrix covers them all", () => {
    // Keep in sync with LtxResolution in shared.ts. ltx-2-3-pro is the one
    // model whose published matrix accepts all four tiers (720p/1080p/1440p/4k,
    // both orientations) at the default 24fps with a 6s duration, so the whole
    // preset list is looped against it.
    for (const resolution of LTX_RESOLUTIONS) {
      const r = textToVideo.safe({
        model: "ltx-2-3-pro",
        prompt: "hi",
        resolution,
        duration: 6,
      });
      expect(r.ok, `preset ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${resolution} should be warning-free`).toEqual([]);
    }
  });

  test("every LtxFps preset passes on a model whose matrix covers them all", () => {
    // Keep in sync with LtxFps in shared.ts. ltx-2-3-pro publishes 24/25/48/50
    // at every tier (ltx-2-5-pro omits 48, and the fast variants only reach
    // 48/50 with the short durations), so it is the model that covers the
    // whole union at one resolution × duration.
    for (const fps of LTX_FPS_VALUES) {
      const r = textToVideo.safe({
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
      const r = textToVideo.safe({
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

describe("lightricks.textToVideo cost estimation", () => {
  test("rate follows the resolution tier", () => {
    const hd = textToVideo.safe({
      model: "ltx-2-3-pro",
      prompt: "hi",
      resolution: "1920x1080",
      duration: 10,
    });
    expect(hd.ok).toBe(true);
    if (hd.ok) expect(hd.estimate.costUSD).toBeCloseTo(0.8, 10); // $0.08/s

    const fourK = textToVideo.safe({
      model: "ltx-2-3-pro",
      prompt: "hi",
      resolution: "3840x2160",
      duration: 10,
    });
    expect(fourK.ok).toBe(true);
    if (fourK.ok) expect(fourK.estimate.costUSD).toBeCloseTo(3.2, 10); // $0.32/s
  });

  test("automatic duration produces no estimate", () => {
    const r = textToVideo.safe({
      model: "ltx-2-5-fast",
      prompt: "hi",
      resolution: "1280x720",
      duration: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("over-budget is reported", () => {
    const r = textToVideo.safe(
      { model: "ltx-2-5-fast", prompt: "hi", resolution: "3840x2160", duration: 10 },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });
});

// ---------------------------------------------------------------------------
// The deprecated LTX-2 pair. Its matrix is published on
// https://docs.ltx.io/ltx-2-deprecation.md, not on the models page; before it
// was encoded these ids were absent from SUPPORT_MATRIX, so `duration` — a
// REQUIRED field here — took any number with only a deprecated_model warning.
// ---------------------------------------------------------------------------

describe("lightricks.textToVideo deprecated LTX-2 support matrix", () => {
  test.each(["ltx-2-fast", "ltx-2-pro"])("%s rejects an absurd duration", (model) => {
    const r = textToVideo.safe({
      model,
      prompt: "x",
      duration: 10_000_000_000,
      resolution: "1920x1080",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "invalid_enum_value");
    expect(issue?.path).toEqual(["duration"]);
    expect(issue?.meta?.allowed).toContain(10);
    expect(issue?.meta?.source).toBe(LTX_2_DEPRECATION_SOURCE);
  });

  test.each(["ltx-2-fast", "ltx-2-pro"])("%s still accepts a documented duration", (model) => {
    for (const duration of [6, 8, 10]) {
      const r = textToVideo.safe({ model, prompt: "x", duration, resolution: "1920x1080" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("deprecated_model");
    }
  });

  test("ltx-2-fast keeps its long window at 1080p; ltx-2-pro tops out at 10s", () => {
    expect(
      textToVideo.safe({ model: "ltx-2-fast", prompt: "x", duration: 20, resolution: "1920x1080" })
        .ok,
    ).toBe(true);
    const pro = textToVideo.safe({
      model: "ltx-2-pro",
      prompt: "x",
      duration: 20,
      resolution: "1920x1080",
    });
    expect(pro.ok).toBe(false);
    if (!pro.ok) expect(pro.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([6, 8, 10]);
  });

  test("an off-matrix resolution and fps are rejected too", () => {
    const res = safeUnchecked({
      model: "ltx-2-pro",
      prompt: "x",
      duration: 6,
      resolution: "99999x99999",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual(["resolution"]);

    const fps = safeUnchecked({
      model: "ltx-2-fast",
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
    }
  });
});
