import { describe, expect, test } from "bun:test";
import { generateV4, IDEOGRAM_V4_GENERATE_URL, RESOLUTIONS_V4 } from "./generate-v4";
import { toFormData } from "./generate";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = generateV4.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("ideogram.generateV4 happy path", () => {
  test("text_prompt form validates and is multipart-ready", () => {
    const v = generateV4({
      text_prompt: "a neon-lit ramen bar in the rain",
      resolution: "2048x2048",
      rendering_speed: "QUALITY",
    });
    expect(Object.keys(v)).toEqual(["text_prompt", "resolution", "rendering_speed"]);
    expect(v.request.url).toBe(IDEOGRAM_V4_GENERATE_URL);
    expect(v.request.headers).toEqual({});
    const form = toFormData(v);
    expect(form.get("resolution")).toBe("2048x2048");
  });

  test("json_prompt form validates", () => {
    const r = generateV4.safe({
      json_prompt: {
        high_level_description: "a still life",
        compositional_deconstruction: { background: "a dark table", elements: [] },
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("ideogram.generateV4 prompt exclusivity", () => {
  test("exactly one of text_prompt / json_prompt is required", () => {
    const neither = safeUnchecked({ resolution: "1024x1024" });
    expect(neither.ok).toBe(false);

    const both = safeUnchecked({
      text_prompt: "x",
      json_prompt: {
        high_level_description: "y",
        compositional_deconstruction: { background: "b", elements: [] },
      },
    });
    expect(both.ok).toBe(false);
  });

  test("an incomplete json_prompt reports the missing required members", () => {
    const r = safeUnchecked({ json_prompt: { high_level_description: "x" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.path.join(".") === "json_prompt.compositional_deconstruction"),
      ).toBe(true);
    }
  });
});

describe("ideogram.generateV4 enums", () => {
  test("4.0 uses its own resolution list — 3.0-only values are rejected", () => {
    expect(RESOLUTIONS_V4).toContain("3328x1248");
    // "704x1152" is a ResolutionV3 value with no ResolutionV4 counterpart.
    expect((RESOLUTIONS_V4 as readonly string[]).includes("704x1152")).toBe(false);
    const r = safeUnchecked({ text_prompt: "x", resolution: "704x1152" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["resolution"]);
    }
  });

  test("rendering_speed FLASH is reported as unsupported on 4.0", () => {
    const r = safeUnchecked({ text_prompt: "x", rendering_speed: "FLASH" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.message).toContain("coming soon");
    }
  });

  test("an unknown rendering_speed is an invalid_enum_value", () => {
    const r = safeUnchecked({ text_prompt: "x", rendering_speed: "LUDICROUS" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("ideogram.generateV4 cost estimation", () => {
  test("prices one image at the 4.0 tier rate", () => {
    const turbo = generateV4.safe({ text_prompt: "x", rendering_speed: "TURBO" });
    if (turbo.ok) expect(turbo.estimate.costUSD).toBeCloseTo(0.03, 10);
    const def = generateV4.safe({ text_prompt: "x" });
    if (def.ok) expect(def.estimate.costUSD).toBeCloseTo(0.06, 10);
    const quality = generateV4.safe({ text_prompt: "x", rendering_speed: "QUALITY" });
    if (quality.ok) expect(quality.estimate.costUSD).toBeCloseTo(0.1, 10);
  });

  test("maxCostUSD is enforced", () => {
    const r = generateV4.safe({ text_prompt: "x", rendering_speed: "QUALITY" }, { maxCostUSD: 0.05 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});
