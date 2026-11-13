import { describe, expect, test } from "bun:test";
import {
  image,
  IMAGES_GENERATIONS_URL,
  DEFAULT_MODEL_ID,
  DEFAULT_STYLE_REFERENCES_MODEL_ID,
  STYLE_CREATION_USD,
  ASPECT_RATIOS,
  V4_STANDARD_SIZES,
  V4_PRO_SIZES,
  V2_V3_SIZES,
  UNATTRIBUTED_SIZE_VALUES,
  type RecraftSize,
} from "./image";
import { models, type RecraftModelId } from "./models";
import { STYLE_NAMES_BY_MODEL } from "./styles";
import { UnmodelValidationError } from "../../core/issues";
import type { ModelInfo } from "../../core/catalog-types";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("recraft.image happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      prompt: "race car on a track",
      model: "recraftv3" as const,
      style: "Photorealism" as const,
      size: "1820x1024" as const,
      n: 2,
    };
    const v = image(params);

    expect(Object.keys(v)).toEqual(["prompt", "model", "style", "size", "n"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(IMAGES_GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // Recraft rides the OpenAI SDK: the wire body is the SDK shape.
    expect(v.toSdk("recraft")).toEqual(params);
  });

  test("a bare prompt validates against the default model", () => {
    const r = image.safe({ prompt: "a lighthouse" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      // default model recraftv4_1 → $0.035 per image × 1.
      expect(r.estimate.costUSD).toBeCloseTo(0.035, 10);
    }
  });

  test("explicit null means provider default and passes", () => {
    const r = image.safe({
      prompt: "x",
      model: null,
      style: null,
      style_id: null,
      size: null,
      negative_prompt: null,
      random_seed: null,
      response_format: null,
      text_layout: null,
      controls: null,
    });
    expect(r.ok).toBe(true);
  });

  test("unknown model warns and passes model-dependent checks through", () => {
    const r = image.safe({ prompt: "x", model: "recraftv5", size: "9999x9999" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown params pass through with a warning", () => {
    const r = safeUnchecked({ prompt: "x", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("recraft.image styles", () => {
  test("a style no curated list holds lands on the default (V4.1) model, which denies it", () => {
    const r = image.safe({ prompt: "x", style: "Not a curated style" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["style"]);
      expect(r.errors[0]?.model).toBe(DEFAULT_MODEL_ID);
      expect(String(r.errors[0]?.meta?.source)).toContain("recraft.ai/docs");
    }
  });

  test("style_id validates on the V4 / V4.1 line; negative_prompt is still denied", () => {
    // "Every V4 and V4.1 model (except V4.1 Flash) also accepts `style_id` or
    // style references, at that model's own price." — V4 Styles page.
    for (const model of ["recraftv4_pro", "recraftv4_1", "recraftv4_1_utility_vector"] as const) {
      const ok = image.safe({ prompt: "x", model, style_id: "b9af225b-6b98-43d0-a4b3-16343641e852" });
      expect(ok.ok, model).toBe(true);
      if (ok.ok) expect(ok.warnings, model).toEqual([]);
    }
    const r = image.safe({
      prompt: "x",
      model: "recraftv4_pro",
      style_id: "b9af225b-6b98-43d0-a4b3-16343641e852",
      negative_prompt: "blurry",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toEqual(["negative_prompt"]);
  });

  test("with no model, a curated style picks its V3 / V2 model as the server does", () => {
    // Recraft's own text_layout example: `{prompt, style: "Illustration", text_layout}`.
    const layout = [{ text: "HI", bbox: [[0.3, 0.45], [0.6, 0.45], [0.6, 0.55], [0.3, 0.55]] }];
    const v3 = image.safe({ prompt: "cute red panda with a sign", style: "Illustration", text_layout: layout });
    expect(v3.ok).toBe(true);
    if (v3.ok) expect(v3.estimate.costUSD).toBeCloseTo(0.04, 10);
    const vector = image.safe({ prompt: "x", style: "Vector art" });
    expect(vector.ok).toBe(true);
    if (vector.ok) expect(vector.estimate.costUSD).toBeCloseTo(0.08, 10);
    // "3D render" is on V2's list only: "to Recraft V2 otherwise".
    const v2 = image.safe({ prompt: "x", style: "3D render" });
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.estimate.costUSD).toBeCloseTo(0.022, 10);
    // Resolved to recraftv2, which denies text_layout.
    const v2Layout = image.safe({ prompt: "x", style: "3D render", text_layout: layout });
    expect(v2Layout.ok).toBe(false);
    if (!v2Layout.ok) expect(v2Layout.errors[0]?.model).toBe("recraftv2");
  });

  test("a V3 style passes on recraftv3 but not on recraftv3_vector", () => {
    expect(image.safe({ prompt: "x", model: "recraftv3", style: "Recraft V3 Raw" }).ok).toBe(
      true,
    );
    // @ts-expect-error — the type now catches what the runtime catches: `style`
    // resolves per model (StyleFor<M>), so a V3 Vector name on recraftv3 no
    // longer compiles. Kept as a runtime test because JS callers still reach it.
    const r = image.safe({ prompt: "x", model: "recraftv3", style: "Vector art" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["style"]);
      expect(r.errors[0]?.meta?.allowed).toContain("Photorealism");
    }
    expect(
      image.safe({ prompt: "x", model: "recraftv3_vector", style: "Vector art" }).ok,
    ).toBe(true);
  });

  test("V2 styles validate against the V2 lists", () => {
    expect(image.safe({ prompt: "x", model: "recraftv2", style: "Voxel art" }).ok).toBe(true);
    expect(image.safe({ prompt: "x", model: "recraftv2_vector", style: "Icon" }).ok).toBe(
      true,
    );
    // @ts-expect-error — the type now catches what the runtime catches: "Icon"
    // is a V2 Vector name and recraftv2 is raster. Kept as a runtime test
    // because JS callers still reach it.
    const r = image.safe({ prompt: "x", model: "recraftv2", style: "Icon" });
    expect(r.ok).toBe(false);
  });

  test("style and style_id together are rejected", () => {
    const r = image.safe({
      prompt: "x",
      model: "recraftv3",
      style: "Photorealism",
      style_id: "6b98805f-9342-4d1e-9b53-bcb6b6d20ea1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.message).toContain("cannot be used together");
    }
  });

  test("constraintsFor exposes the V4 family deny rules", () => {
    const rules = image.constraintsFor("recraftv4_1");
    expect(rules.length).toBe(1);
    expect(Object.keys(rules[0]?.deny ?? {}).sort()).toEqual([
      "negative_prompt",
      "style",
      "text_layout",
    ]);
    // V3 denies nothing; its one family rule narrows `style_match`.
    const v3 = image.constraintsFor("recraftv3");
    expect(v3.flatMap((rule) => Object.keys(rule.deny ?? {}))).toEqual([]);
    expect(v3.map((rule) => rule.enums)).toEqual([{ style_match: ["regular"] }]);
  });

  test("every style-listed model exists in the catalog", () => {
    for (const modelId of Object.keys(STYLE_NAMES_BY_MODEL)) {
      expect(models[modelId as keyof typeof models]).toBeDefined();
    }
  });
});

describe("recraft.image V4.1 Flash", () => {
  test("validates and prices at $0.007 per image", () => {
    const r = image.safe({ prompt: "x", model: "recraftv4_1_flash", n: 3, size: "1344x768" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.021, 10);
    }
  });

  test("takes the 1K size table and the 10,000-character prompt cap", () => {
    const pro = image.safe({ prompt: "x", model: "recraftv4_1_flash", size: "2048x2048" });
    expect(pro.ok).toBe(false);
    if (!pro.ok) expect(pro.errors[0]?.meta?.allowed).toEqual([...V4_STANDARD_SIZES]);
    expect(image.safe({ prompt: "y".repeat(10_000), model: "recraftv4_1_flash" }).ok).toBe(true);
    expect(image.safe({ prompt: "y".repeat(10_001), model: "recraftv4_1_flash" }).ok).toBe(false);
  });

  test("refuses every style input, negative_prompt and text_layout", () => {
    const r = safeUnchecked({
      prompt: "x",
      model: "recraftv4_1_flash",
      style_id: "b9af225b-6b98-43d0-a4b3-16343641e852",
      style_match: "flexible",
      negative_prompt: "blurry",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(Array(3).fill("unsupported_param"));
      expect(r.errors.map((e) => e.path[0])).toEqual(["style_id", "style_match", "negative_prompt"]);
      expect(String(r.errors[0]?.meta?.source)).toContain("recraft-v4-1-flash");
    }
    const refs = image.safe({
      prompt: "x",
      model: "recraftv4_1_flash_raster",
      style_reference_urls: ["https://example.com/ref.png"],
    });
    expect(refs.ok).toBe(false);
    if (!refs.ok) expect(refs.errors[0]?.path).toEqual(["style_reference_urls"]);
  });
});

describe("recraft.image V4 Styles", () => {
  const STYLE_ID = "229b2a75-05e4-4580-85f9-b47ee521a00d";
  const REFS = ["https://example.com/ref.png"];

  test("a request with no style is refused, naming both ways to supply one", () => {
    const r = image.safe({ prompt: "x", model: "recraftv4_styles" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["style_id"]);
      expect(r.errors[0]?.message).toContain("`style_reference_urls`");
    }
  });

  test("style_id validates at the per-image rate", () => {
    const r = image.safe({ prompt: "x", model: "recraftv4_styles_pro", style_id: STYLE_ID, n: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.2, 10);
    }
  });

  test("style references add the $0.005 style-creation charge once", () => {
    const r = image.safe({
      prompt: "x",
      model: "recraftv4_styles_vector",
      style_reference_urls: REFS,
      n: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(2 * 0.05 + STYLE_CREATION_USD, 10);
    const proVector = image.safe({
      prompt: "x",
      model: "recraftv4_styles_pro_vector",
      style_id: STYLE_ID,
    });
    expect(proVector.ok).toBe(true);
    if (proVector.ok) expect(proVector.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("references with no model resolve to recraftv4_styles", () => {
    const r = image.safe({ prompt: "x", style_reference_urls: REFS, size: "1024x1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.035 + STYLE_CREATION_USD, 10);
    // recraftv4_styles takes the V4 style_match vocabulary, not V3's.
    const regular = image.safe({ prompt: "x", style_reference_urls: REFS, style_match: "regular" });
    expect(regular.ok).toBe(false);
    if (!regular.ok) expect(regular.errors[0]?.model).toBe(DEFAULT_STYLE_REFERENCES_MODEL_ID);
  });

  test("style_id and style references together are refused", () => {
    const r = image.safe({
      prompt: "x",
      model: "recraftv4_styles",
      style_id: STYLE_ID,
      style_reference_urls: REFS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["style_reference_urls"]);
    }
  });

  test("style_reference_urls holds 1 to 10 images", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`);
    expect(image.safe({ prompt: "x", model: "recraftv4_styles", style_reference_urls: eleven }).ok)
      .toBe(false);
    expect(image.safe({ prompt: "x", model: "recraftv4_styles", style_reference_urls: [] }).ok)
      .toBe(false);
  });

  test("style_match takes flexible | precise; curated styles are refused", () => {
    expect(
      image.safe({ prompt: "x", model: "recraftv4_styles", style_id: STYLE_ID, style_match: "precise" })
        .ok,
    ).toBe(true);
    const r = image.safe({
      prompt: "x",
      model: "recraftv4_styles",
      style_id: STYLE_ID,
      style_match: "regular",
      negative_prompt: "blurry",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.code, e.path[0]])).toEqual([
        ["unsupported_param", "negative_prompt"],
        ["invalid_enum_value", "style_match"],
      ]);
    }
  });

  test("the 1K / 2K size tables apply per variant", () => {
    expect(
      image.safe({ prompt: "x", model: "recraftv4_styles", style_id: STYLE_ID, size: "1344x768" }).ok,
    ).toBe(true);
    expect(
      image.safe({ prompt: "x", model: "recraftv4_styles_pro", style_id: STYLE_ID, size: "2688x1536" })
        .ok,
    ).toBe(true);
    expect(
      image.safe({ prompt: "x", model: "recraftv4_styles_pro", style_id: STYLE_ID, size: "1344x768" })
        .ok,
    ).toBe(false);
  });
});

describe("recraft.image _raster aliases", () => {
  const ALIASES: ReadonlyArray<readonly [RecraftModelId, RecraftModelId]> = [
    ["recraftv4_1_raster", "recraftv4_1"],
    ["recraftv4_1_pro_raster", "recraftv4_1_pro"],
    ["recraftv4_1_utility_raster", "recraftv4_1_utility"],
    ["recraftv4_1_utility_pro_raster", "recraftv4_1_utility_pro"],
    ["recraftv4_1_flash_raster", "recraftv4_1_flash"],
    ["recraftv4_raster", "recraftv4"],
    ["recraftv4_pro_raster", "recraftv4_pro"],
    ["recraftv4_styles_raster", "recraftv4_styles"],
    ["recraftv4_styles_pro_raster", "recraftv4_styles_pro"],
    ["recraftv3_raster", "recraftv3"],
    ["recraftv2_raster", "recraftv2"],
  ];

  test("every alias is cataloged with its base model's rate and prompt cap", () => {
    for (const [alias, baseId] of ALIASES) {
      const info: ModelInfo = models[alias];
      const baseInfo: ModelInfo = models[baseId];
      expect(info.cost?.perImage, alias).toBe(baseInfo.cost?.perImage);
      expect(info.limit.characters, alias).toBe(baseInfo.limit.characters);
      expect(image.constraintsFor(alias), alias).toEqual(image.constraintsFor(baseId));
    }
  });

  test("every alias validates warning-free and prices like its base", () => {
    for (const [alias, baseId] of ALIASES) {
      const style = alias.startsWith("recraftv4_styles") ? { style_id: "abc" } : {};
      const r = image.safe({ prompt: "x", model: alias, n: 2, ...style });
      expect(r.ok, alias).toBe(true);
      if (r.ok) {
        expect(r.warnings, alias).toEqual([]);
        const baseInfo: ModelInfo = models[baseId];
        expect(r.estimate.costUSD, alias).toBeCloseTo(2 * (baseInfo.cost?.perImage ?? NaN), 10);
      }
    }
  });

  test("an alias takes its base model's size table", () => {
    const v4 = image.safe({ prompt: "x", model: "recraftv4_1_raster", size: "1820x1024" });
    expect(v4.ok).toBe(false);
    if (!v4.ok) expect(v4.errors[0]?.meta?.allowed).toEqual([...V4_STANDARD_SIZES]);
    expect(image.safe({ prompt: "x", model: "recraftv4_pro_raster", size: "2048x2048" }).ok).toBe(true);
    expect(image.safe({ prompt: "x", model: "recraftv3_raster", size: "1820x1024" }).ok).toBe(true);
  });

  test("recraftv3_raster keeps V3's styles, controls and text_layout; recraftv2_raster V2's", () => {
    const layout = [{ text: "HI", bbox: [[0.3, 0.45], [0.6, 0.45], [0.6, 0.55], [0.3, 0.55]] }];
    expect(
      image.safe({
        prompt: "x",
        model: "recraftv3_raster",
        style: "Photorealism",
        text_layout: layout,
        controls: { artistic_level: 2, no_text: true },
      }).ok,
    ).toBe(true);
    // @ts-expect-error — "Vector art" is a V3 Vector name; the alias is raster.
    expect(image.safe({ prompt: "x", model: "recraftv3_raster", style: "Vector art" }).ok).toBe(false);
    expect(image.safe({ prompt: "x", model: "recraftv2_raster", style: "3D render" }).ok).toBe(true);
    const v2 = image.safe({ prompt: "x", model: "recraftv2_raster", text_layout: layout });
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.errors[0]?.code).toBe("unsupported_param");
  });
});

describe("recraft.image style_match", () => {
  test("V2 / V3 take only regular", () => {
    expect(image.safe({ prompt: "x", model: "recraftv3", style_id: "abc", style_match: "regular" }).ok)
      .toBe(true);
    const r = image.safe({ prompt: "x", model: "recraftv2_vector", style_id: "abc", style_match: "precise" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.allowed).toEqual(["regular"]);
    }
  });

  test("the V4 / V4.1 line takes flexible | precise", () => {
    expect(
      image.safe({
        prompt: "x",
        model: "recraftv4_1",
        style_reference_urls: ["https://example.com/ref.png"],
        style_match: "flexible",
      }).ok,
    ).toBe(true);
    const r = image.safe({ prompt: "x", model: "recraftv4_pro_vector", style_match: "regular" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toEqual(["flexible", "precise"]);
  });
});

describe("recraft.image text_layout", () => {
  const layout = [{ text: "RECRAFT", bbox: [[0.3, 0.45], [0.6, 0.45], [0.6, 0.55], [0.3, 0.55]] }];

  test("passes on V3, denied on V2 and V4", () => {
    expect(image.safe({ prompt: "x", model: "recraftv3", text_layout: layout }).ok).toBe(true);
    for (const model of ["recraftv2", "recraftv4_1"]) {
      const r = image.safe({ prompt: "x", model, text_layout: layout });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
    }
  });

  test("a bbox without exactly 4 points is invalid_shape", () => {
    const r = image.safe({
      prompt: "x",
      model: "recraftv3",
      text_layout: [{ text: "HI", bbox: [[0, 0], [1, 0], [1, 1]] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("recraft.image sizes", () => {
  test("every RecraftSize preset passes the runtime rule it advertises", () => {
    // Keep in sync with RecraftSize — the union is derived from these arrays,
    // and every arm must clear checkSize on a model that documents it, or the
    // autocomplete would advertise sizes the runtime rule rejects. The explicit
    // WxH tables are per-model-group, so each is paired with a model that takes
    // it; the 14 aspect ratios apply to every model.
    const presets: ReadonlyArray<{ model: RecraftModelId; sizes: readonly RecraftSize[] }> = [
      { model: "recraftv3", sizes: ASPECT_RATIOS },
      { model: "recraftv4_1", sizes: V4_STANDARD_SIZES },
      { model: "recraftv4_1_pro", sizes: V4_PRO_SIZES },
      { model: "recraftv3", sizes: V2_V3_SIZES },
      // Attributed to no per-model table, so it passes on every model.
      { model: "recraftv4_1", sizes: UNATTRIBUTED_SIZE_VALUES },
    ];
    for (const { model, sizes } of presets) {
      for (const size of sizes) {
        const r = image.safe({ prompt: "x", model, size });
        expect(r.ok, `${model} should accept ${size}`).toBe(true);
        if (r.ok) expect(r.warnings, `${model} + ${size} should be warning-free`).toEqual([]);
      }
    }
  });

  test("aspect ratios pass on every model; unknown ratios fail", () => {
    for (const model of ["recraftv2_vector", "recraftv4_1", "recraftv3"]) {
      expect(image.safe({ prompt: "x", model, size: "16:9" }).ok).toBe(true);
    }
    const r = image.safe({ prompt: "x", model: "recraftv3", size: "7:5" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["size"]);
    }
  });

  test("explicit sizes validate against the model's documented set", () => {
    expect(image.safe({ prompt: "x", model: "recraftv3", size: "1820x1024" }).ok).toBe(true);
    expect(image.safe({ prompt: "x", model: "recraftv4_1", size: "1344x768" }).ok).toBe(true);
    expect(image.safe({ prompt: "x", model: "recraftv4_1_pro", size: "2048x2048" }).ok).toBe(
      true,
    );

    // 1820x1024 is a V2/V3 size, not a V4.1 size.
    const r = image.safe({ prompt: "x", model: "recraftv4_1", size: "1820x1024" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toContain("1024x1024");
  });

  test("vector models pass explicit WxH through unvalidated (appendix lists aspects only)", () => {
    expect(image.safe({ prompt: "x", model: "recraftv3_vector", size: "1234x777" }).ok).toBe(
      true,
    );
  });

  test("a non-size string is a format violation", () => {
    // `RecraftSize` makes "big" a compile error, so the runtime rule has to be
    // reached through the unchecked alias.
    const r = safeUnchecked({ prompt: "x", size: "big" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.violations).toEqual(["format"]);
  });
});

describe("recraft.image shape and controls", () => {
  test("n outside 1-6 is invalid_shape", () => {
    const r = image.safe({ prompt: "x", n: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("response_format is narrowed to url | b64_json | multipart", () => {
    const r = safeUnchecked({ prompt: "x", response_format: "hex" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["response_format"]);
      expect(r.errors[0]?.meta?.allowed).toEqual(["url", "b64_json", "multipart"]);
    }
    expect(image.safe({ prompt: "x", response_format: "b64_json" }).ok).toBe(true);
    // The Flash page recommends it; the endpoints doc: "Must be one of `url`, `b64_json` or `multipart`".
    expect(image.safe({ prompt: "x", model: "recraftv4_1_flash", response_format: "multipart" }).ok)
      .toBe(true);
  });

  test("controls.artistic_level and no_text are V3-only", () => {
    expect(
      image.safe({ prompt: "x", model: "recraftv3", controls: { artistic_level: 3 } }).ok,
    ).toBe(true);
    const r = image.safe({
      prompt: "x",
      model: "recraftv2",
      controls: { artistic_level: 3, no_text: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path.join("."))).toEqual([
        "controls.artistic_level",
        "controls.no_text",
      ]);
      expect(r.errors[0]?.code).toBe("unsupported_param");
    }
  });

  test("rgb triplets outside 0-255 and color weights summing past 1.0 are rejected", () => {
    const badRgb = image.safe({
      prompt: "x",
      controls: { colors: [{ rgb: [0, 300, 0] }] },
    });
    expect(badRgb.ok).toBe(false);

    const heavy = image.safe({
      prompt: "x",
      controls: { colors: [{ rgb: [0, 255, 0], weight: 0.7 }, { rgb: [255, 0, 0], weight: 0.6 }] },
    });
    expect(heavy.ok).toBe(false);
    if (!heavy.ok) {
      expect(heavy.errors[0]?.code).toBe("invalid_shape");
      expect(heavy.errors[0]?.message).toContain("must not exceed 1.0");
    }

    expect(
      image.safe({
        prompt: "x",
        controls: { colors: [{ rgb: [0, 255, 0], weight: 0.5 }], background_color: { rgb: [1, 2, 3] } },
      }).ok,
    ).toBe(true);
  });

  test("prompt over the per-model character cap is over_output_limit", () => {
    const long = "y".repeat(1001);
    const r = image.safe({ prompt: long, model: "recraftv3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(1000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(1001);
    }
    // The V4.1 line caps at 10,000, so the same prompt passes there.
    expect(image.safe({ prompt: long }).ok).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    let caught: unknown;
    try {
      image({ prompt: "x", n: 0 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("recraft.image cost estimation", () => {
  test("per-image pricing × n", () => {
    const r = image.safe({ prompt: "x", model: "recraftv3", n: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.08, 10);

    const vector = image.safe({ prompt: "x", model: "recraftv2_vector", n: 3 });
    expect(vector.ok).toBe(true);
    if (vector.ok) expect(vector.estimate.costUSD).toBeCloseTo(0.132, 10);
  });

  test("maxCostUSD is enforced", () => {
    const r = image.safe(
      { prompt: "x", model: "recraftv4_pro_vector", n: 6 }, // 6 × $0.30 = $1.80
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test('"1707x1024" is in ImageSize but no per-model table, so it passes anywhere', () => {
    expect(image.safe({ prompt: "x", model: "recraftv3", size: "1707x1024" }).ok).toBe(true);
    expect(image.safe({ prompt: "x", model: "recraftv4_1", size: "1707x1024" }).ok).toBe(true);
    // A size attributed to a different model group is still rejected.
    const wrong = safeUnchecked({ prompt: "x", model: "recraftv3", size: "2048x2048" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("spec-only params validate instead of warning as unknown", () => {
    const r = image.safe({
      prompt: "x",
      model: "recraftv3",
      substyle: "pixel_art",
      creativity: "eccentric",
      image_format: "webp",
      upscale: "upscale4mp",
      block_nsfw: true,
      calculate_features: false,
      expire: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_param");
  });

  test("spec-only enum params reject undocumented values", () => {
    for (const [param, value] of [
      ["substyle", "not_a_substyle"],
      ["creativity", "wild"],
      ["image_format", "jpeg"],
      ["upscale", "upscale64mp"],
    ] as const) {
      const r = safeUnchecked({ prompt: "x", model: "recraftv3", [param]: value });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.path).toEqual([param]);
      }
    }
  });

  test("catalog pricing sanity: every model has a per-image rate and a prompt cap", () => {
    for (const info of Object.values(models) as ModelInfo[]) {
      expect(info.cost?.perImage, info.id).toBeGreaterThan(0);
      expect(info.limit.characters, info.id).toBeGreaterThan(0);
      expect(info.limit.context).toBe(0);
    }
  });
});
