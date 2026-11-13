/**
 * `tripo3d.threeD` and `tripo3d.threeDFromImage` — the two v3 generation
 * routes, and the cross-field rules that make Tripo worth validating rather
 * than passing through.
 *
 * Five of those rules are stated in Tripo's own documentation and every one of
 * them produces a 4xx if broken: the version gate on seven parameters, the
 * `generate_parts` exclusion (whose trap is that both fields it forbids DEFAULT
 * to true), the texture version `texture_quality: "fast"` needs, the polycount
 * ceiling that moves with three switches, and the polymorphic `input` string
 * that accepts three shapes and refuses everything else.
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

  test("P2 takes P1's three plus `quad`, and refuses the other three", () => {
    // The P pages mark `quad` "P2-20260801 only." and declare neither
    // geometry_quality, smart_low_poly nor generate_parts.
    expect(GATED_PARAMS_BY_MODEL["P2-20260801"]).toEqual([
      "texture_quality",
      "auto_size",
      "quad",
      "compress",
    ]);
    expect(
      threeD.safe({ model: "P2-20260801", prompt: PROMPT, quad: true, texture_quality: "detailed" })
        .ok,
    ).toBe(true);
    for (const extra of [
      { geometry_quality: "detailed" },
      { smart_low_poly: true },
      { generate_parts: true, texture: false, pbr: false },
    ] as const) {
      const bad = threeD.safe({ model: "P2-20260801", prompt: PROMPT, ...extra });
      expect(bad.ok, Object.keys(extra)[0]).toBe(false);
      if (bad.ok) continue;
      const issue = bad.errors.find((i) => i.code === "unsupported_param");
      expect(issue?.message).toContain("P2-20260801");
    }
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

  test("an explicit `texture: true` is refused too, naming it without the default note", () => {
    const bad = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      generate_parts: true,
      texture: true,
      pbr: false,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "generate_parts");
    expect(issue?.meta?.conflicts).toEqual(["texture"]);
  });

  test("with texture and pbr explicitly false it is accepted, with no warning", () => {
    const ok = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      generate_parts: true,
      texture: false,
      pbr: false,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.warnings).toEqual([]);
  });

  test("`quad: true` is accepted and warned about: Tripo ignores it and returns triangle parts", () => {
    const result = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      generate_parts: true,
      texture: false,
      pbr: false,
      quad: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((i) => i.path?.[0] === "quad");
    expect(warning?.message).toContain("triangle");
  });

  test("`smart_low_poly: true` is accepted and warned about: it suppresses the parts", () => {
    const result = threeDFromImage.safe({
      model: "v3.0-20250812",
      input: PHOTO,
      generate_parts: true,
      texture: false,
      pbr: false,
      smart_low_poly: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((i) => i.path?.[0] === "generate_parts");
    expect(warning?.message).toContain("NOT produced");
  });
});

describe("texture_version, and the two parameters only v3.5 reads", () => {
  const V3_5 = "v3.5-20260815";

  test("`texture_quality: \"fast\"` is accepted with texture v3.5, and bills as standard", () => {
    const result = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      texture_quality: "fast",
      texture_version: V3_5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.estimate?.costUSD).toBeCloseTo(0.2, 8);
    expect(
      tripo3dCredits({ task: "image_to_model", model: "P2-20260801", textureQuality: "fast" }),
    ).toBe(110);
  });

  test("`fast` with `texture_version` omitted is refused, naming the derived default", () => {
    const bad = threeDFromImage.safe({ model: "P1-20260311", input: PHOTO, texture_quality: "fast" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "texture_quality");
    expect(issue?.code).toBe("unsupported_capability");
    expect(issue?.message).toContain("v3.0-20250812");
    expect(issue?.message).toContain(V3_5);
  });

  test("`fast` with another documented texture version is refused", () => {
    const bad = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      texture_quality: "fast",
      texture_version: "v3.0-20250812",
    });
    expect(bad.ok).toBe(false);
  });

  test("`fast` stands down for a texture version newer than the documented three", () => {
    const result = threeD.safe({
      model: "v3.1-20260211",
      prompt: PROMPT,
      texture_quality: "fast",
      texture_version: "v4.0-20270101",
    });
    expect(result.ok).toBe(true);
  });

  test("`delight` warns when the texture version ignores it, and is silent on v3.5", () => {
    const ignored = threeD.safe({ model: "v2.5-20250123", prompt: PROMPT, delight: false });
    expect(ignored.ok).toBe(true);
    if (!ignored.ok) return;
    const warning = ignored.warnings.find((i) => i.path?.[0] === "delight");
    expect(warning?.message).toContain("v2.5-20250123");

    const read = threeD.safe({
      model: "v2.5-20250123",
      prompt: PROMPT,
      delight: false,
      texture_version: V3_5,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings).toEqual([]);
  });

  test("all three sit outside the version gate: v2.5 and P1 take them", () => {
    for (const model of ["v2.5-20250123", "P1-20260311"] as const) {
      const result = threeDFromImage.safe({
        model,
        input: PHOTO,
        texture_version: V3_5,
        delight: true,
        export_orientation: "-y",
      });
      expect(result.ok, model).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings, model).toEqual([]);
    }
  });

  test("`export_orientation` takes the four documented axes and nothing else", () => {
    for (const export_orientation of ["+x", "-x", "+y", "-y"] as const) {
      expect(threeD.safe({ model: "v3.1-20260211", prompt: PROMPT, export_orientation }).ok).toBe(
        true,
      );
    }
    expect(
      threeD.safe({ model: "v3.1-20260211", prompt: PROMPT, export_orientation: "+z" as never }).ok,
    ).toBe(false);
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

  test("P2 runs 48–50,000 triangles", () => {
    for (const [face_limit, ok] of [[48, true], [50_000, true], [47, false], [50_001, false]] as const) {
      const result = threeD.safe({ model: "P2-20260801", prompt: PROMPT, face_limit });
      expect(result.ok, `${face_limit}`).toBe(ok);
    }
  });

  test("`quad` caps P2 at its own 25,000, not the H series' 150,000", () => {
    expect(
      threeD.safe({ model: "P2-20260801", prompt: PROMPT, quad: true, face_limit: 25_000 }).ok,
    ).toBe(true);
    const bad = threeDFromImage.safe({
      model: "P2-20260801",
      input: PHOTO,
      quad: true,
      face_limit: 30_000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "face_limit");
    expect(issue?.message).toContain("25000");
    expect(issue?.message).toContain("P2-20260801");
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
    // Task ids are bare UUIDs; this one is the endpoint page's own example.
    for (const input of ["file_abc123", PHOTO, "550e8400-e29b-41d4-a716-446655440000"]) {
      expect(threeDFromImage.safe({ model: "v3.1-20260211", input }).ok, input).toBe(true);
    }
  });

  test("refuses anything that is none of the three, naming all three", () => {
    const bad = threeDFromImage.safe({ model: "v3.1-20260211", input: "./chair.png" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "input");
    expect(issue?.message).toContain("file_");
    expect(issue?.message).toContain("task id");
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

  test("P2 is 100 credits bare and 110 textured on both routes, with P1's texture add-ons", () => {
    const p2 = { model: "P2-20260801" } as const;
    expect(tripo3dCredits({ ...p2, task: "text_to_model", texture: false, pbr: false })).toBe(100);
    expect(tripo3dCredits({ ...p2, task: "text_to_model" })).toBe(110);
    expect(tripo3dCredits({ ...p2, task: "image_to_model", texture: false, pbr: false })).toBe(100);
    expect(tripo3dCredits({ ...p2, task: "image_to_model" })).toBe(110);
    expect(tripo3dCredits({ ...p2, task: "text_to_model", textureQuality: "detailed" })).toBe(120);
    expect(tripo3dCredits({ ...p2, task: "image_to_model", textureQuality: "extreme" })).toBe(130);

    const result = threeDFromImage.safe({ ...p2, input: PHOTO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(1.1, 8);
  });

  test("P2 with `quad` declines: the P tab publishes no quad surcharge", () => {
    // The H series' "Quad Mesh +5" is rendered only off the P tab; borrowing it
    // for P2's headline feature would be a guess.
    expect(tripo3dCostUSD({ task: "text_to_model", model: "P2-20260801", quad: true })).toBeUndefined();
    const result = threeD.safe({ model: "P2-20260801", prompt: PROMPT, quad: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });

  test("P1 is 30/40 credits text and 40/50 image, with the same texture add-ons", () => {
    // The P-Series tab's figures, read from the pricing page's JS chunk.
    const p1 = { model: "P1-20260311" } as const;
    expect(tripo3dCredits({ ...p1, task: "text_to_model", texture: false, pbr: false })).toBe(30);
    expect(tripo3dCredits({ ...p1, task: "text_to_model" })).toBe(40);
    expect(tripo3dCredits({ ...p1, task: "image_to_model", texture: false, pbr: false })).toBe(40);
    expect(tripo3dCredits({ ...p1, task: "image_to_model" })).toBe(50);
    expect(tripo3dCredits({ ...p1, task: "text_to_model", textureQuality: "extreme" })).toBe(60);

    const result = threeD.safe({ ...p1, prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(0.4, 8);
  });

  test("P1 declines an add-on its table does not publish", () => {
    // `quad` on P1 is a 400 and has no P-Series rate; the estimate does not
    // borrow the H series' +5.
    expect(tripo3dCostUSD({ task: "text_to_model", model: "P1-20260311", quad: true })).toBeUndefined();
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
