import { describe, expect, test } from "bun:test";
import { image, LEONARDO_GENERATIONS_URL } from "./image";
import {
  LEONARDO_DEFAULT_STYLE_ID,
  LEONARDO_MODEL_RULES,
  LEONARDO_STYLE_LIMIT_DOCS_URL,
} from "./model-rules";
import { models } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const ELEMENTS_MODELS = [
  "kino-xl",
  "anime-xl",
  "portrait-perfect",
  "stock-photography",
  "illustrative-albedo",
  "concept-art",
  "lifelike-vision",
  "graphic-design",
  "lightning-xl",
] as const;

describe("leonardo.image happy path", () => {
  test("validates a Lucid Origin request and keeps model in the body", () => {
    const v = image({
      model: "lucid-origin",
      parameters: {
        mode: "ULTRA",
        prompt: "a portrait-style photograph of a fox on a navy backdrop",
        width: 1200,
        height: 1200,
        quantity: 4,
        style_ids: [LEONARDO_DEFAULT_STYLE_ID],
      },
      public: false,
    });
    expect(v.request.url).toBe(LEONARDO_GENERATIONS_URL);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(v)).toEqual(["model", "parameters", "public"]);
  });

  test("validates a Phoenix request with its extra knobs", () => {
    const r = image.safe({
      model: "phoenix-v1.0",
      parameters: {
        mode: "QUALITY",
        contrast: "MEDIUM",
        tiling: true,
        negative_prompt: "blurry",
        prompt: "an orange cat standing on a blue basketball",
        width: 1472,
        height: 832,
      },
    });
    expect(r.ok).toBe(true);
  });

  test("a third-party model routed through Leonardo warns but validates", () => {
    const r = safeUnchecked({
      model: "flux-dev",
      parameters: { prompt: "a cabin in the snow", width: 1024 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });

  test("the catalog holds the tabled image models, each with a rule", () => {
    expect(Object.keys(models)).toEqual([
      "lucid-origin",
      "lucid-realism",
      "phoenix-v1.0",
      "phoenix-v0.9",
      ...ELEMENTS_MODELS,
    ]);
    expect(Object.keys(LEONARDO_MODEL_RULES)).toEqual(Object.keys(models));
    // Leonardo publishes no public per-model rate — no cost, no estimate.
    for (const model of Object.values(models)) expect(model).not.toHaveProperty("cost");
    const r = image.safe({ model: "lucid-origin", parameters: { prompt: "x" } });
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("leonardo.image Elements models", () => {
  test.each([...ELEMENTS_MODELS])("%s validates as a known model, with no cost estimate", (model) => {
    const r = safeUnchecked({
      model,
      parameters: {
        prompt: "a lighthouse in fog",
        mode: "QUALITY",
        negative_prompt: "blurry",
        width: 1024,
        height: 1536,
        style_ids: [LEONARDO_MODEL_RULES[model]!.styleIds[0]],
      },
    });
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.estimate.costUSD).toBeUndefined();
  });

  test("their mode is FAST or QUALITY — ULTRA is refused", () => {
    const r = safeUnchecked({ model: "kino-xl", parameters: { prompt: "x", mode: "ULTRA" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.["allowed"]).toEqual(["FAST", "QUALITY"]);
    }
  });

  test("width tops out at 1584 on anime-xl but 1536 on kino-xl; height at 1536 on both", () => {
    expect(
      image.safe({ model: "anime-xl", parameters: { prompt: "x", width: 1584 } }).ok,
    ).toBe(true);

    const kino = safeUnchecked({ model: "kino-xl", parameters: { prompt: "x", width: 1584 } });
    expect(kino.ok).toBe(false);
    if (!kino.ok) expect(kino.errors[0]?.message).toContain("between 32 and 1536");

    const tall = safeUnchecked({ model: "anime-xl", parameters: { prompt: "x", height: 1584 } });
    expect(tall.ok).toBe(false);
    if (!tall.ok) expect(tall.errors[0]?.path).toEqual(["parameters", "height"]);
  });

  test("the prompt cap is 9999 characters", () => {
    expect(
      image.safe({ model: "lightning-xl", parameters: { prompt: "a".repeat(9999) } }).ok,
    ).toBe(true);
    const long = safeUnchecked({
      model: "lightning-xl",
      parameters: { prompt: "a".repeat(10000) },
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors[0]?.message).toContain("9999");
  });

  test("transparency is a boolean, and an Elements-only key elsewhere", () => {
    expect(
      image.safe({ model: "graphic-design", parameters: { prompt: "x", transparency: true } }).ok,
    ).toBe(true);

    const notBoolean = safeUnchecked({
      model: "graphic-design",
      parameters: { prompt: "x", transparency: "yes" },
    });
    expect(notBoolean.ok).toBe(false);
    if (!notBoolean.ok) expect(notBoolean.errors[0]?.path).toEqual(["parameters", "transparency"]);

    const phoenix = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: { prompt: "x", transparency: true },
    });
    expect(phoenix.ok).toBe(false);
    if (!phoenix.ok) {
      expect(phoenix.errors[0]?.code).toBe("unsupported_param");
      expect(phoenix.errors[0]?.meta?.["models"]).toEqual([...ELEMENTS_MODELS]);
    }
  });

  test("user_elements and platform_elements take at most 4 entries, weight ≥ 0", () => {
    const four = [0, 1, 2, 3].map((i) => ({ akUUID: `element-${i}`, weight: 0.5 }));
    expect(
      image.safe({
        model: "concept-art",
        parameters: { prompt: "x", user_elements: four, platform_elements: four },
      }).ok,
    ).toBe(true);

    const five = safeUnchecked({
      model: "concept-art",
      parameters: { prompt: "x", platform_elements: [...four, { weight: 1 }] },
    });
    expect(five.ok).toBe(false);
    if (!five.ok) expect(five.errors[0]?.message).toContain("limited to 4 entries");

    const negative = safeUnchecked({
      model: "concept-art",
      parameters: { prompt: "x", user_elements: [{ weight: -0.1 }] },
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.errors[0]?.path).toEqual(["parameters", "user_elements", 0, "weight"]);
    }
  });

  test("edge, pose, depth and text_image guidance are Elements-only", () => {
    const guidances = {
      edge: [{ image: { id: "a", type: "UPLOADED" as const }, strength: "LOW" as const }],
      pose: [{ image: { id: "b" }, strength: "MID" as const }],
      depth: [{ image: { id: "c" }, order: 0, strength: "HIGH" as const }],
      text_image: [{ image: { id: "d" }, strength: "MID" as const }],
    };
    expect(
      image.safe({ model: "lifelike-vision", parameters: { prompt: "x", guidances } }).ok,
    ).toBe(true);

    const phoenix = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: { prompt: "x", guidances: { edge: guidances.edge } },
    });
    expect(phoenix.ok).toBe(false);
    if (!phoenix.ok) {
      expect(phoenix.errors[0]?.code).toBe("unsupported_param");
      expect(phoenix.errors[0]?.path).toEqual(["parameters", "guidances", "edge"]);
    }

    const two = safeUnchecked({
      model: "lifelike-vision",
      parameters: { prompt: "x", guidances: { depth: [...guidances.depth, ...guidances.depth] } },
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0]?.message).toContain("limited to 1 reference");
  });

  test("each Elements model keeps its own style allowlist", () => {
    // anime-xl's default style is not a stock-photography style.
    const animeDefault = "b2a54a51-230b-4d4f-ad4e-8409bf58645f";
    expect(LEONARDO_MODEL_RULES["anime-xl"]!.styleIds).toContain(animeDefault);
    expect(
      image.safe({ model: "anime-xl", parameters: { prompt: "x", style_ids: [animeDefault] } }).ok,
    ).toBe(true);

    const r = safeUnchecked({
      model: "stock-photography",
      parameters: { prompt: "x", style_ids: [animeDefault] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.["allowed"]).toEqual([
        "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
        "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
      ]);
    }
  });

  test("a Phoenix-and-Elements key on Lucid names every model that takes it", () => {
    const r = safeUnchecked({ model: "lucid-realism", parameters: { prompt: "x", tiling: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.meta?.["models"]).toEqual(["phoenix-v1.0", "phoenix-v0.9", ...ELEMENTS_MODELS]);
      expect(r.errors[0]?.message).toContain('"kino-xl"');
    }
  });
});

describe("leonardo.image per-model dimensions", () => {
  test("Lucid Origin allows a 3840x3616 canvas Phoenix does not", () => {
    expect(
      image.safe({
        model: "lucid-origin",
        parameters: { prompt: "x", width: 3840, height: 3616 },
      }).ok,
    ).toBe(true);

    const phoenix = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: { prompt: "x", width: 3840 },
    });
    expect(phoenix.ok).toBe(false);
    if (!phoenix.ok) {
      expect(phoenix.errors[0]?.path).toEqual(["parameters", "width"]);
      expect(phoenix.errors[0]?.message).toContain("2048");
    }
  });

  test("Lucid Origin's height cap is lower than its width cap", () => {
    const r = safeUnchecked({
      model: "lucid-origin",
      parameters: { prompt: "x", height: 3840 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("3616");
  });

  test("dimensions must be multiples of 8", () => {
    const r = safeUnchecked({ model: "lucid-origin", parameters: { prompt: "x", width: 1201 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("multiple of 8");
  });

  test("quantity is capped at 8", () => {
    const r = safeUnchecked({ model: "lucid-realism", parameters: { prompt: "x", quantity: 9 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["parameters", "quantity"]);
  });
});

describe("leonardo.image per-model params", () => {
  test("Phoenix-only params are rejected on the Lucid models", () => {
    const r = safeUnchecked({
      model: "lucid-origin",
      parameters: { prompt: "x", contrast: "HIGH" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["parameters", "contrast"]);
    }
  });

  test("QUALITY mode is Phoenix-only", () => {
    const r = safeUnchecked({ model: "lucid-origin", parameters: { prompt: "x", mode: "QUALITY" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    expect(
      image.safe({ model: "phoenix-v0.9", parameters: { prompt: "x", mode: "QUALITY" } }).ok,
    ).toBe(true);
  });

  test("an unknown nested param is a warning, not an error", () => {
    const r = safeUnchecked({ model: "lucid-origin", parameters: { prompt: "x", alchemy: true } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => w.code === "unknown_param" && w.path[1] === "alchemy")).toBe(
        true,
      );
    }
  });

  test("prompt is required and length-capped per model", () => {
    const missing = safeUnchecked({ model: "lucid-origin", parameters: {} });
    expect(missing.ok).toBe(false);

    const long = safeUnchecked({
      model: "lucid-origin",
      parameters: { prompt: "a".repeat(2001) },
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors[0]?.message).toContain("2000");

    // Lucid Realism's schema allows a far longer prompt.
    expect(
      image.safe({ model: "lucid-realism", parameters: { prompt: "a".repeat(2001) } }).ok,
    ).toBe(true);
  });

  test("negative_prompt is capped at 1000 characters on Phoenix", () => {
    const r = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: { prompt: "x", negative_prompt: "a".repeat(1001) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["parameters", "negative_prompt"]);
  });
});

describe("leonardo.image style ids and guidances", () => {
  test("style ids come from the model's own allowlist", () => {
    // A Phoenix-only style id on Lucid Origin.
    const phoenixOnly = LEONARDO_MODEL_RULES["phoenix-v1.0"]!.styleIds.find(
      (id) => !LEONARDO_MODEL_RULES["lucid-origin"]!.styleIds.includes(id),
    );
    expect(phoenixOnly).toBeDefined();
    const r = safeUnchecked({
      model: "lucid-origin",
      parameters: { prompt: "x", style_ids: [phoenixOnly] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  // The 1-style cap is prose-only: the OpenAPI schema has no `maxItems` on
  // `style_ids`, so this warns (and cites the prose page) rather than erroring.
  test("style_ids over the documented limit warns, and cites the prose page", () => {
    const ids = LEONARDO_MODEL_RULES["lucid-origin"]!.styleIds.slice(0, 2);
    const r = safeUnchecked({ model: "lucid-origin", parameters: { prompt: "x", style_ids: ids } });
    expect(r.ok).toBe(true);
    const warning = r.warnings.find((w) => w.path.join(".") === "parameters.style_ids");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("limited to 1 style");
    expect(warning?.meta?.["source"]).toBe(LEONARDO_STYLE_LIMIT_DOCS_URL);
  });

  test("image_to_image guidance is Phoenix-only", () => {
    const lucid = safeUnchecked({
      model: "lucid-origin",
      parameters: {
        prompt: "x",
        guidances: { image_to_image: [{ image: { id: "abc" }, strength: "MID" }] },
      },
    });
    expect(lucid.ok).toBe(false);
    if (!lucid.ok) expect(lucid.errors[0]?.code).toBe("unsupported_param");

    expect(
      image.safe({
        model: "phoenix-v1.0",
        parameters: {
          prompt: "x",
          guidances: { image_to_image: [{ image: { id: "abc", type: "UPLOADED" }, strength: "HIGH" }] },
        },
      }).ok,
    ).toBe(true);
  });

  test("style guidance accepts ULTRA/MAX but content guidance does not", () => {
    expect(
      image.safe({
        model: "lucid-origin",
        parameters: { prompt: "x", guidances: { style: [{ image: { id: "a" }, strength: "MAX" }] } },
      }).ok,
    ).toBe(true);

    const content = safeUnchecked({
      model: "lucid-origin",
      parameters: { prompt: "x", guidances: { content: [{ image: { id: "a" }, strength: "MAX" }] } },
    });
    expect(content.ok).toBe(false);
    if (!content.ok) expect(content.errors[0]?.path).toEqual([
      "parameters",
      "guidances",
      "content",
      0,
      "strength",
    ]);
  });

  test("Phoenix takes 4 style guidances, Lucid only 1", () => {
    const four = [0, 1, 2, 3].map((i) => ({ image: { id: `img-${i}` }, strength: "MID" as const }));
    expect(
      image.safe({ model: "phoenix-v1.0", parameters: { prompt: "x", guidances: { style: four } } })
        .ok,
    ).toBe(true);

    const lucid = safeUnchecked({
      model: "lucid-origin",
      parameters: { prompt: "x", guidances: { style: four } },
    });
    expect(lucid.ok).toBe(false);
    if (!lucid.ok) expect(lucid.errors[0]?.message).toContain("limited to 1 reference");
  });

  test("an unknown image reference type is reported", () => {
    const r = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: {
        prompt: "x",
        guidances: { style: [{ image: { id: "a", type: "SKETCH" }, strength: "MID" }] },
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual([
      "parameters",
      "guidances",
      "style",
      0,
      "image",
      "type",
    ]);
  });

  test("a guidance entry without strength is reported", () => {
    const r = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: { prompt: "x", guidances: { character: [{ image: { id: "a" } }] } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual([
      "parameters",
      "guidances",
      "character",
      0,
      "strength",
    ]);
  });
});

describe("leonardo.image shape safety", () => {
  test("a non-object parameters value is reported, not thrown", () => {
    const r = safeUnchecked({ model: "lucid-origin", parameters: "prompt" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "invalid_shape")).toBe(true);
  });

  test("malformed guidance shapes never throw", () => {
    const r = safeUnchecked({
      model: "phoenix-v1.0",
      parameters: { prompt: "x", guidances: { style: [null, 3, { image: 7, strength: "MID" }] } },
    });
    expect(r.ok).toBe(false);
  });
});
