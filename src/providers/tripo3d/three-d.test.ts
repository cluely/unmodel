/**
 * `tripo3d.threeD` and `tripo3d.threeDFromImage` — the two v3 generation
 * routes, and the cross-field rules that make Tripo worth validating rather
 * than passing through.
 *
 * Four of those rules are stated in Tripo's own documentation and every one of
 * them produces a 4xx if broken: the version gate on seven parameters, the
 * `generate_parts` exclusion (whose trap is that two of the three fields it
 * forbids DEFAULT to true), the polycount ceiling that moves with three
 * switches, and the polymorphic `input` string that accepts three shapes and
 * refuses everything else.
 */

import { describe, expect, test } from "bun:test";
import { threeD } from "./three-d";
import { threeDFromImage } from "./three-d-from-image";
import type { ModelInfo } from "../../core/catalog-types";
import { models, provider } from "./models";
import { tripo3dCostUSD, tripo3dCredits } from "./pricing";
import {
  GATED_PARAMS_BY_MODEL,
  IMAGE_TO_MODEL_URL,
  TEXT_TO_MODEL_URL,
  TRIPO3D_MODELS,
  VERSION_GATED_PARAMS,
  taskUrl,
} from "./shared";

const PROMPT = "a brass astrolabe on a walnut stand";
const PHOTO = "https://example.com/chair.png";

describe("the wire", () => {
  test("each route posts to its own v3 path, and the body is the params", () => {
    const text = threeD({ model: "v3.1-20260211", prompt: PROMPT });
    expect(text.request.url).toBe("https://openapi.tripo3d.ai/v3/generation/text-to-model");
    expect(text.request.method).toBe("POST");
    expect(JSON.parse(JSON.stringify(text))).toEqual({ model: "v3.1-20260211", prompt: PROMPT });

    const image = threeDFromImage({ model: "v3.1-20260211", input: PHOTO });
    expect(image.request.url).toBe("https://openapi.tripo3d.ai/v3/generation/image-to-model");
    expect(JSON.parse(JSON.stringify(image))).toEqual({ model: "v3.1-20260211", input: PHOTO });
  });

  test("the URLs are the ones the constants publish, and the task URL interpolates", () => {
    expect(TEXT_TO_MODEL_URL).toBe("https://openapi.tripo3d.ai/v3/generation/text-to-model");
    expect(IMAGE_TO_MODEL_URL).toBe("https://openapi.tripo3d.ai/v3/generation/image-to-model");
    expect(taskUrl("task_abc123")).toBe("https://openapi.tripo3d.ai/v3/tasks/task_abc123");
  });

  test("`.toSdk(\"tripo3d\")` returns the body unchanged", () => {
    const params = threeD({ model: "v3.1-20260211", prompt: PROMPT });
    expect(params.toSdk("tripo3d")).toEqual({ model: "v3.1-20260211", prompt: PROMPT });
  });

  test("auth is prose, never a header unmodel writes", () => {
    const params = threeD({ model: "v3.1-20260211", prompt: PROMPT });
    const headers = Object.keys(params.request.headers ?? {}).map((k) => k.toLowerCase());
    expect(headers).not.toContain("authorization");
    expect(provider.env).toEqual(["TRIPO_API_KEY"]);
  });
});

describe("the version gate", () => {
  test("`geometry_quality` on v2.5 is refused, naming the models that take it", () => {
    const bad = threeD.safe({
      model: "v2.5-20250123",
      prompt: PROMPT,
      geometry_quality: "detailed",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "geometry_quality");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("v2.5-20250123");
    expect(issue?.message).toContain("v3.1-20260211");
  });

  test("v2.5 takes NONE of the seven, and each is refused separately", () => {
    for (const name of VERSION_GATED_PARAMS) {
      const value = name === "texture_quality" ? "detailed" : name === "compress" ? "geometry" : name === "geometry_quality" ? "detailed" : true;
      const bad = threeD.safe({ model: "v2.5-20250123", prompt: PROMPT, [name]: value } as never);
      expect(bad.ok, name).toBe(false);
    }
    expect(GATED_PARAMS_BY_MODEL["v2.5-20250123"]).toEqual([]);
  });

  test("P1 takes three of the seven and refuses the other four", () => {
    // The P endpoint pages declare texture_quality, auto_size and compress and
    // do NOT declare geometry_quality, quad, smart_low_poly or generate_parts,
    // even though the "model >= v3.0" sentence was copied onto them unchanged.
    // The per-route parameter list is what this follows.
    expect(GATED_PARAMS_BY_MODEL["P1-20260311"]).toEqual([
      "texture_quality",
      "auto_size",
      "compress",
    ]);
    expect(threeD.safe({ model: "P1-20260311", prompt: PROMPT, auto_size: true }).ok).toBe(true);
    expect(threeD.safe({ model: "P1-20260311", prompt: PROMPT, quad: true }).ok).toBe(false);
  });

  test("both H3 models take all seven", () => {
    for (const model of ["v3.1-20260211", "v3.0-20250812"] as const) {
      expect(GATED_PARAMS_BY_MODEL[model]).toEqual([...VERSION_GATED_PARAMS]);
      expect(
        threeD.safe({ model, prompt: PROMPT, geometry_quality: "detailed", quad: true }).ok,
      ).toBe(true);
    }
  });
});

describe("generate_parts and the defaults that trap it", () => {
  test("`generate_parts: true` alone is refused, because texture and pbr default to true", () => {
    const bad = threeD.safe({ model: "v3.1-20260211", prompt: PROMPT, generate_parts: true });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "generate_parts");
    expect(issue?.code).toBe("unsupported_capability");
    // The message names the defaults rather than only the fields the caller set
    // — otherwise it reads as a complaint about nothing.
    expect(issue?.message).toContain("defaults to true");
  });

  test("with all three explicitly false it is accepted", () => {
    const ok = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      generate_parts: true,
      texture: false,
      pbr: false,
      quad: false,
    });
    expect(ok.ok).toBe(true);
  });
});

describe("pbr forces texture", () => {
  test("`pbr: true` with `texture: false` warns rather than fails", () => {
    const result = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      pbr: true,
      texture: false,
    });
    // Tripo accepts the body and generates textures, so refusing it would
    // reject a request the API honours — but the caller asked for the cheaper
    // tier and is about to be billed for the dearer one.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((i) => i.path?.[0] === "texture")).toBe(true);
  });

  test("and the estimate bills the textured rate, matching what happens", () => {
    expect(
      tripo3dCredits({ task: "text_to_model", model: "v3.1-20260211", pbr: true, texture: false }),
    ).toBe(20);
  });
});

describe("the polycount ceiling", () => {
  test("moves with the model", () => {
    expect(threeD.safe({ model: "v3.1-20260211", prompt: PROMPT, face_limit: 1_400_000 }).ok).toBe(
      true,
    );
    expect(threeD.safe({ model: "v3.0-20250812", prompt: PROMPT, face_limit: 1_400_000 }).ok).toBe(
      false,
    );
    expect(threeD.safe({ model: "P1-20260311", prompt: PROMPT, face_limit: 3_000 }).ok).toBe(true);
    expect(threeD.safe({ model: "P1-20260311", prompt: PROMPT, face_limit: 30_000 }).ok).toBe(false);
  });

  test("Ultra mode raises it, and the message says which mode it is in", () => {
    const ok = threeD.safe({
      model: "v3.0-20250812",
      prompt: PROMPT,
      face_limit: 1_400_000,
      geometry_quality: "detailed",
    });
    expect(ok.ok).toBe(true);

    const bad = threeD.safe({ model: "v3.0-20250812", prompt: PROMPT, face_limit: 1_400_000 });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.message).toContain("1000000");
  });

  test("`smart_low_poly` replaces the range regardless of model version", () => {
    const bad = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      smart_low_poly: true,
      face_limit: 100_000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.message).toContain("regardless of model version");
    expect(
      threeD.safe({
        model: "v3.1-20260211",
        prompt: PROMPT,
        smart_low_poly: true,
        face_limit: 5_000,
      }).ok,
    ).toBe(true);
  });

  test("`quad` caps the H series at 150,000", () => {
    const bad = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      quad: true,
      face_limit: 400_000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.message).toContain("150000");
  });
});

describe("the polymorphic `input`", () => {
  test("accepts a token, a URL and a prior task id", () => {
    for (const input of ["file_abc123", PHOTO, "task_abc123"]) {
      expect(threeDFromImage.safe({ model: "v3.1-20260211", input }).ok, input).toBe(true);
    }
  });

  test("refuses anything that is none of the three, naming all three", () => {
    const bad = threeDFromImage.safe({ model: "v3.1-20260211", input: "./chair.png" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "input");
    expect(issue?.message).toContain("file_");
    expect(issue?.message).toContain("task_");
    expect(issue?.message).toContain("URL");
  });
});

describe("catalog and pricing", () => {
  test("the catalog is exactly the ids the endpoint pages publish", () => {
    expect(Object.keys(models).sort()).toEqual([...TRIPO3D_MODELS].sort());
    for (const id of TRIPO3D_MODELS) {
      expect(models[id]?.modalities.output, id).toEqual(["3d"]);
      expect(models[id]?.limit.context, id).toBe(0);
      // No `cost`: `ModelCost` has no per-generation field and a mesh is not an
      // image. The credit tables live in ./pricing.ts and estimate per request.
      // Read through `ModelInfo` because the literal rows do not declare the
      // key at all, which is the stronger statement.
      expect((models[id] as ModelInfo | undefined)?.cost, id).toBeUndefined();
    }
  });

  test("the estimate is EXACT, because the price is a function of the body", () => {
    // 20 credits base (text, textured) + 20 HD geometry + 5 quad = 45 → $0.45.
    expect(
      tripo3dCostUSD({
        task: "text_to_model",
        model: "v3.1-20260211",
        geometryQuality: "detailed",
        quad: true,
      }),
    ).toBeCloseTo(0.45, 8);
    // A bare mesh is the cheap tier, and both switches have to be off for it.
    expect(
      tripo3dCostUSD({ task: "text_to_model", model: "v3.1-20260211", texture: false, pbr: false }),
    ).toBeCloseTo(0.1, 8);
    // Image-to-3D costs 10 credits more than text at every tier.
    expect(tripo3dCostUSD({ task: "image_to_model", model: "v3.1-20260211" })).toBeCloseTo(0.3, 8);
  });

  test("the estimate reaches the request", () => {
    const result = threeD.safe({ model: "v3.1-20260211", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(0.2, 8);
  });

  test("P1 declines rather than borrowing the H numbers", () => {
    // Its credit table is rendered client-side on Tripo's pricing page and is
    // not in the served HTML. fal resells P1 at roughly twice the H rate, so a
    // borrowed number would be visibly wrong.
    expect(tripo3dCostUSD({ task: "text_to_model", model: "P1-20260311" })).toBeUndefined();
    const result = threeD.safe({ model: "P1-20260311", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("degradation", () => {
  test("a model id this snapshot has not seen still compiles, with a warning", () => {
    const result = threeD.safe({ model: "v4.0-20270101", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((i) => i.code === "unknown_model")).toBe(true);
    expect(result.params.request.url).toBe(TEXT_TO_MODEL_URL);
  });

  test("and the gated-parameter check stands down for it rather than guessing", () => {
    // `GATED_PARAMS_BY_MODEL` has no row, so the check returns rather than
    // refusing a parameter a future model may well take.
    expect(threeD.safe({ model: "v4.0-20270101", prompt: PROMPT, quad: true }).ok).toBe(true);
  });
});
