import { describe, expect, test } from "bun:test";
import {
  generate,
  toFormData,
  IDEOGRAM_V3_GENERATE_URL,
  RESOLUTIONS,
  STYLE_PRESETS,
  ASPECT_RATIOS,
} from "./generate";
import { models, RENDERING_SPEED_TO_MODEL_ID, CHARACTER_REFERENCE_PER_IMAGE } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = generate.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const kilobytes = (n: number) => new Blob([new Uint8Array(n * 1024)]);

describe("ideogram.generate happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      prompt: "A photo of a cat sleeping on a couch.",
      rendering_speed: "TURBO" as const,
      aspect_ratio: "16x9" as const,
      num_images: 2,
    };
    const v = generate(params);

    expect(Object.keys(v)).toEqual(["prompt", "rendering_speed", "aspect_ratio", "num_images"]);
    expect(v.request.url).toBe(IDEOGRAM_V3_GENERATE_URL);
    expect(v.request.method).toBe("POST");
    // Multipart endpoint: no content-type header; fetch derives the boundary
    // from the FormData body.
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("ideogram")).toEqual(params);
  });

  test("a bare prompt validates cleanly with the DEFAULT-speed price", () => {
    const r = generate.safe({ prompt: "a red panda" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.06, 10); // DEFAULT = $0.06 × 1
    }
  });

  test("the full documented surface validates", () => {
    const r = generate.safe({
      prompt: "poster of a rocket",
      seed: 12345,
      resolution: "1024x1024",
      rendering_speed: "QUALITY",
      magic_prompt: "AUTO",
      negative_prompt: "text artifacts",
      num_images: 4,
      color_palette: { name: "EMBER" },
      style_type: "DESIGN",
      style_preset: "ART_DECO",
      enable_copyright_detection: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.36, 10); // QUALITY $0.09 × 4
    }
  });

  test("unknown params pass through with a warning", () => {
    const r = safeUnchecked({ prompt: "x", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("enum tables carry the documented cardinalities", () => {
    expect(RESOLUTIONS.length).toBe(69);
    expect(STYLE_PRESETS.length).toBe(62);
    expect(ASPECT_RATIOS.length).toBe(15);
  });
});

describe("ideogram.generate enums", () => {
  test("a bad rendering_speed is invalid_enum_value (not unknown_model noise)", () => {
    const r = safeUnchecked({ prompt: "x", rendering_speed: "SLOW" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.errors[0]?.path).toEqual(["rendering_speed"]);
      expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });

  test("bad aspect_ratio / resolution / magic_prompt / style_type / style_preset are flagged", () => {
    const r = safeUnchecked({
      prompt: "x",
      aspect_ratio: "16:9", // Ideogram uses "16x9", not "16:9"
      magic_prompt: "MAYBE",
      style_type: "ANIME", // removed in v3: AUTO/GENERAL/REALISTIC/DESIGN/FICTION
      style_preset: "VAPORWAVE",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path[0]);
      expect(paths).toContain("aspect_ratio");
      expect(paths).toContain("magic_prompt");
      expect(paths).toContain("style_type");
      expect(paths).toContain("style_preset");
      for (const issue of r.errors) expect(issue.code).toBe("invalid_enum_value");
    }
  });

  test("aspect_ratio cannot be combined with resolution", () => {
    const r = generate.safe({ prompt: "x", aspect_ratio: "1x1", resolution: "1024x1024" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.message).toContain("cannot be used in conjunction");
    }
  });
});

describe("ideogram.generate shape rules", () => {
  test("only the documented floors bound num_images and seed", () => {
    // The current OpenAPI spec's `NumImages` and `Seed` components are bare
    // integers with NO maximum, so unmodel must not invent one.
    expect(generate.safe({ prompt: "x", num_images: 9 }).ok).toBe(true);
    expect(generate.safe({ prompt: "x", seed: 2147483648 }).ok).toBe(true);
    // The floors implied by "number of images" / "random seed" still hold.
    expect(generate.safe({ prompt: "x", num_images: 0 }).ok).toBe(false);
    expect(generate.safe({ prompt: "x", seed: -1 }).ok).toBe(false);
    expect(generate.safe({ prompt: "x", seed: 2147483647, num_images: 8 }).ok).toBe(true);
  });

  test("style_codes cannot be combined with style_type or style_reference_images", () => {
    const r = generate.safe({ prompt: "x", style_codes: ["a1b2c3d4"], style_type: "GENERAL" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["style_codes"]);

    const withRefs = generate.safe({
      prompt: "x",
      style_codes: ["a1b2c3d4"],
      style_reference_images: [kilobytes(1)],
    });
    expect(withRefs.ok).toBe(false);

    expect(generate.safe({ prompt: "x", style_codes: ["a1b2c3d4", "FFFFFFFF"] }).ok).toBe(true);
  });

  test("a non-8-hex style code is invalid_shape", () => {
    const r = generate.safe({ prompt: "x", style_codes: ["nothex"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("character references: max 1 image, masks must match count", () => {
    const two = generate.safe({
      prompt: "x",
      character_reference_images: [kilobytes(1), kilobytes(1)],
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0]?.message).toContain("only supports 1");

    const mismatch = generate.safe({
      prompt: "x",
      character_reference_images: [kilobytes(1)],
      character_reference_images_mask: [kilobytes(1), kilobytes(1)],
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.errors[0]?.path).toEqual(["character_reference_images_mask"]);
    }

    expect(
      generate.safe({
        prompt: "x",
        character_reference_images: [kilobytes(1)],
        character_reference_images_mask: [kilobytes(1)],
      }).ok,
    ).toBe(true);
  });

  test("custom_model_uri format is validated", () => {
    expect(generate.safe({ prompt: "x", custom_model_uri: "model/foo/version/v2" }).ok).toBe(true);
    const r = generate.safe({ prompt: "x", custom_model_uri: "foo/v2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["custom_model_uri"]);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    let caught: unknown;
    try {
      generate({ prompt: "x", num_images: 0 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("ideogram.generate color_palette", () => {
  test("name XOR members", () => {
    const both = safeUnchecked({
      prompt: "x",
      color_palette: { name: "EMBER", members: [{ color_hex: "#ff0000" }] },
    });
    expect(both.ok).toBe(false);
    const neither = safeUnchecked({ prompt: "x", color_palette: {} });
    expect(neither.ok).toBe(false);
  });

  test("preset names are validated", () => {
    const r = safeUnchecked({ prompt: "x", color_palette: { name: "NEON" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["color_palette", "name"]);
    }
    expect(generate.safe({ prompt: "x", color_palette: { name: "PASTEL" } }).ok).toBe(true);
  });

  test("members: hex format and 0.05-1.0 weights", () => {
    expect(
      generate.safe({
        prompt: "x",
        color_palette: { members: [{ color_hex: "#f00" }, { color_hex: "#00FF00", color_weight: 1 }] },
      }).ok,
    ).toBe(true);

    const badHex = generate.safe({
      prompt: "x",
      color_palette: { members: [{ color_hex: "red" }] },
    });
    expect(badHex.ok).toBe(false);
    if (!badHex.ok) {
      expect(badHex.errors[0]?.path).toEqual(["color_palette", "members", 0, "color_hex"]);
    }

    const badWeight = generate.safe({
      prompt: "x",
      color_palette: { members: [{ color_hex: "#ff0000", color_weight: 0.04 }] },
    });
    expect(badWeight.ok).toBe(false);
  });
});

describe("ideogram.generate media limits", () => {
  test("a reference image over 25MB is media_too_large", () => {
    const r = generate.safe({
      prompt: "x",
      style_reference_images: [kilobytes(25 * 1024 + 1)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.path).toEqual(["style_reference_images", 0]);
    }
  });

  test("reference images totalling over 50MB are media_too_large", () => {
    const twenty = 20 * 1024;
    const r = generate.safe({
      prompt: "x",
      style_reference_images: [kilobytes(twenty), kilobytes(twenty), kilobytes(twenty)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBe(1); // no per-image breach, only the total
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.message).toContain("50MB");
    }
  });
});

describe("ideogram.generate pricing", () => {
  test("per-speed pseudo-models price num_images × perImage", () => {
    const turbo = generate.safe({ prompt: "x", rendering_speed: "TURBO", num_images: 3 });
    expect(turbo.ok).toBe(true);
    if (turbo.ok) expect(turbo.estimate.costUSD).toBeCloseTo(0.09, 10); // $0.03 × 3

    const flash = generate.safe({ prompt: "x", rendering_speed: "FLASH" });
    expect(flash.ok).toBe(true);
    if (flash.ok) expect(flash.estimate.costUSD).toBeCloseTo(0.03, 10);
  });

  test("character-reference requests use the published character-reference rate", () => {
    const r = generate.safe({
      prompt: "x",
      rendering_speed: "DEFAULT",
      num_images: 2,
      character_reference_images: [kilobytes(1)],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.3, 10); // $0.15 × 2
  });

  test("FLASH + character reference has no published rate → no estimate", () => {
    const r = generate.safe({
      prompt: "x",
      rendering_speed: "FLASH",
      character_reference_images: [kilobytes(1)],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD is enforced", () => {
    const r = generate.safe(
      { prompt: "x", rendering_speed: "QUALITY", num_images: 8 }, // 8 × $0.09 = $0.72
      { maxCostUSD: 0.5 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("catalog sanity: every rendering speed maps to a catalog row", () => {
    for (const [speed, id] of Object.entries(RENDERING_SPEED_TO_MODEL_ID)) {
      expect(models[id]).toBeDefined();
      expect(models[id].cost.perImage).toBeGreaterThan(0);
      if (speed !== "FLASH") {
        expect(CHARACTER_REFERENCE_PER_IMAGE[speed]).toBeGreaterThan(0);
      }
    }
    expect(CHARACTER_REFERENCE_PER_IMAGE.FLASH).toBeUndefined();
  });
});

describe("ideogram.toFormData", () => {
  test("scalars, repeated fields, JSON objects and blobs serialize per the docs", () => {
    const styleRef = kilobytes(1);
    const params = {
      prompt: "a cat",
      rendering_speed: "TURBO" as const,
      num_images: 2,
      enable_copyright_detection: true,
      style_codes: undefined,
      color_palette: { members: [{ color_hex: "#ff0000", color_weight: 0.5 }] },
      style_reference_images: [styleRef, styleRef],
    };
    const form = toFormData(params);

    expect(form.get("prompt")).toBe("a cat");
    expect(form.get("rendering_speed")).toBe("TURBO");
    expect(form.get("num_images")).toBe("2");
    expect(form.get("enable_copyright_detection")).toBe("true");
    expect(form.get("style_codes")).toBeNull(); // undefined omitted
    expect(JSON.parse(form.get("color_palette") as string)).toEqual(params.color_palette);
    expect(form.getAll("style_reference_images").length).toBe(2);
  });

  test("style_codes append item-by-item", () => {
    const form = toFormData({ prompt: "x", style_codes: ["a1b2c3d4", "FFFFFFFF"] });
    expect(form.getAll("style_codes")).toEqual(["a1b2c3d4", "FFFFFFFF"]);
  });

  test("validated output round-trips through toFormData", () => {
    const v = generate({ prompt: "x", rendering_speed: "TURBO" });
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("x");
    expect(form.get("rendering_speed")).toBe("TURBO");
  });
});
