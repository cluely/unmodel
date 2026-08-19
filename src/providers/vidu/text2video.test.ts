import { describe, expect, test } from "bun:test";
import { text2video, TEXT2VIDEO_URL, TEXT2VIDEO_SUPPORT } from "./text2video";
import { img2video, IMG2VIDEO_URL, IMG2VIDEO_SUPPORT } from "./img2video";
import { REFERENCE2VIDEO_SUPPORT } from "./reference2video";
import { VIDU_RESOLUTIONS } from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = text2video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("vidu.text2video happy path", () => {
  test("wire-pure body with URL and method", () => {
    const v = text2video({
      model: "viduq3-pro",
      prompt: "an astronaut walks through fog",
      resolution: "1080p",
      duration: 8,
    });
    expect(Object.keys(v)).toEqual(["model", "prompt", "resolution", "duration"]);
    expect(v.request.url).toBe(TEXT2VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("vidu")).toEqual({
      model: "viduq3-pro",
      prompt: "an astronaut walks through fog",
      resolution: "1080p",
      duration: 8,
    });
  });

  test("unknown model warns but validates", () => {
    const r = text2video.safe({ model: "viduq4", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("vidu.text2video route rules", () => {
  test("img2video-only models have no arm here", () => {
    const r = text2video.safe({ model: "viduq3-pro-fast", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.meta?.supported).toEqual(["viduq3-pro", "viduq3-turbo", "viduq2", "viduq1"]);
    }
  });

  test("viduq1 is 5s / 1080p only", () => {
    const duration = text2video.safe({ model: "viduq1", prompt: "hi", duration: 8 });
    expect(duration.ok).toBe(false);
    if (!duration.ok) {
      expect(duration.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual([
        "duration",
      ]);
    }

    const resolution = text2video.safe({ model: "viduq1", prompt: "hi", resolution: "720p" });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual(
        ["1080p"],
      );
    }
  });

  test("viduq2 caps at 10 seconds", () => {
    const r = text2video.safe({ model: "viduq2", prompt: "hi", duration: 16 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.max).toBe(10);
  });

  test("bgm on q3 warns as silently ignored, not an error", () => {
    const r = text2video.safe({ model: "viduq3-pro", prompt: "hi", bgm: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warning = r.warnings.find((w) => w.code === "unsupported_param");
      expect(warning?.path).toEqual(["bgm"]);
      expect(warning?.meta?.ignored).toBe(true);
    }
  });

  test("prompt over 5000 characters is invalid_shape", () => {
    const r = safeUnchecked({ model: "viduq3-pro", prompt: "a".repeat(5001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });
});

describe("vidu.text2video cost estimation", () => {
  test("q3-pro rate follows the resolution", () => {
    const hd = text2video.safe({
      model: "viduq3-pro",
      prompt: "hi",
      resolution: "1080p",
      duration: 10,
    });
    expect(hd.ok).toBe(true);
    if (hd.ok) expect(hd.estimate.costUSD).toBeCloseTo(1.2, 10); // $0.12/s

    const low = text2video.safe({
      model: "viduq3-pro",
      prompt: "hi",
      resolution: "540p",
      duration: 10,
    });
    expect(low.ok).toBe(true);
    if (low.ok) expect(low.estimate.costUSD).toBeCloseTo(0.45, 10); // $0.045/s
  });

  test("off_peak halves the q3 rate", () => {
    const r = text2video.safe({
      model: "viduq3-turbo",
      prompt: "hi",
      resolution: "720p",
      duration: 10,
      off_peak: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.3, 10); // $0.03/s
  });

  test("defaults fill in when resolution and duration are omitted", () => {
    const r = text2video.safe({ model: "viduq3-pro", prompt: "hi" });
    expect(r.ok).toBe(true);
    // 720p default × 5s default at $0.10/s.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.5, 10);
  });

  test("the q2 tiered curve produces no estimate", () => {
    const r = text2video.safe({ model: "viduq2", prompt: "hi", duration: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("vidu.img2video", () => {
  test("wire-pure body", () => {
    const v = img2video({
      model: "viduq3-pro",
      images: ["https://example.com/start.png"],
      prompt: "the camera drifts left",
      duration: 5,
    });
    expect(v.request.url).toBe(IMG2VIDEO_URL);
    expect(Object.keys(v)).toEqual(["model", "images", "prompt", "duration"]);
  });

  test("exactly one start-frame image", () => {
    const r = img2video.safe({
      model: "viduq3-pro",
      images: ["https://example.com/a.png", "https://example.com/b.png"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["images"]);
      expect(issue?.meta?.max).toBe(1);
    }
  });

  test("vidu2.0 at 8s is 720p-only", () => {
    const r = img2video.safe({
      model: "vidu2.0",
      images: ["https://example.com/a.png"],
      duration: 8,
      resolution: "1080p",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual(["720p"]);
    }
    expect(
      img2video.safe({
        model: "vidu2.0",
        images: ["https://example.com/a.png"],
        duration: 8,
        resolution: "720p",
      }).ok,
    ).toBe(true);
  });

  test("vidu2.0 flat per-generation price", () => {
    const r = img2video.safe({
      model: "vidu2.0",
      images: ["https://example.com/a.png"],
      duration: 4,
      resolution: "1080p",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.5, 10);
  });

  test("every ViduResolution preset validates on the model that offers it", () => {
    // Keep in sync with ViduResolution in shared.ts: the union spans every
    // documented resolution across the video routes and each route's support
    // table narrows it per model. No single model offers all four — 360p is
    // vidu2.0's alone (and vidu2.0 has no 540p tier), so the presets are
    // looped against the model that allows each.
    for (const resolution of ["540p", "720p", "1080p"] as const) {
      const r = text2video.safe({ model: "viduq3-pro", prompt: "hi", resolution });
      expect(r.ok, `text2video ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `text2video ${resolution}`).toEqual([]);
    }
    for (const resolution of ["360p", "720p", "1080p"] as const) {
      const r = img2video.safe({
        model: "vidu2.0",
        images: ["https://example.com/a.png"],
        duration: 4,
        resolution,
      });
      expect(r.ok, `img2video ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `img2video ${resolution}`).toEqual([]);
    }
    const r540 = img2video.safe({
      model: "viduq3-pro",
      images: ["https://example.com/a.png"],
      resolution: "540p",
    });
    expect(r540.ok).toBe(true);
    if (r540.ok) expect(r540.warnings).toEqual([]);
  });

  test("viduq1 charges the flat 5s generation price", () => {
    const r = img2video.safe({
      model: "viduq1",
      images: ["https://example.com/a.png"],
      duration: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.4, 10);
  });
});

describe("vidu resolution union covers the route support tables", () => {
  test("every documented resolution lands in ViduResolution", () => {
    // ViduResolution is the autocomplete for these tables, so a new tier has
    // to be added to shared.ts too — otherwise the type would advertise less
    // than the validators accept.
    for (const table of [TEXT2VIDEO_SUPPORT, IMG2VIDEO_SUPPORT, REFERENCE2VIDEO_SUPPORT]) {
      for (const [model, rules] of Object.entries(table)) {
        for (const resolution of rules.resolutions) {
          expect(VIDU_RESOLUTIONS as readonly string[], model).toContain(resolution);
        }
      }
    }
  });
});
