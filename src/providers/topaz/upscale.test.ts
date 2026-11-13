/**
 * `topaz.upscale` and `topaz.upscaleGenerative` — two routes, eighteen models,
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
 * Three other rules are checked here for the same reason: nothing is
 * `required` in the schema and a request still needs exactly one of three
 * source fields; the output-megapixel ceiling differs four-fold across the
 * roster; and the framing is multipart on every path, including one whose only
 * input is a URL.
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

/** Codes other than the ones a test is about — the deprecated rows warn by design. */
function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code).filter((code) => code !== "deprecated_model");
}

describe("the switches, which no page makes conditional", () => {
  test("`faceEnhancement: true` alone is accepted — Wonder 2's own sample sends it", () => {
    // “-F "faceEnhancement=true"” and “`faceEnhancementStrength` | `decimal` |
    // <p>Optional<br>Default: <code>0.8</code></p>” on its page.
    const result = upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 2", faceEnhancement: true });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (result.ok) expect(codes(result.warnings)).toEqual([]);
    expect(upscale.safe({ source_url: PHOTO, faceEnhancement: true }).ok).toBe(true);
  });

  test("`detail: true` alone is accepted too", () => {
    expect(upscaleGenerative.safe({ source_url: PHOTO, model: "Redefine", detail: true }).ok).toBe(true);
  });

  test("…and each strength's own bound still refuses", () => {
    const result = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Wonder 2",
      faceEnhancement: true,
      faceEnhancementStrength: 1.5,
    });
    expect(result.ok).toBe(false);
  });
});

describe("the dials the 2026-11-12 pages document on rostered models", () => {
  test("`Recover 3` takes `enhancementStrength` as a 0–10 decimal", () => {
    // “-F "enhancementStrength=5"” — Recover 3's own sample.
    const result = upscaleGenerative.safe({ source_url: PHOTO, model: "Recover 3", enhancementStrength: 5 });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
    expect(
      upscaleGenerative.safe({ source_url: PHOTO, model: "Recover 3", enhancementStrength: 10.5 }).ok,
    ).toBe(false);
  });

  test("…while Wonder 3 and 3.5 keep their three words", () => {
    expect(
      upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 3.5", enhancementStrength: "medium" }).ok,
    ).toBe(true);
    expect(upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 3.5", enhancementStrength: 5 }).ok).toBe(
      false,
    );
  });

  test("`Wonder 2` takes `colorCorrection` and `preDownscale` (1–4)", () => {
    const result = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Wonder 2",
      colorCorrection: false,
      preDownscale: 2,
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (result.ok) expect(codes(result.warnings)).toEqual([]);
    expect(upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 2", preDownscale: 5 }).ok).toBe(false);
  });

  test("`Redefine` takes `creativityBoost`, `detailLevel` (1–5) and `seed`", () => {
    const result = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Redefine",
      creativityBoost: false,
      detailLevel: 3,
      seed: 42,
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
    expect(upscaleGenerative.safe({ source_url: PHOTO, model: "Redefine", detailLevel: 6 }).ok).toBe(false);
  });

  test("the classic strength dials and `opacity` are silent where their pages list them", () => {
    const dials = { deblurStrength: 0.5, decompressionStrength: 0.7, denoiseStrength: 0.5, opacity: 0.9 };
    for (const model of ["High Fidelity V2", "Low Resolution V2"]) {
      const result = upscale.safe({ source_url: PHOTO, model, ...dials });
      expect(result.ok, model).toBe(true);
      if (result.ok) expect(codes(result.warnings), model).toEqual([]);
    }
    const cgi = upscale.safe({ source_url: PHOTO, model: "CGI", denoiseStrength: 0.5, opacity: 0.9 });
    expect(cgi.ok).toBe(true);
    if (cgi.ok) expect(cgi.warnings).toEqual([]);
    // CGI's page has no `decompressionStrength`, so that one still warns.
    const off = upscale.safe({ source_url: PHOTO, model: "CGI", decompressionStrength: 0.5 });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.warnings.map((issue) => issue.path.join("."))).toEqual(["decompressionStrength"]);
  });

  test("`Standard V2` takes its page's snake_case spelling and the camelCase one", () => {
    // “-F "denoise_strength=0.5"” — its own sample.
    const snake = upscale.safe({
      source_url: PHOTO,
      model: "Standard V2",
      denoise_strength: 0.5,
      deblur_strength: 0.5,
      decompression_strength: 0.5,
      opacity: 1,
    });
    expect(snake.ok, JSON.stringify(snake.ok ? [] : snake.errors)).toBe(true);
    if (snake.ok) expect(snake.warnings).toEqual([]);
    const camel = upscale.safe({ source_url: PHOTO, model: "Standard V2", denoiseStrength: 0.5 });
    expect(camel.ok).toBe(true);
    if (camel.ok) expect(camel.warnings).toEqual([]);
    // …and the snake spelling warns anywhere else, naming Standard V2.
    const elsewhere = upscale.safe({ source_url: PHOTO, model: "CGI", denoise_strength: 0.5 });
    expect(elsewhere.ok).toBe(true);
    if (!elsewhere.ok) return;
    expect(elsewhere.warnings[0]?.message).toContain('"Standard V2"');
    expect(upscale.safe({ source_url: PHOTO, model: "Standard V2", denoise_strength: 1.5 }).ok).toBe(false);
  });
});

describe("lifecycle", () => {
  test("the four ids Topaz lists as Deprecated warn, and still validate", () => {
    const deprecated = Object.entries(models)
      .filter(([, row]) => (row as { status?: string }).status === "deprecated")
      .map(([id]) => id)
      .sort();
    expect(deprecated).toEqual(["High Fidelity V2", "Wonder", "Wonder 2", "Wonder 3"]);
    const result = upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 3" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((issue) => issue.code)).toEqual(["deprecated_model"]);
    const active = upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 3.5" });
    expect(active.ok).toBe(true);
    if (active.ok) expect(active.warnings).toEqual([]);
  });
});

describe("the per-model settings table", () => {
  test("a dial the model does not read is a WARNING, because Topaz ignores it", () => {
    const result = upscale.safe({
      source_url: PHOTO,
      model: "Standard V2",
      // `recoveryStrength` belongs to `Upscale High Fidelity V3`.
      recoveryStrength: 0.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issue = result.warnings.find((error) => error.path.join(".") === "recoveryStrength");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("IGNORES a setting a model does not take");
    // …and it names the models that DO read it, so the fix is a model change.
    expect(issue?.message).toContain('"Upscale High Fidelity V3"');
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
      expect(dials, model).not.toContain("strength");
    }
  });

  test("`prompt` is never a classic dial, and `Wonder 4` and `Detail` lack it too", () => {
    for (const model of TOPAZ_ENHANCE_MODELS) {
      expect(TOPAZ_SETTINGS_BY_MODEL[model], model).not.toContain("prompt");
    }
    const prompted = TOPAZ_ENHANCE_GEN_MODELS.filter((model) =>
      TOPAZ_SETTINGS_BY_MODEL[model]?.includes("prompt"),
    );
    expect(TOPAZ_ENHANCE_GEN_MODELS.filter((model) => !prompted.includes(model))).toEqual([
      "Wonder 4",
      "Detail",
    ]);
  });
});

/**
 * Three generative-route ids whose rows are their pages' parameter tables and
 * nothing else — each validated, priced against its own published credit
 * table, and gated on its own settings row.
 */
describe("`Wonder 4`, `Detail` and `Bloom`", () => {
  const TABLE_MP = [1, 4, 8, 16, 24, 32, 40];
  function credits(model: string): (number | undefined)[] {
    return TABLE_MP.map((mp) => topazCredits({ model, outputWidth: mp * 1000, outputHeight: 1000 }));
  }

  test("each validates on the generative route with no warnings", () => {
    for (const model of ["Wonder 4", "Detail", "Bloom"]) {
      const result = upscaleGenerative.safe({ source_url: PHOTO, model });
      expect(result.ok, model).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings, model).toEqual([]);
      expect(result.params.request.url, model).toBe(ENHANCE_GEN_URL);
    }
  });

  test("each reproduces the credit table on its own page", () => {
    // “| Output MP | 1 | 4 | 8 | 16 | 24 | 32 | 40 |” on all three pages.
    expect(credits("Wonder 4")).toEqual([1, 1, 1, 2, 3, 4, 5]);
    expect(credits("Detail")).toEqual([1, 1, 1, 1, 1, 2, 2]);
    expect(credits("Bloom")).toEqual([1, 2, 4, 8, 12, 16, 20]);
    expect(MP_PER_CREDIT["Wonder 4"]).toBe(8);
    expect(MP_PER_CREDIT.Detail).toBe(24);
    expect(MP_PER_CREDIT.Bloom).toBe(2);
  });

  test("…and the estimate rides on the validated request", () => {
    const result = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Wonder 4",
      output_width: 4096,
      output_height: 4096,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 16.8 MP at 8 MP per credit is three credits.
    expect(result.estimate?.costUSD).toBeCloseTo(3 * CREDIT_USD, 10);
  });

  test("`Wonder 4` reads no setting, so any dial warns", () => {
    const result = upscaleGenerative.safe({ source_url: PHOTO, model: "Wonder 4", creativity: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issue = result.warnings.find((warning) => warning.path.join(".") === "creativity");
    expect(issue?.code).toBe("unknown_param");
    expect(issue?.message).toContain('"Redefine"');
  });

  test("`Detail` reads `detailStrength` alone, 0–10, with no `detail` switch", () => {
    const silent = upscaleGenerative.safe({ source_url: PHOTO, model: "Detail", detailStrength: 5 });
    expect(silent.ok).toBe(true);
    if (silent.ok) expect(silent.warnings).toEqual([]);
    const warned = upscaleGenerative.safe({ source_url: PHOTO, model: "Detail", detail: true, detailStrength: 5 });
    expect(warned.ok).toBe(true);
    if (warned.ok) expect(warned.warnings.map((issue) => issue.path.join("."))).toEqual(["detail"]);
    expect(upscaleGenerative.safe({ source_url: PHOTO, model: "Detail", detailStrength: 11 }).ok).toBe(false);
  });

  test("`Bloom` reads `creativityBoost` and `facePreservation`, which `Bloom 2` does not", () => {
    const bloom = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Bloom",
      prompt: "ornate fantasy castle, detailed stonework",
      creativity: 5,
      creativityBoost: true,
      facePreservation: false,
      colorPreservation: true,
      seed: 7,
    });
    expect(bloom.ok, JSON.stringify(bloom.ok ? [] : bloom.errors)).toBe(true);
    if (bloom.ok) expect(bloom.warnings).toEqual([]);
    const bloom2 = upscaleGenerative.safe({ source_url: PHOTO, model: "Bloom 2", facePreservation: false });
    expect(bloom2.ok).toBe(true);
    if (!bloom2.ok) return;
    const issue = bloom2.warnings.find((warning) => warning.path.join(".") === "facePreservation");
    expect(issue?.code).toBe("unknown_param");
    expect(issue?.message).toContain('"Bloom"');
  });

  test("`Wonder 4` and `Bloom` cap their output at 256 MP; `Detail` states no ceiling", () => {
    for (const model of ["Wonder 4", "Bloom"]) {
      const at = upscaleGenerative.safe({ source_url: PHOTO, model, output_width: 16000, output_height: 16000 });
      expect(at.ok, model).toBe(true);
      const over = upscaleGenerative.safe({ source_url: PHOTO, model, output_width: 17000, output_height: 16000 });
      expect(over.ok, model).toBe(false);
      if (over.ok) continue;
      expect(over.errors[0]?.code, model).toBe("media_dimensions_exceeded");
      expect(over.errors[0]?.message, model).toContain("256 MP");
    }
    const detail = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Detail",
      output_width: 20000,
      output_height: 20000,
    });
    expect(detail.ok).toBe(true);
  });
});

describe("the output ceiling, which moves with the model", () => {
  test("`Wonder` caps at 256 MP and says so with the number", () => {
    // “This model accepts up to 256 MP input and output.” — Wonder 1's page.
    const at = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Wonder",
      output_width: 16000,
      output_height: 16000,
    });
    expect(at.ok, JSON.stringify(at.ok ? [] : at.errors)).toBe(true);
    const result = upscaleGenerative.safe({
      source_url: PHOTO,
      model: "Wonder",
      output_width: 17000,
      output_height: 16000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "output_width");
    expect(issue?.code).toBe("media_dimensions_exceeded");
    expect(issue?.message).toContain("256 MP");
  });

  test("the same size at a classic model is fine — the ceilings differ four-fold", () => {
    const result = upscale.safe({
      source_url: PHOTO,
      model: "Standard V2",
      output_width: 17000,
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

  test("`Wonder 3` and `Wonder 3.5` reproduce theirs, at 8 MP per credit", () => {
    // “| Credits   | 1 | 1 | 1 | 2  | 3  | 4  | 5  |” on both pages, for 1–40 MP.
    const published = [1, 1, 1, 2, 3, 4, 5];
    for (const model of ["Wonder 3", "Wonder 3.5"]) {
      expect(
        MP.slice(0, 7).map((mp) => topazCredits({ model, outputWidth: mp * 1000, outputHeight: 1000 })),
        model,
      ).toEqual(published);
      expect(MP_PER_CREDIT[model as "Wonder 3"], model).toBe(8);
    }
  });

  test("`Bloom 2` reproduces its published table, which is twelve times the first", () => {
    const published = [1, 2, 4, 8, 12, 16, 20, 25, 32, 50];
    expect(MP.map((mp) => topazCredits({ model: "Bloom 2", outputWidth: mp * 1000, outputHeight: 1000 })))
      .toEqual(published);
  });

  test("every rostered model has a rate, and no other id does", () => {
    expect(Object.keys(MP_PER_CREDIT).sort()).toEqual([...TOPAZ_MODELS].sort());
    for (const model of TOPAZ_ENHANCE_MODELS) expect(MP_PER_CREDIT[model], model).toBe(24);
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
  test("every rostered id has a row, and the roster is eighteen across two routes", () => {
    expect([...(TOPAZ_MODELS as readonly string[])].sort()).toEqual(Object.keys(models).sort());
    expect(TOPAZ_ENHANCE_MODELS).toHaveLength(6);
    expect(TOPAZ_ENHANCE_GEN_MODELS).toHaveLength(12);
    // The two enums are disjoint, which is what lets the unified adapter pick
    // the route from the ref rather than from a parameter.
    const gen = new Set<string>(TOPAZ_ENHANCE_GEN_MODELS);
    expect(TOPAZ_ENHANCE_MODELS.filter((id) => gen.has(id))).toEqual([]);
  });

  test("the ids deprecated when first read are NOT in the roster", () => {
    // `Recovery V2` is Recover 2 — its own page says “**Recover 2 is
    // deprecated** and will be retired no sooner than January 1, 2027. Use
    // Recover 3 instead.” — and the first generation is listed “Deprecated” on
    // Topaz's Model Deprecations page.
    for (const id of ["Recovery V2", "Standard", "Low Resolution", "High Fidelity", "Recover"]) {
      expect(Object.keys(models), id).not.toContain(id);
    }
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

  test("a row declares a text input exactly where its settings list `prompt`", () => {
    for (const [id, row] of Object.entries(models)) {
      expect((row.modalities.input as readonly string[]).includes("text"), id).toBe(
        TOPAZ_SETTINGS_BY_MODEL[id]?.includes("prompt") === true,
      );
      expect(row.modalities.output, id).toEqual(["image"]);
      expect(row.limit.context, id).toBe(0);
    }
  });
});
