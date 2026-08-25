/**
 * `topaz.upscale` and `topaz.upscaleGenerative` — two routes, fifteen models,
 * and the per-model settings table that Topaz's own OpenAPI document does not
 * contain.
 *
 * That table is the whole argument for hand-writing this provider. Every
 * request schema in the published spec ends `additionalProperties: { type:
 * string }`, so the machine-readable half knows the envelope and nothing about
 * the dials that decide what the output looks like — and Topaz IGNORES a dial a
 * model does not read rather than refusing it. A wrong setting is therefore a
 * silent no-op at the API, billed identically, and this file is where it stops
 * being silent.
 *
 * Four other rules are checked here for the same reason: nothing is `required`
 * in the schema and a request still needs exactly one of three source fields;
 * two strength dials become mandatory when a switch is on; the output-megapixel
 * ceiling differs eight-fold across the roster; and the framing is multipart on
 * every path, including one whose only input is a URL.
 */

import { describe, expect, test } from "bun:test";
import { upscale } from "./upscale";
import { upscaleGenerative } from "./upscale-generative";
import { models, provider } from "./models";
import { CREDIT_USD, MP_PER_CREDIT, topazCostUSD, topazCredits } from "./pricing";
import {
  ENHANCE_GEN_URL,
  ENHANCE_URL,
  TOPAZ_ENHANCE_GEN_MODELS,
  TOPAZ_ENHANCE_MODELS,
  TOPAZ_MODELS,
  TOPAZ_SETTINGS_BY_MODEL,
  cancelUrl,
  downloadUrl,
  statusUrl,
  toFormData,
} from "./shared";

const PHOTO = "https://example.com/portrait.jpg";

describe("the wire", () => {
  test("each route posts to its own path, and the body is the params", () => {
    const classic = upscale({ source_url: PHOTO, model: "Standard V2" });
    expect(classic.request.url).toBe("https://api.topazlabs.com/image/v1/enhance/async");
    expect(classic.request.method).toBe("POST");
    expect(JSON.parse(JSON.stringify(classic))).toEqual({
      source_url: PHOTO,
      model: "Standard V2",
    });

    const generative = upscaleGenerative({ source_url: PHOTO, model: "Redefine" });
    expect(generative.request.url).toBe("https://api.topazlabs.com/image/v1/enhance-gen/async");
  });

  test("the framing is FORM on both routes, and the headers are empty", () => {
    for (const params of [
      upscale({ source_url: PHOTO }),
      upscaleGenerative({ source_url: PHOTO }),
    ]) {
      // Neither path declares a JSON arm, so even a URL-only request is a form.
      // The headers are empty because `fetch` derives the multipart boundary.
      expect(params.request.body).toBe("form");
      expect(params.request.headers).toEqual({});
    }
  });

  test("the URL helpers are the ones the module publishes", () => {
    expect(ENHANCE_URL).toBe("https://api.topazlabs.com/image/v1/enhance/async");
    expect(ENHANCE_GEN_URL).toBe("https://api.topazlabs.com/image/v1/enhance-gen/async");
    expect(statusUrl("abc")).toBe("https://api.topazlabs.com/image/v1/status/abc");
    expect(downloadUrl("abc")).toBe("https://api.topazlabs.com/image/v1/download/abc");
    expect(cancelUrl("abc")).toBe("https://api.topazlabs.com/image/v1/cancel/abc");
  });

  test("`toFormData` stringifies everything, because the wire is strings", () => {
    const params = upscaleGenerative({
      source_url: PHOTO,
      model: "Redefine",
      creativity: 4,
      detail: true,
      detailStrength: 6,
      output_width: 4096,
    });
    const form = toFormData(params);
    expect(form.get("model")).toBe("Redefine");
    expect(form.get("source_url")).toBe(PHOTO);
    // The spec types the settings space as `additionalProperties: { type:
    // string }`, so a number crosses as a string and a boolean as "true".
    expect(form.get("creativity")).toBe("4");
    expect(form.get("detail")).toBe("true");
    expect(form.get("detailStrength")).toBe("6");
    expect(form.get("output_width")).toBe("4096");
  });

  test("a Blob becomes a file part rather than a stringified object", () => {
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const form = toFormData(upscale({ image, model: "Standard V2" }));
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  test('`.toSdk("topaz")` returns the body unchanged', () => {
    const params = upscale({ source_url: PHOTO, model: "CGI" });
    expect(params.toSdk("topaz")).toEqual({ source_url: PHOTO, model: "CGI" });
  });

  test("auth is prose, never a header unmodel writes", () => {
    const params = upscale({ source_url: PHOTO });
    expect(Object.keys(params.request.headers)).toEqual([]);
    expect(provider.env).toEqual(["TOPAZ_API_KEY"]);
  });
});

describe("the source, which nothing in the schema requires", () => {
  test("a request naming no picture is refused, listing all three ways", () => {
    const result = upscale.safe({ model: "Standard V2" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("invalid_shape");
    expect(result.errors[0]?.message).toContain("source_url");
    expect(result.errors[0]?.message).toContain("source_id");
  });

  test("a request naming two is refused as ambiguous rather than redundant", () => {
    const result = upscale.safe({ source_url: PHOTO, source_id: "abc", model: "Standard V2" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("exactly one");
  });

  test("each of the three on its own is accepted", () => {
    expect(upscale.safe({ source_url: PHOTO }).ok).toBe(true);
    expect(upscale.safe({ source_id: "src_abc" }).ok).toBe(true);
    expect(upscale.safe({ image: new Blob([new Uint8Array([1])]) }).ok).toBe(true);
  });
});

describe("the conditional strengths", () => {
  test("`faceEnhancement: true` makes two optional dials mandatory", () => {
    const result = upscale.safe({ source_url: PHOTO, faceEnhancement: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((issue) => issue.path.join("."));
    expect(paths).toContain("faceEnhancementStrength");
    expect(paths).toContain("faceEnhancementCreativity");
  });

  test("…and supplying both satisfies it", () => {
    const result = upscale.safe({
      source_url: PHOTO,
      faceEnhancement: true,
      faceEnhancementStrength: 0.6,
      faceEnhancementCreativity: 0.2,
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  test("`detail: true` requires `detailStrength` on the generative route", () => {
    const result = upscaleGenerative.safe({ source_url: PHOTO, model: "Redefine", detail: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path.join("."))).toContain("detailStrength");
  });
});

describe("the per-model settings table", () => {
  test("a dial the model does not read is a WARNING, because Topaz ignores it", () => {
    const result = upscale.safe({
      source_url: PHOTO,
      model: "Standard V2",
      // `deblurStrength` belongs to `CGI` and `Text Refine`.
      deblurStrength: 0.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issue = result.warnings.find((error) => error.path.join(".") === "deblurStrength");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("IGNORES a setting a model does not take");
    // …and it names the models that DO read it, so the fix is a model change.
    expect(issue?.message).toContain('"CGI"');
  });

  test("…and the same dial at a model that reads it is silent", () => {
    const result = upscale.safe({ source_url: PHOTO, model: "CGI", deblurStrength: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  test("the table covers every rostered model, and no other", () => {
    expect(Object.keys(TOPAZ_SETTINGS_BY_MODEL).sort()).toEqual([...TOPAZ_MODELS].sort());
  });

  test("the two routes' dials are disjoint where the docs say they are", () => {
    // `strength` and `fixCompression` are classic-only; `creativity`, `texture`,
    // `detail` and `autoprompt` are generative-only. A model on one route
    // reading the other's dial would be a transcription slip.
    for (const model of TOPAZ_ENHANCE_MODELS) {
      const dials = TOPAZ_SETTINGS_BY_MODEL[model] ?? [];
      expect(dials, model).toContain("strength");
      expect(dials, model).not.toContain("creativity");
    }
    for (const model of TOPAZ_ENHANCE_GEN_MODELS) {
      const dials = TOPAZ_SETTINGS_BY_MODEL[model] ?? [];
      expect(dials, model).toContain("creativity");
      expect(dials, model).not.toContain("strength");
    }
  });

  test("`prompt` is on the generative route only, which is the canonical word", () => {
    for (const model of TOPAZ_ENHANCE_MODELS) {
      expect(TOPAZ_SETTINGS_BY_MODEL[model], model).not.toContain("prompt");
    }
    for (const model of TOPAZ_ENHANCE_GEN_MODELS) {
      expect(TOPAZ_SETTINGS_BY_MODEL[model], model).toContain("prompt");
    }
  });
});

describe("the output ceiling, which moves with the model", () => {
  test("`Wonder` caps at 128 MP and says so with the number", () => {
    const result = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Wonder",
      output_width: 16000,
      output_height: 16000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "output_width");
    expect(issue?.code).toBe("media_dimensions_exceeded");
    expect(issue?.message).toContain("128 MP");
  });

  test("the same size at a classic model is fine — the ceilings differ eight-fold", () => {
    const result = upscale.safe({
      source_url: PHOTO,
      model: "Standard V2",
      output_width: 16000,
      output_height: 16000,
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  test("the envelope's own 1–32000 bound still applies", () => {
    expect(upscale.safe({ source_url: PHOTO, output_width: 40_000 }).ok).toBe(false);
    expect(upscale.safe({ source_url: PHOTO, output_width: 0 }).ok).toBe(false);
  });
});

describe("the credit arithmetic", () => {
  /**
   * The published per-model credit tables, entry for entry.
   *
   * `credits = ceil(outputMP / mpPerCredit)` is the one formula on the pricing
   * page, and this is the proof it reproduces what Topaz actually charges: the
   * columns are the `Output MP` row on each model's own page, and the values
   * are its `Credits` row.
   */
  const MP = [1, 4, 8, 16, 24, 32, 40, 50, 64, 100];

  test("`Standard V2` reproduces its published table exactly", () => {
    const published = [1, 1, 1, 1, 1, 2, 2, 3, 3, 5];
    expect(MP.map((mp) => topazCredits({ model: "Standard V2", outputWidth: mp * 1000, outputHeight: 1000 })))
      .toEqual(published);
  });

  test("`Redefine` and `Recover 3` reproduce theirs", () => {
    const published = [1, 1, 2, 4, 6, 8, 10, 13, 16, 25];
    for (const model of ["Redefine", "Recover 3"]) {
      expect(
        MP.map((mp) => topazCredits({ model, outputWidth: mp * 1000, outputHeight: 1000 })),
        model,
      ).toEqual(published);
    }
  });

  test("`Bloom 2` reproduces its published table, which is twelve times the first", () => {
    const published = [1, 2, 4, 8, 12, 16, 20, 25, 32, 50];
    expect(MP.map((mp) => topazCredits({ model: "Bloom 2", outputWidth: mp * 1000, outputHeight: 1000 })))
      .toEqual(published);
  });

  test("the three family rates are the ones the pricing page publishes", () => {
    expect(MP_PER_CREDIT).toEqual({ gigapixel: 24, wonder: 4, bloom: 2 });
    expect(CREDIT_USD).toBe(0.12);
  });

  test("USD is credits times the pay-as-you-go rate", () => {
    expect(topazCostUSD({ model: "Standard V2", outputWidth: 4096, outputHeight: 4096 })).toBeCloseTo(
      0.12,
      10,
    );
    expect(topazCostUSD({ model: "Redefine", outputWidth: 4096, outputHeight: 4096 })).toBeCloseTo(
      0.6,
      10,
    );
  });

  test("a request that did not state a size declines rather than guessing", () => {
    // Topaz bills on the OUTPUT's pixel count. Naming neither dimension lets it
    // choose from the input's, which is behind a URL; naming ONE scales the
    // other from a ratio the body does not carry.
    expect(topazCredits({ model: "Standard V2" })).toBeUndefined();
    expect(topazCredits({ model: "Standard V2", outputWidth: 4096 })).toBeUndefined();
    expect(topazCredits({ model: "Not A Model", outputWidth: 100, outputHeight: 100 })).toBeUndefined();
  });

  test("the estimate rides on the validated request, exactly", () => {
    const result = upscale.safe({
      source_url: PHOTO,
      model: "Standard V2",
      output_width: 4096,
      output_height: 4096,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(0.12, 10);
    // …and the budget gate reads the same number, which is what makes an exact
    // estimate worth having: `maxCostUSD` here is a real ceiling rather than a
    // guess about a guess.
    const refused = upscale.safe(
      { source_url: PHOTO, model: "Bloom 2", output_width: 8000, output_height: 8000 },
      { maxCostUSD: 1 },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors.some((issue) => issue.code === "over_budget")).toBe(true);
  });
});

describe("the catalog", () => {
  test("every rostered id has a row, and the roster is fifteen across two routes", () => {
    expect([...(TOPAZ_MODELS as readonly string[])].sort()).toEqual(Object.keys(models).sort());
    expect(TOPAZ_ENHANCE_MODELS).toHaveLength(6);
    expect(TOPAZ_ENHANCE_GEN_MODELS).toHaveLength(9);
    // The two enums are disjoint, which is what lets the unified adapter pick
    // the route from the ref rather than from a parameter.
    const gen = new Set<string>(TOPAZ_ENHANCE_GEN_MODELS);
    expect(TOPAZ_ENHANCE_MODELS.filter((id) => gen.has(id))).toEqual([]);
  });

  test("`Recovery V2` is in the published spec and NOT in the roster", () => {
    // It appears in the OpenAPI enum, on no model page, with no credit table —
    // and reads like the earlier name of what is now `Recover 3`. unmodel does
    // not type a string nobody can look up.
    expect(Object.keys(models)).not.toContain("Recovery V2");
    expect(Object.keys(models)).toContain("Recover 3");
  });

  test("no row carries a `cost`, because per-output-megapixel is not a ModelCost field", () => {
    // `ModelCost` has `perImage`, `perVideoSecond`, `perMillionCharacters` and
    // `perAudioMinute`, and Topaz bills on none of them — `perImage` would be
    // wrong by a factor of five across the sizes one model serves. The credit
    // tables live in ./pricing.ts and each request estimates exactly.
    for (const [id, row] of Object.entries(models)) {
      expect(Object.hasOwn(row, "cost"), id).toBe(false);
    }
  });

  test("only the generative models declare a text input, which is `prompt`", () => {
    const gen = new Set<string>(TOPAZ_ENHANCE_GEN_MODELS);
    for (const [id, row] of Object.entries(models)) {
      expect((row.modalities.input as readonly string[]).includes("text"), id).toBe(gen.has(id));
      expect(row.modalities.output, id).toEqual(["image"]);
      expect(row.limit.context, id).toBe(0);
    }
  });
});
