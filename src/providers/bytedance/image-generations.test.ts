import { describe, expect, test } from "bun:test";
import {
  imageGenerations,
  imageGenerationsUrl,
  IMAGE_GENERATIONS_URL,
  type BytedanceImageSize,
} from "./image-generations";
import { IMAGE_SIZE_KEYWORDS, imageShapeRules } from "./constraints";
import { imageModels, type BytedanceImageModelId } from "./models";
import { ARK_AP_SOUTHEAST_BASE_URL, ARK_EU_WEST_BASE_URL } from "./shared";
import { imageCostUSD } from "./pricing";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = imageGenerations.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

/** Minimal but real PNG header bytes, as the `data:` URI form the API takes. */
function pngDataUri(width: number, height: number): string {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

describe("bytedance.imageGenerations happy path", () => {
  test("returns the exact wire body plus request metadata", () => {
    const v = imageGenerations({
      model: "seedream-4-0-250828",
      prompt: "a paper-craft city skyline at golden hour",
      size: "2K",
      watermark: false,
    });

    // `model` is a body field on this API (unlike route-per-model APIs).
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      model: "seedream-4-0-250828",
      prompt: "a paper-craft city skyline at golden hour",
      size: "2K",
      watermark: false,
    });
    expect(v.request.url).toBe(`${ARK_AP_SOUTHEAST_BASE_URL}/images/generations`);
    expect(v.request.url).toBe(IMAGE_GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("bytedance")).toEqual(JSON.parse(JSON.stringify(v)));
  });

  test("the EU region base URL is exported for region-isolated callers", () => {
    expect(imageGenerationsUrl("eu-west-1")).toBe(`${ARK_EU_WEST_BASE_URL}/images/generations`);
    expect(imageGenerationsUrl()).toBe(IMAGE_GENERATIONS_URL);
  });

  test("every cataloged image model validates a minimal request", () => {
    for (const id of Object.keys(imageModels)) {
      const r = safeUnchecked({ model: id, prompt: "hi" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });

  test("a request for an unknown model skips the model-dependent checks", () => {
    // No prompt: required by every documented model, but not assumed for ids
    // unmodel has never seen.
    const r = safeUnchecked({ model: "ep-20260101-abcdef", image: "https://x/a.png" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("Seedream 5.0 pro accepts layer decomposition without a prompt", () => {
    const r = imageGenerations.safe({
      model: "dola-seedream-5-0-pro-260628",
      image: "https://example.com/room.png",
      layer_decomposition: true,
      size: "auto",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("batch generation on Seedream 4.0 validates", () => {
    const r = imageGenerations.safe({
      model: "seedream-4-0-250828",
      prompt: "four seasons of one courtyard",
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 4 },
      stream: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns but still validates and routes", () => {
    const r = safeUnchecked({ model: "seedream-9-0-991231", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("SeedEdit warns as deprecated and carries no invented constraints", () => {
    const r = safeUnchecked({
      model: "seededit-3-0-i2i-250628",
      prompt: "switch the scene to daytime",
      image: "https://example.com/street.jpg",
      response_format: "url",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    expect(imageGenerations.constraintsFor("seededit-3-0-i2i-250628")).toEqual([]);
  });

  test("unknown top-level params warn instead of failing", () => {
    // `seed`/`guidance_scale` are not on the current image API.
    const r = safeUnchecked({ model: "seedream-4-0-250828", prompt: "hi", guidance_scale: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.path[0])).toContain("guidance_scale");
  });
});

describe("bytedance.imageGenerations per-model param enforcement", () => {
  test("sequential generation and streaming are rejected on Seedream 5.0 pro", () => {
    const r = safeUnchecked({
      model: "dola-seedream-5-0-pro-260628",
      prompt: "hi",
      sequential_image_generation: "auto",
      stream: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["unsupported_param", "unsupported_param"]);
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual([
        "sequential_image_generation",
        "stream",
      ]);
    }
  });

  test("layer decomposition and background are rejected outside Seedream 5.0 pro", () => {
    const r = safeUnchecked({
      model: "seedream-4-0-250828",
      prompt: "hi",
      layer_decomposition: true,
      background: "transparent",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0])).toContain("layer_decomposition");
      expect(r.errors.map((e) => e.path[0])).toContain("background");
    }
  });

  test("output_format is rejected on the jpeg-only models", () => {
    const r = safeUnchecked({ model: "seedream-4-5-251128", prompt: "hi", output_format: "png" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["output_format"]);

    expect(
      imageGenerations.safe({
        model: "seedream-5-0-lite-260128",
        prompt: "hi",
        output_format: "png",
      }).ok,
    ).toBe(true);
  });

  test("fast prompt optimization is rejected where undocumented", () => {
    const r = safeUnchecked({
      model: "seedream-5-0-lite-260128",
      prompt: "hi",
      optimize_prompt_options: { mode: "fast" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["optimize_prompt_options", "mode"]);
    }
    expect(
      imageGenerations.safe({
        model: "seedream-4-0-250828",
        prompt: "hi",
        optimize_prompt_options: { mode: "fast" },
      }).ok,
    ).toBe(true);
  });

  test("response_format is a closed enum", () => {
    const r = safeUnchecked({ model: "seedream-4-0-250828", prompt: "hi", response_format: "jpeg" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("bytedance.imageGenerations size rules", () => {
  test("keywords are per model", () => {
    expect(imageGenerations.safe({ model: "seedream-4-0-250828", prompt: "hi", size: "1K" }).ok).toBe(
      true,
    );
    const r = safeUnchecked({ model: "seedream-4-5-251128", prompt: "hi", size: "1K" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.message).toContain('"2K", "4K"');
    }
  });

  test("pixel sizes must satisfy the model's total-pixel range", () => {
    const tooSmall = safeUnchecked({ model: "seedream-4-0-250828", prompt: "hi", size: "800x800" });
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) {
      expect(tooSmall.errors[0]?.message).toContain("640000");
      expect(tooSmall.errors[0]?.meta?.["minPixels"]).toBe(921_600);
    }
    expect(
      imageGenerations.safe({ model: "seedream-4-0-250828", prompt: "hi", size: "1600x600" }).ok,
    ).toBe(true);
  });

  test("pixel sizes must satisfy the [1/16, 16] aspect range", () => {
    const r = safeUnchecked({ model: "seedream-4-0-250828", prompt: "hi", size: "40000x40" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("aspect ratio"))).toBe(true);
  });

  test("every BytedanceImageSize preset passes the rule it advertises", () => {
    // Keep in sync with BytedanceImageSize in ./image-generations. Keywords are
    // PER MODEL — the union is the union of every model's table — so each one
    // is exercised against a model whose imageShapeRules entry lists it, plus
    // two free-form "<w>x<h>" sizes inside that model's own pixel band.
    const cases: ReadonlyArray<{
      model: BytedanceImageModelId;
      sizes: readonly BytedanceImageSize[];
    }> = [
      // [921,600, 4,624,220] pixels.
      { model: "dola-seedream-5-0-pro-260628", sizes: ["1K", "1.5K", "2K", "1280x720", "2048x2048"] },
      // [3,686,400, 16,777,216] pixels.
      { model: "seedream-5-0-260128", sizes: ["2K", "3K", "4K", "2560x1440", "4096x4096"] },
      { model: "seedream-5-0-lite-260128", sizes: ["2K", "3K", "4K", "2560x1440", "4096x4096"] },
      { model: "seedream-4-5-251128", sizes: ["2K", "4K", "2560x1440", "4096x4096"] },
      // [921,600, 16,777,216] pixels.
      { model: "seedream-4-0-250828", sizes: ["1K", "2K", "4K", "1280x720", "1920x1080"] },
    ];
    for (const { model, sizes } of cases) {
      for (const size of sizes) {
        const r = safeUnchecked({ model, prompt: "hi", size });
        expect(r.ok, `${model} should accept ${size}`).toBe(true);
        if (r.ok) expect(r.warnings, `${model} + ${size} should be warning-free`).toEqual([]);
      }
    }

    // …and "auto", which exists only in Seedream 5.0 pro's decomposition mode.
    const auto = imageGenerations.safe({
      model: "dola-seedream-5-0-pro-260628",
      image: "https://example.com/room.png",
      layer_decomposition: true,
      size: "auto",
    });
    expect(auto.ok).toBe(true);
    if (auto.ok) expect(auto.warnings).toEqual([]);

    // A keyword added to imageShapeRules but not to the sweep above fails here,
    // so the type's keyword arm cannot quietly fall behind the runtime tables.
    const documented = new Set<string>();
    for (const rule of Object.values(imageShapeRules)) {
      for (const keyword of rule?.sizeKeywords ?? []) documented.add(keyword);
      for (const keyword of rule?.layerSizeKeywords ?? []) documented.add(keyword);
    }
    const covered = new Set<string>(["auto"]);
    for (const { sizes } of cases) {
      for (const size of sizes) if (!size.includes("x")) covered.add(size);
    }
    expect([...covered].sort()).toEqual([...documented].sort());
    expect([...documented].sort()).toEqual([...IMAGE_SIZE_KEYWORDS].sort());
  });

  test("layer decomposition sizes by resolution level only", () => {
    const r = safeUnchecked({
      model: "dola-seedream-5-0-pro-260628",
      image: "https://example.com/a.png",
      layer_decomposition: true,
      size: "2048x2048",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("resolution level");
  });
});

describe("bytedance.imageGenerations content rules", () => {
  test("prompt is required unless decomposing layers", () => {
    const r = safeUnchecked({ model: "seedream-4-0-250828", image: "https://x/a.png" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["prompt"]);
    }
  });

  test("layer decomposition takes exactly one image", () => {
    const r = safeUnchecked({
      model: "dola-seedream-5-0-pro-260628",
      layer_decomposition: true,
      image: ["https://x/a.png", "https://x/b.png"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("exactly one input `image`");
  });

  test("reference image counts are capped per model", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://x/${i}.png`);
    const pro = safeUnchecked({
      model: "dola-seedream-5-0-pro-260628",
      prompt: "hi",
      image: eleven,
    });
    expect(pro.ok).toBe(false);
    if (!pro.ok) expect(pro.errors[0]?.meta?.["limit"]).toBe(10);

    // The same 11 images are fine on the 14-image models.
    expect(safeUnchecked({ model: "seedream-4-0-250828", prompt: "hi", image: eleven }).ok).toBe(
      true,
    );
  });

  test("transparent backgrounds are png-only and single-image-only", () => {
    const r = safeUnchecked({
      model: "dola-seedream-5-0-pro-260628",
      prompt: "hi",
      image: ["https://x/a.png", "https://x/b.png"],
      background: "transparent",
      output_format: "jpeg",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.filter((e) => e.code === "unsupported_capability")).toHaveLength(2);
    }
  });

  test("sequential options without auto are reported as ignored", () => {
    const r = safeUnchecked({
      model: "seedream-4-0-250828",
      prompt: "hi",
      sequential_image_generation_options: { max_images: 4 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.meta?.["ignored"]).toBe(true);
    }
  });

  test("input images + max_images must stay within 15", () => {
    const r = safeUnchecked({
      model: "seedream-4-0-250828",
      prompt: "hi",
      image: ["https://x/a.png", "https://x/b.png"],
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 15 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.["limit"]).toBe(15);
  });

  test("max_images stays inside [1, 15]", () => {
    const r = safeUnchecked({
      model: "seedream-4-0-250828",
      prompt: "hi",
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 16 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("inline images are measured against the documented input bounds", () => {
    const r = safeUnchecked({
      model: "seedream-4-0-250828",
      prompt: "hi",
      image: pngDataUri(10, 10),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.every((e) => e.code === "media_dimensions_exceeded")).toBe(true);
      expect(r.errors.map((e) => e.path)).toContainEqual(["image"]);
    }
    // A URL carries no bytes: nothing to measure, nothing reported.
    expect(safeUnchecked({ model: "seedream-4-0-250828", prompt: "hi", image: "https://x/a.png" }).ok).toBe(
      true,
    );
  });

  test("inline images inside an array report their index", () => {
    const r = safeUnchecked({
      model: "seedream-4-0-250828",
      prompt: "hi",
      image: ["https://x/a.png", pngDataUri(100000, 400)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["image", 1]);
  });

  test("throwing form raises UnmodelValidationError", () => {
    expect(() =>
      imageGenerations({ model: "seedream-4-5-251128", prompt: "hi", size: "1K" }),
    ).toThrow(UnmodelValidationError);
  });
});

describe("bytedance.imageGenerations cost estimation", () => {
  test("flat per-image models bill per generated image", () => {
    const single = imageGenerations.safe({ model: "seedream-4-0-250828", prompt: "hi" });
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.estimate.costUSD).toBeCloseTo(0.03, 10);

    const batch = imageGenerations.safe({
      model: "seedream-4-0-250828",
      prompt: "hi",
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 4 },
    });
    expect(batch.ok).toBe(true);
    if (batch.ok) expect(batch.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("Seedream 5.0 pro switches tier on output pixels", () => {
    // Default size is 2K → above the 2.61M pixel boundary.
    expect(imageCostUSD("dola-seedream-5-0-pro-260628", {})).toBeCloseTo(0.09, 10);
    expect(imageCostUSD("dola-seedream-5-0-pro-260628", { size: "1.5K" })).toBeCloseTo(0.045, 10);
    // First input image is free, the rest bill 0.003 each.
    expect(imageCostUSD("dola-seedream-5-0-pro-260628", { size: "1K", inputImages: 3 })).toBeCloseTo(
      0.045 + 2 * 0.003,
      10,
    );
    // Layer decomposition: worst case is the base image plus 16 layers.
    expect(
      imageCostUSD("dola-seedream-5-0-pro-260628", { size: "2K", layerDecomposition: true }),
    ).toBeCloseTo(0.045 * 17, 10);
  });

  test("maxCostUSD fails a batch that would overrun the budget", () => {
    const r = safeUnchecked(
      {
        model: "seedream-4-5-251128",
        prompt: "hi",
        sequential_image_generation: "auto",
      },
      { maxCostUSD: 0.1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });
});
