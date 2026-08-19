import { describe, expect, test } from "bun:test";
import {
  image,
  krea2Url,
  KREA_JOBS_URL,
  KREA_ASPECT_RATIOS,
  KREA_RESOLUTIONS,
  KREA_CREATIVITY_MODES,
} from "./image";
import { models, KREA_BILLING_TIERS } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("krea.image happy path", () => {
  test("model is stripped onto the route and the body is fetch-ready", () => {
    const v = image({
      model: "krea-2/medium",
      prompt: "a cinematic glass cabin beside a frozen lake at sunrise",
      aspect_ratio: "16:9",
      resolution: "1K",
      creativity: "medium",
    });
    expect(Object.keys(v)).toEqual(["prompt", "aspect_ratio", "resolution", "creativity"]);
    expect(v.request.url).toBe("https://api.krea.ai/generate/image/krea/krea-2/medium");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(JSON.stringify(v))).not.toHaveProperty("model");
  });

  test("every catalog id builds its own route", () => {
    expect(krea2Url("krea-2/large")).toBe("https://api.krea.ai/generate/image/krea/krea-2/large");
    expect(krea2Url("krea-2/medium-turbo")).toBe(
      "https://api.krea.ai/generate/image/krea/krea-2/medium-turbo",
    );
    expect(KREA_JOBS_URL).toBe("https://api.krea.ai/jobs");
    expect(Object.keys(models)).toEqual([
      "krea-2/medium",
      "krea-2/large",
      "krea-2/medium-turbo",
    ]);
  });

  test("an unknown route warns but still validates", () => {
    const r = safeUnchecked({
      model: "krea-3/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });
});

describe("krea.image enums", () => {
  // These three spaces are CLOSED (the OpenAPI enums are complete and the body
  // is additionalProperties: false), so the params types dropped their
  // `(string & {})` tails. Every arm the types now advertise must validate.
  test("every KreaAspectRatio preset validates", () => {
    // Keep in sync with KreaAspectRatio
    for (const aspect_ratio of KREA_ASPECT_RATIOS) {
      const r = image.safe({ model: "krea-2/medium", prompt: "x", aspect_ratio, resolution: "1K" });
      expect(r.ok, `aspect_ratio ${aspect_ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("every KreaResolution preset validates", () => {
    // Keep in sync with KreaResolution
    for (const resolution of KREA_RESOLUTIONS) {
      const r = image.safe({ model: "krea-2/medium", prompt: "x", aspect_ratio: "1:1", resolution });
      expect(r.ok, `resolution ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${resolution} should be warning-free`).toEqual([]);
    }
  });

  test("every KreaCreativity preset validates", () => {
    // Keep in sync with KreaCreativity
    for (const creativity of KREA_CREATIVITY_MODES) {
      const r = image.safe({
        model: "krea-2/medium",
        prompt: "x",
        aspect_ratio: "1:1",
        resolution: "1K",
        creativity,
      });
      expect(r.ok, `creativity ${creativity} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${creativity} should be warning-free`).toEqual([]);
    }
  });

  test("aspect_ratio is checked against the Krea 2 list", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "21:9",
      resolution: "1K",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["aspect_ratio"]);
    }
  });

  test("resolution only accepts 1K today", () => {
    const r = safeUnchecked({
      model: "krea-2/large",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "2K",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("1K");
  });

  test("creativity is checked", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      creativity: "wild",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["creativity"]);
  });

  test("prompt, aspect_ratio and resolution are required", () => {
    const r = safeUnchecked({ model: "krea-2/medium", prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => e.code === "invalid_shape")).toBe(true);
  });
});

describe("krea.image ranges", () => {
  test("generative sliders are bounded at -100..100", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      intensity: 120,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["intensity"]);

    const ok = image.safe({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      intensity: -100,
      complexity: 100,
      movement: 0,
    });
    expect(ok.ok).toBe(true);
  });

  test("styles entries require id and a -2..2 strength", () => {
    const missing = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      styles: [{ id: "abc" }],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["styles", 0, "strength"]);

    const outOfRange = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      styles: [{ id: "abc", strength: 3 }],
    });
    expect(outOfRange.ok).toBe(false);
  });

  test("style references cap at 10 and bound strength at 0..1", () => {
    const many = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: Array.from({ length: 11 }, () => ({ url: "https://x/y.png" })),
    });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors[0]?.path).toEqual(["image_style_references"]);

    // 1.5 is inside the style-transfer guide's -2…2 but outside the served
    // schema's 0…1: a warning that names both sources, not a hard failure.
    const contested = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: [{ url: "https://x/y.png", strength: 1.5 }],
    });
    expect(contested.ok).toBe(true);
    if (contested.ok) {
      expect(contested.warnings.some((w) => w.message.includes("0…1"))).toBe(true);
    }

    // 3 is outside both documented ranges.
    const strong = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: [{ url: "https://x/y.png", strength: 3 }],
    });
    expect(strong.ok).toBe(false);
    if (!strong.ok) expect(strong.errors[0]?.path).toEqual([
      "image_style_references",
      0,
      "strength",
    ]);
  });

  test("an oversized data-URI style reference is reported", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: [{ url: `data:image/png;base64,${"A".repeat(1100)}` }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("1024");
  });

  test("moodboards are limited to one and require an id", () => {
    const two = safeUnchecked({
      model: "krea-2/large",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      moodboards: [{ id: "a" }, { id: "b" }],
    });
    expect(two.ok).toBe(false);

    const noId = safeUnchecked({
      model: "krea-2/large",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      moodboards: [{ strength: 0.35 }],
    });
    expect(noId.ok).toBe(false);
    if (!noId.ok) expect(noId.errors[0]?.path).toEqual(["moodboards", 0, "id"]);
  });

  test("strength without image_url is a warning, not an error", () => {
    const r = image.safe({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      strength: 0.5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.path[0] === "strength")).toBe(true);
  });
});

// Krea 2's request schema is `additionalProperties: false`
// (https://api.krea.ai/openapi.json → /generate/image/krea/krea-2/{variant}),
// so an unknown key is a certain 400 and unmodel errors instead of warning.
describe("krea.image closed request schema", () => {
  test("an unknown top-level key is an error, not an unknown_param warning", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      num_images: 4,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_shape"]);
      // zod reports unrecognized keys against the body root and names them.
      expect(r.errors[0]?.path).toEqual([]);
      expect(r.errors[0]?.message).toContain("num_images");
      expect(r.errors[0]?.message).toContain("additionalProperties: false");
      expect(r.warnings.some((w) => w.code === "unknown_param")).toBe(false);
    }
  });

  test("a near-miss spelling of a real param is caught", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      aspectRatio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("aspectRatio");
  });

  test("every documented key still validates together", () => {
    const r = image.safe({
      model: "krea-2/medium",
      prompt: "a cinematic glass cabin beside a frozen lake at sunrise",
      aspect_ratio: "16:9",
      resolution: "1K",
      seed: 42,
      styles: [{ id: "sty_1", strength: 1.2 }],
      image_style_references: [{ url: "https://x/y.png", strength: 0.5 }],
      creativity: "medium",
      intensity: 10,
      complexity: -10,
      movement: 0,
      moodboards: [{ id: "1e51738c-7413-469e-93b6-ad50db460a1f", strength: 0.23 }],
      image_url: "https://x/base.png",
      strength: 0.99,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(Object.keys(r.params)).toEqual([
        "prompt",
        "aspect_ratio",
        "resolution",
        "seed",
        "styles",
        "image_style_references",
        "creativity",
        "intensity",
        "complexity",
        "movement",
        "moodboards",
        "image_url",
        "strength",
      ]);
    }
  });

  test("nested entries stay open — only the root schema is closed", () => {
    const r = safeUnchecked({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: [{ url: "https://x/y.png", strength: 0.5, weight_v2: 1 }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("krea.image billing tiers", () => {
  test("text-to-image bills the base rate per variant", () => {
    for (const [id, tiers] of Object.entries(KREA_BILLING_TIERS)) {
      const r = image.safe({
        model: id as keyof typeof KREA_BILLING_TIERS,
        prompt: "x",
        aspect_ratio: "1:1",
        resolution: "1K",
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(tiers.textToImage, 10);
    }
  });

  test("style references bill the style tier", () => {
    const r = image.safe({
      model: "krea-2/medium",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: [{ url: "https://x/y.png", strength: 0.6 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.035, 10);
  });

  test("moodboards win over style references", () => {
    const r = image.safe({
      model: "krea-2/large",
      prompt: "x",
      aspect_ratio: "1:1",
      resolution: "1K",
      image_style_references: [{ url: "https://x/y.png" }],
      moodboards: [{ id: "1e51738c-7413-469e-93b6-ad50db460a1f", strength: 0.35 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.07, 10);
  });

  test("maxCostUSD is enforced against the selected tier", () => {
    const r = image.safe(
      {
        model: "krea-2/large",
        prompt: "x",
        aspect_ratio: "1:1",
        resolution: "1K",
        moodboards: [{ id: "1e51738c-7413-469e-93b6-ad50db460a1f" }],
      },
      { maxCostUSD: 0.06 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});
