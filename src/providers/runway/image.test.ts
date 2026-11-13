import { describe, expect, test } from "bun:test";
import { image, TEXT_TO_IMAGE_URL } from "./image";
import { RUNWAY_VERSION } from "./shared";
import { imageConstraints } from "./constraints";
import { models } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("runway.image happy path", () => {
  test("returns a wire-pure body with URL, method and version header", () => {
    const v = image({
      model: "gen4_image",
      promptText: "a watercolor lighthouse at dawn",
      ratio: "1920:1080",
    });
    expect(Object.keys(v)).toEqual(["model", "promptText", "ratio"]);
    expect(v.request.url).toBe(TEXT_TO_IMAGE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.request.headers["x-runway-version"]).toBe(RUNWAY_VERSION);
    expect(v.toSdk("runway")).toEqual({
      model: "gen4_image",
      promptText: "a watercolor lighthouse at dawn",
      ratio: "1920:1080",
    });
  });

  test("unknown model warns but validates", () => {
    const r = image.safe({ model: "gen5_image", promptText: "hi", ratio: "1024:1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("a video model on the image route warns as unknown_model", () => {
    const r = image.safe({ model: "gen4.5", promptText: "hi", ratio: "1024:1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("missing promptText or ratio is invalid_shape", () => {
    const r = safeUnchecked({ model: "gen4_image" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => e.code === "invalid_shape")).toBe(true);
  });
});

describe("runway.image per-model rules", () => {
  test("gen4_image_turbo requires referenceImages", () => {
    const r = image.safe({
      model: "gen4_image_turbo",
      promptText: "hi",
      ratio: "1024:1024",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["referenceImages"]);
    }
  });

  test("a ratio outside gemini_2.5_flash's enum is invalid_enum_value", () => {
    const r = image.safe({
      model: "gemini_2.5_flash",
      promptText: "hi",
      ratio: "1920:1080",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["ratio"]);
    }
  });

  test("gpt_image_2 background is transparent / opaque / auto, and nothing else", () => {
    // "one of `transparent`, `opaque`, `auto`" — openapi.json, 2026-11-12.
    expect(
      image.safe({ model: "gpt_image_2", promptText: "hi", ratio: "auto", background: "transparent" }).ok,
    ).toBe(true);
    const r = safeUnchecked({
      model: "gpt_image_2",
      promptText: "hi",
      ratio: "auto",
      background: "white",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("quality on gen4_image is unsupported_param with a doc source", () => {
    const r = image.safe({
      model: "gen4_image",
      promptText: "hi",
      ratio: "1024:1024",
      quality: "high",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["quality"]);
      expect(String(issue?.meta?.source)).toContain("docs.dev.runwayml.com");
    }
  });

  test("outputCount on gemini_image3_pro only allows 1 or 4", () => {
    const r = image.safe({
      model: "gemini_image3_pro",
      promptText: "hi",
      ratio: "1024:1024",
      outputCount: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.meta?.allowed).toEqual([1, 4]);
    }
  });
});

describe("runway.image cost estimation", () => {
  test("gemini_2.5_flash is a flat 5 credits ($0.05)", () => {
    const r = image.safe({
      model: "gemini_2.5_flash",
      promptText: "hi",
      ratio: "1024:1024",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05, 10);
  });

  test("gpt_image_2 low quality at a 1K/2K ratio is 1 credit", () => {
    const r = image.safe({
      model: "gpt_image_2",
      promptText: "hi",
      ratio: "1920:1088",
      quality: "low",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.01, 10);
  });

  test("gpt_image_2 defaults to high quality; auto ratio bills at 4K (41)", () => {
    const r = image.safe({ model: "gpt_image_2", promptText: "hi", ratio: "auto" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.41, 10);
  });

  test("grok_imagine_image_2 matches the documented worked example", () => {
    // "four 1K medium images with two references is 4 × 6 + 2 = 26 credits"
    // — guides/pricing.md
    const r = image.safe({
      model: "grok_imagine_image_2",
      promptText: "hi",
      ratio: "1024:1024",
      outputCount: 4,
      referenceImages: [
        { uri: "https://example.com/a.png" },
        { uri: "https://example.com/b.png" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.26, 10);
  });

  test("gemini_image3.1_flash bills 5 / 7 / 11 / 16 credits by size tier", () => {
    const cost = (ratio: `${number}:${number}`): number | undefined => {
      const r = image.safe({ model: "gemini_image3.1_flash", promptText: "hi", ratio });
      return r.ok ? r.estimate.costUSD : undefined;
    };
    expect(cost("512:512")).toBeCloseTo(0.05, 10);
    expect(cost("1024:1024")).toBeCloseTo(0.07, 10);
    expect(cost("2048:2048")).toBeCloseTo(0.11, 10);
    expect(cost("11264:1408")).toBeCloseTo(0.16, 10);
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = image.safe(
      { model: "gemini_image3_pro", promptText: "a fox", ratio: "4096:4096", outputCount: 4 },
      { maxCostUSD: 1 },
    );
    // 4 × 40 credits = 160 credits = $1.60 > $1.00
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("runway.image reference-image shape rules", () => {
  const IMAGE = "https://example.com/ref.png";

  test("tag must be 3-16 lowercase chars starting with a letter", () => {
    const ok = image.safe({
      model: "gen4_image",
      promptText: "x",
      ratio: "1920:1080",
      referenceImages: [{ uri: IMAGE, tag: "hero_shot" }],
    });
    expect(ok.ok).toBe(true);

    for (const tag of ["Hero", "1hero", "ab", "a".repeat(17)]) {
      const r = safeUnchecked({
        model: "gen4_image",
        promptText: "x",
        ratio: "1920:1080",
        referenceImages: [{ uri: IMAGE, tag }],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
    }
  });

  test("subject is only a field of the gemini_image3 family", () => {
    const ok = image.safe({
      model: "gemini_image3_pro",
      promptText: "a fox",
      ratio: "1024:1024",
      referenceImages: [{ uri: IMAGE, subject: "human" }],
    });
    expect(ok.ok).toBe(true);

    const bad = image.safe({
      model: "gen4_image",
      promptText: "x",
      ratio: "1920:1080",
      referenceImages: [{ uri: IMAGE, subject: "human" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const issue = bad.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["referenceImages", 0, "subject"]);
    }
  });

  test("the seedream arms take bare {uri} objects and reject tag", () => {
    const r = image.safe({
      model: "seedream5_pro",
      promptText: "x",
      ratio: "auto_1k",
      referenceImages: [{ uri: IMAGE, tag: "hero_shot" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual([
        "referenceImages",
        0,
        "tag",
      ]);
    }
  });

  test("referenceImages counts are capped per model", () => {
    const ref = { uri: IMAGE };
    // gen4_image: max 3.
    const over = image.safe({
      model: "gen4_image",
      promptText: "x",
      ratio: "1920:1080",
      referenceImages: Array(4).fill(ref),
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      const issue = over.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["referenceImages"]);
      expect(issue?.meta?.max).toBe(3);
    }

    // gpt_image_2: max 16.
    expect(
      image.safe({
        model: "gpt_image_2",
        promptText: "x",
        ratio: "auto",
        referenceImages: Array(16).fill(ref),
      }).ok,
    ).toBe(true);
  });

  test("gen4_image_turbo requires at least one reference image", () => {
    const r = image.safe({
      model: "gen4_image_turbo",
      promptText: "x",
      ratio: "1920:1080",
      referenceImages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["referenceImages"]);
    }
  });

  test("promptText caps differ by an order of magnitude across arms", () => {
    const long = "a".repeat(1001);
    const gen4 = image.safe({ model: "gen4_image", promptText: long, ratio: "1024:1024" });
    expect(gen4.ok).toBe(false);
    if (!gen4.ok) {
      expect(gen4.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(1000);
    }
    // The Gemini image arms take "max length 45000" (and gemini_image3_pro a
    // minimum of 3).
    const longer = "a".repeat(45000);
    expect(image.safe({ model: "gemini_image3_pro", promptText: longer, ratio: "1024:1024" }).ok).toBe(true);
    expect(image.safe({ model: "gemini_2.5_flash", promptText: longer, ratio: "1024:1024" }).ok).toBe(true);
    const over = image.safe({ model: "gemini_image3.1_flash", promptText: `${longer}a`, ratio: "1024:1024" });
    expect(over.ok).toBe(false);
    const short = image.safe({ model: "gemini_image3_pro", promptText: "ab", ratio: "1024:1024" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors[0]?.meta?.min).toBe(3);
  });
});

describe("runway.image documented enum coverage", () => {
  // The RunwayImageRatio / RunwayImageQuality / RunwayImageOutputFormat unions
  // in constraints.ts are derived from these same per-model tables, so
  // iterating the tables proves every value the types advertise is one the
  // runtime accepts for the model that documents it.
  test("every documented ratio validates on the model that documents it", () => {
    for (const [model, constraints] of Object.entries(imageConstraints)) {
      const ratios = constraints?.enums?.ratio;
      if (ratios === undefined) continue;
      for (const ratio of ratios) {
        const r = safeUnchecked({
          model,
          promptText: "a fox",
          ratio,
          // gen4_image_turbo requires reference images, and bria_fibo_edit_1_5
          // needs two before it takes a size.
          ...(model === "gen4_image_turbo" && {
            referenceImages: [{ uri: "https://example.com/a.png" }],
          }),
          ...(model === "bria_fibo_edit_1_5" && {
            referenceImages: [{ uri: "https://example.com/a.png" }, { uri: "https://example.com/b.png" }],
          }),
        });
        expect(r.ok, `${model} should accept ratio ${String(ratio)}`).toBe(true);
        if (r.ok) {
          expect(r.warnings, `${model} ratio ${String(ratio)} should be warning-free`).toEqual([]);
        }
      }
    }
  });

  test("every documented quality and outputFormat validates", () => {
    for (const [model, constraints] of Object.entries(imageConstraints)) {
      const ratio = constraints?.enums?.ratio?.[0];
      if (ratio === undefined) continue;
      for (const param of ["quality", "outputFormat"] as const) {
        for (const value of constraints?.enums?.[param] ?? []) {
          // GIF output requires `ratio: "auto"` on the gpt_image_2_6 pair, and a
          // bria_fibo_edit_1_5 size needs two reference images.
          const shape = value === "gif" || model === "bria_fibo_edit_1_5" ? "auto" : ratio;
          const r = safeUnchecked({
            model,
            promptText: "a fox",
            ratio: shape,
            [param]: value,
            // ideogram_4_5's `very_low` requires reference images.
            ...(value === "very_low" && { referenceImages: [{ uri: "https://example.com/a.png" }] }),
          });
          expect(r.ok, `${model} should accept ${param} ${String(value)}`).toBe(true);
        }
      }
    }
  });
});

describe("runway.image — Muse, Nano Banana, GPT Image 2.5 / 2.6, FIBO, Ideogram and Seedream arms", () => {
  const REF = { uri: "https://example.com/a.png" };

  test.each([
    ["muse_image", { ratio: "auto", outputCount: 3 }, 0.03],
    ["gemini_image3.1_flash_lite", { ratio: "1024:1024", outputCount: 4 }, 0.16],
    ["nano_banana_2.1", { ratio: "1024:1024" }, 0.04],
    ["nano_banana_2.1", { ratio: "2048:2048" }, 0.06],
    ["nano_banana_2.1", { ratio: "4096:4096", outputCount: 2 }, 0.24],
    // (1K 16:9 `high` 5 + 2 references) × 2 images.
    ["gpt_image_2_5_flare", { ratio: "1920:1088", outputCount: 2, referenceImages: [REF, REF] }, 0.14],
    // `auto` charges the 4K square price: `max` 75.
    ["gpt_image_2_5_sunburst", { ratio: "auto", quality: "max" }, 0.75],
    ["gpt_image_2_6_flare", { ratio: "2560:2560", quality: "low" }, 0.08],
    // GIF: 9–12 frames at `low` is 4 per animation.
    ["gpt_image_2_6_sunburst", { ratio: "auto", outputFormat: "gif", quality: "low", frameCount: 12 }, 0.04],
    // SVG: the 2K square `high` price (16) + 50 authoring.
    ["gpt_image_2_6_flare", { ratio: "2560:2560", outputFormat: "svg" }, 0.66],
    ["bria_fibo_1_5", { ratio: "1024:1024" }, 0.05],
    ["bria_fibo_1_5", { ratio: "2048:2048", seed: 2147483647 }, 0.1],
    ["bria_fibo_edit_1_5", { referenceImages: [REF] }, 0.05],
    // Default `medium`.
    ["ideogram_4_0", { outputCount: 2 }, 0.14],
    // Default `high` without references, `medium` with them.
    ["ideogram_4_5", {}, 0.25],
    ["ideogram_4_5", { referenceImages: [REF] }, 0.08],
    ["ideogram_4_5", { referenceImages: [REF], preciseEdit: true }, 0.25],
    ["ideogram_vector", {}, 0.17],
    ["ideogram_vector", { quality: "high", referenceImages: [REF] }, 0.35],
    ["seedream5_flash", { ratio: "auto_2k", outputCount: 4 }, 0.08],
    // The reservation for 17 images: 85 at auto (the default), 51 at 1K.
    ["seedream5_pro_layers", { referenceImages: [REF] }, 0.85],
    ["seedream5_pro_layers", { referenceImages: [REF], resolution: "1k" }, 0.51],
  ] as const)("%s validates warning-free and prices (%o)", (model, extra, usd) => {
    const r = safeUnchecked({ model, promptText: "a lighthouse", ...extra });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.estimate.costUSD).toBeCloseTo(usd, 10);
  });

  test("the catalog carries the flat and documented-default rates only", () => {
    expect(models.muse_image.cost?.perImage).toBeCloseTo(0.01, 10);
    expect(models["gemini_image3.1_flash_lite"].cost?.perImage).toBeCloseTo(0.04, 10);
    expect(models.ideogram_4_0.cost?.perImage).toBeCloseTo(0.07, 10);
    expect(models.ideogram_vector.cost?.perImage).toBeCloseTo(0.17, 10);
    expect(models.seedream5_flash.cost?.perImage).toBeCloseTo(0.02, 10);
    expect(models.bria_fibo_edit_1_5.cost?.perImage).toBeCloseTo(0.05, 10);
    for (const id of ["nano_banana_2.1", "gpt_image_2_5_flare", "gpt_image_2_6_flare", "ideogram_4_5", "seedream5_pro_layers"] as const) {
      expect("cost" in models[id], id).toBe(false);
    }
  });

  test("seedream5_pro_layers takes one source image and no ratio or prompt requirement", () => {
    expect(safeUnchecked({ model: "seedream5_pro_layers", referenceImages: [REF] }).ok).toBe(true);
    const none = safeUnchecked({ model: "seedream5_pro_layers" });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]).toMatchObject({ code: "invalid_shape", path: ["referenceImages"] });
    const ratio = safeUnchecked({ model: "seedream5_pro_layers", referenceImages: [REF], ratio: "auto" });
    expect(ratio.ok).toBe(false);
    if (!ratio.ok) expect(ratio.errors[0]).toMatchObject({ code: "unsupported_param", path: ["ratio"] });
  });

  test("ideogram_vector: any prompt up to 9500, ratio auto only, one SVG", () => {
    expect(safeUnchecked({ model: "ideogram_vector", promptText: "", ratio: "auto" }).ok).toBe(true);
    const sized = safeUnchecked({ model: "ideogram_vector", promptText: "a fox", ratio: "1024:1024" });
    expect(sized.ok).toBe(false);
    const count = safeUnchecked({ model: "ideogram_vector", promptText: "a fox", outputCount: 2 });
    expect(count.ok).toBe(false);
    if (!count.ok) expect(count.errors[0]).toMatchObject({ code: "unsupported_param", path: ["outputCount"] });
  });

  test("the FIBO arms take a 31-bit seed", () => {
    const r = safeUnchecked({ model: "bria_fibo_1_5", promptText: "a fox", ratio: "1024:1024", seed: 2147483648 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: "invalid_shape", path: ["seed"], meta: { max: 2147483647 } });
  });

  test("bria_fibo_edit_1_5: a chosen size needs two reference images", () => {
    const one = safeUnchecked({ model: "bria_fibo_edit_1_5", promptText: "x", ratio: "1024:1024", referenceImages: [REF] });
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.errors[0]).toMatchObject({ code: "invalid_shape", path: ["referenceImages"], meta: { min: 2 } });
    expect(
      safeUnchecked({ model: "bria_fibo_edit_1_5", promptText: "x", ratio: "1024:1024", referenceImages: [REF, REF] }).ok,
    ).toBe(true);
    expect(safeUnchecked({ model: "bria_fibo_edit_1_5", promptText: "x", ratio: "auto", referenceImages: [REF] }).ok).toBe(
      true,
    );
  });

  test("gpt_image_2_6: GIF needs ratio auto and no references; JPEG no transparency; frames are GIF-only", () => {
    const base = { model: "gpt_image_2_6_flare", promptText: "a fox" };
    const gifSized = safeUnchecked({ ...base, ratio: "1920:1920", outputFormat: "gif" });
    expect(gifSized.ok).toBe(false);
    if (!gifSized.ok) expect(gifSized.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["ratio"] });
    expect(safeUnchecked({ ...base, ratio: "auto", outputFormat: "gif", frameCount: 16, frameDurationMs: 40 }).ok).toBe(true);
    const svgRefs = safeUnchecked({ ...base, ratio: "auto", outputFormat: "svg", referenceImages: [REF] });
    expect(svgRefs.ok).toBe(false);
    if (!svgRefs.ok) expect(svgRefs.errors[0]).toMatchObject({ code: "unsupported_param", path: ["referenceImages"] });
    const jpegAlpha = safeUnchecked({ ...base, ratio: "auto", outputFormat: "jpeg", background: "transparent" });
    expect(jpegAlpha.ok).toBe(false);
    if (!jpegAlpha.ok) expect(jpegAlpha.errors[0]?.path).toEqual(["background"]);
    expect(safeUnchecked({ ...base, ratio: "auto", outputFormat: "jpeg", background: "opaque" }).ok).toBe(true);
    // `frameCount` on the default PNG output.
    const frames = safeUnchecked({ ...base, ratio: "auto", frameCount: 4 });
    expect(frames.ok).toBe(false);
    if (!frames.ok) expect(frames.errors[0]).toMatchObject({ path: ["outputFormat"], meta: { value: "png" } });
  });

  test("ideogram_4_5's editing rules", () => {
    const base = { model: "ideogram_4_5", promptText: "make it night" };
    const veryLow = safeUnchecked({ ...base, quality: "very_low" });
    expect(veryLow.ok).toBe(false);
    if (!veryLow.ok) expect(veryLow.errors[0]?.path).toEqual(["referenceImages"]);
    expect(safeUnchecked({ ...base, quality: "very_low", referenceImages: [REF] }).ok).toBe(true);
    const precise = safeUnchecked({ ...base, preciseEdit: true });
    expect(precise.ok).toBe(false);
    const preciseVeryLow = safeUnchecked({ ...base, preciseEdit: true, quality: "very_low", referenceImages: [REF] });
    expect(preciseVeryLow.ok).toBe(false);
    if (!preciseVeryLow.ok) expect(preciseVeryLow.errors[0]?.path).toEqual(["quality"]);
    const autoWindow = safeUnchecked({ ...base, referenceImages: [REF], contextWindow: "auto" });
    expect(autoWindow.ok).toBe(false);
    if (!autoWindow.ok) expect(autoWindow.errors[0]?.path).toEqual(["maskUri"]);
    const mask = "https://example.com/mask.png";
    expect(safeUnchecked({ ...base, referenceImages: [REF], contextWindow: "auto", maskUri: mask }).ok).toBe(true);
    const tooMany = safeUnchecked({ ...base, referenceImages: Array(5).fill(REF), maskUri: mask });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors[0]?.meta).toMatchObject({ max: 4, count: 5 });
  });

  test("background transparent: sunburst yes, flare no", () => {
    expect(
      safeUnchecked({ model: "gpt_image_2_5_sunburst", promptText: "x", ratio: "auto", background: "transparent" }).ok,
    ).toBe(true);
    const flare = safeUnchecked({ model: "gpt_image_2_5_flare", promptText: "x", ratio: "auto", background: "transparent" });
    expect(flare.ok).toBe(false);
    if (!flare.ok) expect(flare.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["background"] });
  });

  test("webp is muse_image's (and GPT Image 2.6's), not seedream's", () => {
    expect(safeUnchecked({ model: "muse_image", promptText: "x", ratio: "auto", outputFormat: "webp" }).ok).toBe(true);
    const seedream = safeUnchecked({ model: "seedream5_flash", promptText: "x", ratio: "auto_1k", outputFormat: "webp" });
    expect(seedream.ok).toBe(false);
    if (!seedream.ok) expect(seedream.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("nano_banana_2.1 takes thinkingLevel and tag-only references", () => {
    expect(
      safeUnchecked({
        model: "nano_banana_2.1",
        promptText: "x",
        ratio: "1024:1024",
        thinkingLevel: "high",
        referenceImages: [{ uri: REF.uri, tag: "fox" }],
      }).ok,
    ).toBe(true);
    const subject = safeUnchecked({
      model: "nano_banana_2.1",
      promptText: "x",
      ratio: "1024:1024",
      referenceImages: [{ uri: REF.uri, subject: "human" }],
    });
    expect(subject.ok).toBe(false);
  });
});

describe("runway.image — seedream5_lite's freeform sizes", () => {
  const base = { model: "seedream5_lite", promptText: "a lighthouse" } as const;

  test("a preset, or any W:H whose area is 3686400–16777216 pixels", () => {
    expect(image.safe({ ...base, ratio: "2048:2048" }).ok).toBe(true);
    expect(image.safe({ ...base, ratio: "3000:2000" }).ok).toBe(true);
    expect(image.safe({ ...base, ratio: "4096:4096" }).ok).toBe(true);
  });

  test("a size outside the range, or a non-size, is refused naming both forms", () => {
    const small = image.safe({ ...base, ratio: "1024:1024" });
    expect(small.ok).toBe(false);
    if (!small.ok) {
      expect(small.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["ratio"] });
      expect(small.errors[0]?.meta).toMatchObject({ minPixels: 3686400, maxPixels: 16777216 });
    }
    expect(safeUnchecked({ ...base, ratio: "auto_2k" }).ok).toBe(false);
  });
});
