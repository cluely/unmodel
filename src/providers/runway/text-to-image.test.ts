import { describe, expect, test } from "bun:test";
import { textToImage, TEXT_TO_IMAGE_URL } from "./text-to-image";
import { RUNWAY_VERSION } from "./shared";
import { textToImageConstraints } from "./constraints";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = textToImage.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("runway.textToImage happy path", () => {
  test("returns a wire-pure body with URL, method and version header", () => {
    const v = textToImage({
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
    const r = textToImage.safe({ model: "gen5_image", promptText: "hi", ratio: "1024:1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("a video model on the image route warns as unknown_model", () => {
    const r = textToImage.safe({ model: "gen4.5", promptText: "hi", ratio: "1024:1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("missing promptText or ratio is invalid_shape", () => {
    const r = safeUnchecked({ model: "gen4_image" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => e.code === "invalid_shape")).toBe(true);
  });
});

describe("runway.textToImage per-model rules", () => {
  test("gen4_image_turbo requires referenceImages", () => {
    const r = textToImage.safe({
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
    const r = textToImage.safe({
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

  test("gpt_image_2 background is opaque/auto and transparent is rejected", () => {
    const r = safeUnchecked({
      model: "gpt_image_2",
      promptText: "hi",
      ratio: "auto",
      background: "transparent",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("quality on gen4_image is unsupported_param with a doc source", () => {
    const r = textToImage.safe({
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
    const r = textToImage.safe({
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

describe("runway.textToImage cost estimation", () => {
  test("gemini_2.5_flash is a flat 5 credits ($0.05)", () => {
    const r = textToImage.safe({
      model: "gemini_2.5_flash",
      promptText: "hi",
      ratio: "1024:1024",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05, 10);
  });

  test("gpt_image_2 low quality at a 1K/2K ratio is 1 credit", () => {
    const r = textToImage.safe({
      model: "gpt_image_2",
      promptText: "hi",
      ratio: "1920:1088",
      quality: "low",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.01, 10);
  });

  test("gpt_image_2 defaults to high quality; auto ratio bills at 4K (41)", () => {
    const r = textToImage.safe({ model: "gpt_image_2", promptText: "hi", ratio: "auto" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.41, 10);
  });

  test("grok_imagine_image_2 matches the documented worked example", () => {
    // "four 1K medium images with two references is 4 × 6 + 2 = 26 credits"
    // — guides/pricing.md
    const r = textToImage.safe({
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

  test("gemini_image3.1_flash has no published price and no estimate", () => {
    const r = textToImage.safe({
      model: "gemini_image3.1_flash",
      promptText: "hi",
      ratio: "1024:1024",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = textToImage.safe(
      { model: "gemini_image3_pro", promptText: "hi", ratio: "4096:4096", outputCount: 4 },
      { maxCostUSD: 1 },
    );
    // 4 × 40 credits = 160 credits = $1.60 > $1.00
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("runway.textToImage reference-image shape rules", () => {
  const IMAGE = "https://example.com/ref.png";

  test("tag must be 3-16 lowercase chars starting with a letter", () => {
    const ok = textToImage.safe({
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
    const ok = textToImage.safe({
      model: "gemini_image3_pro",
      promptText: "x",
      ratio: "1024:1024",
      referenceImages: [{ uri: IMAGE, subject: "human" }],
    });
    expect(ok.ok).toBe(true);

    const bad = textToImage.safe({
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
    const r = textToImage.safe({
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
    const over = textToImage.safe({
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
      textToImage.safe({
        model: "gpt_image_2",
        promptText: "x",
        ratio: "auto",
        referenceImages: Array(16).fill(ref),
      }).ok,
    ).toBe(true);
  });

  test("gen4_image_turbo requires at least one reference image", () => {
    const r = textToImage.safe({
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
    const long = "a".repeat(5501);
    const gemini = textToImage.safe({
      model: "gemini_image3_pro",
      promptText: long,
      ratio: "1024:1024",
    });
    expect(gemini.ok).toBe(false);
    if (!gemini.ok) {
      expect(gemini.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(5500);
    }
    // gpt_image_2 allows 32000.
    expect(textToImage.safe({ model: "gpt_image_2", promptText: long, ratio: "auto" }).ok).toBe(true);
  });
});

describe("runway.textToImage documented enum coverage", () => {
  // The RunwayImageRatio / RunwayImageQuality / RunwayImageOutputFormat unions
  // in constraints.ts are derived from these same per-model tables, so
  // iterating the tables proves every value the types advertise is one the
  // runtime accepts for the model that documents it.
  test("every documented ratio validates on the model that documents it", () => {
    for (const [model, constraints] of Object.entries(textToImageConstraints)) {
      const ratios = constraints?.enums?.ratio;
      if (ratios === undefined) continue;
      for (const ratio of ratios) {
        const r = safeUnchecked({
          model,
          promptText: "hi",
          ratio,
          // gen4_image_turbo is the one arm with an extra required param.
          ...(model === "gen4_image_turbo" && {
            referenceImages: [{ uri: "https://example.com/a.png" }],
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
    for (const [model, constraints] of Object.entries(textToImageConstraints)) {
      const ratio = constraints?.enums?.ratio?.[0];
      if (ratio === undefined) continue;
      for (const param of ["quality", "outputFormat"] as const) {
        for (const value of constraints?.enums?.[param] ?? []) {
          const r = safeUnchecked({ model, promptText: "hi", ratio, [param]: value });
          expect(r.ok, `${model} should accept ${param} ${String(value)}`).toBe(true);
        }
      }
    }
  });
});
