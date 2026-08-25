/**
 * `unmodel/3d`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back — each provider's own `Validated`, its `.request`, its
 * `.toSdk`, its estimate — plus the two things this category has that its
 * siblings do not: two content words that are ALTERNATIVES rather than
 * companions, and two providers serving the same four models by different
 * routes.
 */
import { describe, expect, test } from "bun:test";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { threeD as falThreeD } from "../../src/providers/fal";
import { threeD as tripoText, threeDFromImage as tripoImage } from "../../src/providers/tripo3d";
import { createThreeD, threeD } from "../../src/unified/3d";
import { threeD as falAdapter } from "../../src/providers/fal/unified-3d";
import { threeD as tripoAdapter } from "../../src/providers/tripo3d/unified";

const PHOTO = { url: "https://example.com/chair.png" } as const;
const PROMPT = "a brass astrolabe on a walnut stand";

describe("the pack", () => {
  test("registers exactly the two 3D providers", () => {
    expect([...threeD.providers]).toEqual(["fal", "tripo3d"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => threeD({ model: "meshy/meshy-5", prompt: PROMPT } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = threeD.safe({ model: "meshy/meshy-5", prompt: PROMPT } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.meta?.["structural"]).toBe(true);
    expect(result.errors[0]?.message).toContain("not a 3d provider in this build");
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = threeD.safe({
      model: "fal/fal-ai/trellis-3",
      image: PHOTO,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    // …and it still ROUTES, which is the half that matters: fal adds endpoints
    // weekly and a curated roster is a snapshot.
    const params = result.params as unknown as { request: { url: string } };
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/trellis-3");
    // With no row to read, the adapter sends the commonest spelling.
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({ image_url: PHOTO.url });
  });

  test("the two adapters are the pack, and each can be built alone", () => {
    expect(falAdapter.models).toHaveLength(19);
    expect(tripoAdapter.models).toHaveLength(4);
    expect([...createThreeD([falAdapter]).providers]).toEqual(["fal"]);
    expect([...createThreeD([tripoAdapter]).providers]).toEqual(["tripo3d"]);
  });
});

describe("the result is the provider's own Validated", () => {
  test("fal: the enumerable body IS the fetch payload, and the route is not in it", () => {
    const result = threeD({
      model: "fal/fal-ai/hunyuan3d/v2",
      image: PHOTO,
      seed: 7,
      textured_mesh: true,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      input_image_url: PHOTO.url,
      seed: 7,
      textured_mesh: true,
    });
    expect(result.request.url).toBe("https://queue.fal.run/fal-ai/hunyuan3d/v2");
    expect(result.request.method).toBe("POST");
    expect(result.request.headers).toEqual({ "content-type": "application/json" });
    expect(result.toSdk("fal")).toEqual({
      input: { input_image_url: PHOTO.url, seed: 7, textured_mesh: true },
    });
    expect(result.warnings).toEqual([]);
  });

  test("tripo3d: the model id stays on the body, because there it IS a field", () => {
    const result = threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT, texture: false });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      model: "v3.1-20260211",
      prompt: PROMPT,
      texture: false,
    });
    expect(result.request.url).toBe("https://openapi.tripo3d.ai/v3/generation/text-to-model");
    expect(result.warnings).toEqual([]);
  });

  test("each ends in the SAME validator its hand surface calls", () => {
    // The one design decision the whole unified layer rests on: a unified call
    // adds a compile step in front of the provider's validator, it does not add
    // a second, weaker validator beside it.
    const unifiedFal = threeD({ model: "fal/fal-ai/trellis", image: PHOTO });
    const falByHand = falThreeD({ endpoint: "fal-ai/trellis", image_url: PHOTO.url });
    expect(JSON.parse(JSON.stringify(unifiedFal))).toEqual(JSON.parse(JSON.stringify(falByHand)));

    const unifiedTripo = threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT });
    const tripoByHand = tripoText({ model: "v3.1-20260211", prompt: PROMPT });
    expect(JSON.parse(JSON.stringify(unifiedTripo))).toEqual(
      JSON.parse(JSON.stringify(tripoByHand)),
    );
  });
});

describe("the route follows the input, at the native provider", () => {
  test("a prompt goes to text-to-model and an image goes to image-to-model", () => {
    const text = threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT });
    expect(text.request.url).toBe("https://openapi.tripo3d.ai/v3/generation/text-to-model");

    const image = threeD({ model: "tripo3d/v3.1-20260211", image: PHOTO });
    expect(image.request.url).toBe("https://openapi.tripo3d.ai/v3/generation/image-to-model");
    expect(JSON.parse(JSON.stringify(image))).toEqual({
      model: "v3.1-20260211",
      input: PHOTO.url,
    });
    expect(JSON.parse(JSON.stringify(image))).toEqual(
      JSON.parse(JSON.stringify(tripoImage({ model: "v3.1-20260211", input: PHOTO.url }))),
    );
  });

  test("neither is refused naming both, because a model id cannot decide", () => {
    const bad = threeD.safe({ model: "tripo3d/v3.1-20260211" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.message).toContain("DESCRIBING");
    expect(bad.errors[0]?.message).toContain("SHOWING");
  });

  test("both is refused, because Tripo's image route has no prompt field", () => {
    const bad = threeD.safe({ model: "tripo3d/v3.1-20260211", prompt: PROMPT, image: PHOTO });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "prompt");
    expect(issue?.code).toBe("unsupported_param");
    // …and it names the provider that DOES read both, which is the actionable
    // half.
    expect(issue?.message).toContain("hyper3d/rodin/v2.5");
  });

  test("fal's Rodin endpoint reads both, and is where a steered reconstruction lives", () => {
    const result = threeD({
      model: "fal/fal-ai/hyper3d/rodin/v2.5",
      prompt: PROMPT,
      image: PHOTO,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      prompt: PROMPT,
      image_urls: [PHOTO.url],
    });
    expect(result.warnings).toEqual([]);
  });

  test("Rodin with NEITHER is refused, because fal's schema would accept it", () => {
    const bad = threeD.safe({ model: "fal/fal-ai/hyper3d/rodin/v2.5" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.message).toContain("requires NEITHER");
  });
});

describe("the same model, two ways", () => {
  test("Tripo v3.1 through fal and through Tripo compile to different wires", () => {
    // The comparison the category was built to make cheap. Same model, same
    // request, two shapes — fal renames the input and drops the model field
    // (the endpoint IS the model there), Tripo keeps both.
    const viaFal = threeD({ model: "fal/tripo3d/h3.1/image-to-3d", image: PHOTO });
    const viaTripo = threeD({ model: "tripo3d/v3.1-20260211", image: PHOTO });

    expect(JSON.parse(JSON.stringify(viaFal))).toEqual({ image_url: PHOTO.url });
    expect(JSON.parse(JSON.stringify(viaTripo))).toEqual({
      model: "v3.1-20260211",
      input: PHOTO.url,
    });
    expect(viaFal.request.url).toBe("https://queue.fal.run/tripo3d/h3.1/image-to-3d");
    expect(viaTripo.request.url).toBe(
      "https://openapi.tripo3d.ai/v3/generation/image-to-model",
    );
  });

  test("and the words they disagree about are extras on both sides", () => {
    // `smart_low_poly` is Tripo's own and fal's resale drops it; `texture` is on
    // both and is still an extra, because agreeing with yourself through a
    // reseller is not a second witness.
    const tripo = threeD({
      model: "tripo3d/v3.1-20260211",
      prompt: PROMPT,
      smart_low_poly: true,
      texture: false,
      pbr: false,
    });
    expect(JSON.parse(JSON.stringify(tripo))).toMatchObject({ smart_low_poly: true });

    const fal = threeD.safe({
      model: "fal/tripo3d/h3.1/text-to-3d",
      prompt: PROMPT,
      texture: false,
    });
    expect(fal.ok).toBe(true);
    if (!fal.ok) return;
    expect(JSON.parse(JSON.stringify(fal.params))).toMatchObject({ texture: false });
  });
});

describe("inline bytes", () => {
  test("fal takes a data URI, because its field is documented to", () => {
    const result = threeD({
      model: "fal/fal-ai/trellis",
      image: { data: "aGVsbG8=", mimeType: "image/png" },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      image_url: "data:image/png;base64,aGVsbG8=",
    });
  });

  test("tripo3d refuses them, naming the upload endpoint", () => {
    const bad = threeD.safe({
      model: "tripo3d/v3.1-20260211",
      image: { data: "aGVsbG8=", mimeType: "image/png" },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "image");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("/v3/files");
  });
});

describe("estimates", () => {
  test("tripo3d estimates exactly, because its price is a function of the body", () => {
    const bare = threeD.safe({
      model: "tripo3d/v3.1-20260211",
      prompt: PROMPT,
      texture: false,
      pbr: false,
    });
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.estimate?.costUSD).toBeCloseTo(0.1, 8);

    const loaded = threeD.safe({
      model: "tripo3d/v3.1-20260211",
      image: PHOTO,
      geometry_quality: "detailed",
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // 30 credits base (image, textured) + 20 HD geometry = 50 → $0.50.
    expect(loaded.estimate?.costUSD).toBeCloseTo(0.5, 8);
  });

  test("fal declines wherever the rate turns on the request", () => {
    const conditional = threeD.safe({ model: "fal/fal-ai/hunyuan3d/v2", image: PHOTO });
    expect(conditional.ok).toBe(true);
    if (!conditional.ok) return;
    expect(conditional.estimate?.costUSD).toBeUndefined();

    const flat = threeD.safe({ model: "fal/fal-ai/trellis", image: PHOTO });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.estimate?.costUSD).toBeCloseTo(0.02, 8);
  });
});

describe("the seed", () => {
  test("maps to the GEOMETRY seed wherever a route publishes more than one", () => {
    // Tripo publishes three seeds and only `model_seed` pins the mesh.
    expect(
      JSON.parse(JSON.stringify(threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT, seed: 7 }))),
    ).toMatchObject({ model_seed: 7 });
    expect(
      JSON.parse(
        JSON.stringify(threeD({ model: "fal/tripo3d/h3.1/text-to-3d", prompt: PROMPT, seed: 7 })),
      ),
    ).toMatchObject({ model_seed: 7 });
    // Everywhere else it is plain `seed`.
    expect(
      JSON.parse(JSON.stringify(threeD({ model: "fal/fal-ai/trellis", image: PHOTO, seed: 7 }))),
    ).toMatchObject({ seed: 7 });
  });

  test("a route with no seed of any spelling refuses it by name", () => {
    const bad = threeD.safe({ model: "fal/meshy/v7/image-to-3d", image: PHOTO, seed: 7 });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "seed");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("model_seed");
  });
});
