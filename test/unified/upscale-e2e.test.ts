/**
 * `unmodel/upscale`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back — the ref'd provider's own `Validated`, its `.request`,
 * its `.toSdk`, its estimate — plus the two things this category has that its
 * siblings do not: a `factor` with three different per-model answers, and a
 * `model` wire field at four of fal's ten endpoints that names the restoration
 * NETWORK rather than the route.
 *
 * Two providers now, and the native half is where a `Validated` stops looking
 * like the others: Topaz's submit paths declare only `multipart/form-data`, so
 * a Topaz result carries `request.body === "form"`, EMPTY headers, and a body
 * that must be posted through `topaz.toFormData` rather than
 * `JSON.stringify`.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { upscale as falUpscale } from "../../src/providers/fal";
import { createUpscale, upscale } from "../../src/unified/upscale";
import { upscale as falAdapter } from "../../src/providers/fal/unified-upscale";
import { upscale as topazAdapter } from "../../src/providers/topaz/unified";
import { toFormData, topazCostUSD } from "../../src/providers/topaz";

const STILL = { url: "https://example.com/portrait.png" } as const;
const CLIP = { url: "https://example.com/take-3.mp4" } as const;

describe("the pack", () => {
  test("registers exactly the two upscale providers", () => {
    expect([...upscale.providers]).toEqual(["fal", "topaz"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => upscale({ model: "clipdrop/upscaling", source: STILL } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = upscale.safe({ model: "clipdrop/upscaling", source: STILL } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.meta?.["structural"]).toBe(true);
    expect(result.errors[0]?.message).toContain("not a upscale provider in this build");
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = upscale.safe({
      model: "fal/fal-ai/clarity-upscaler-v2",
      source: STILL,
      factor: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    // …and it still ROUTES, which is the half that matters: fal adds endpoints
    // weekly and a curated roster is a snapshot.
    const params = result.params as unknown as { request: { url: string } };
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/clarity-upscaler-v2");
    // With no row to read, the adapter sends the commonest spelling and lets
    // fal's own IR have the last word.
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({ upscale_factor: 3 });
  });

  test("each provider is one adapter, and either builds a pack on its own", () => {
    expect(falAdapter.models).toHaveLength(11);
    expect(topazAdapter.models).toHaveLength(15);
    expect([...createUpscale([falAdapter]).providers]).toEqual(["fal"]);
    expect([...createUpscale([topazAdapter]).providers]).toEqual(["topaz"]);
  });
});

/**
 * The native half, and the three ways its `Validated` differs from fal's.
 *
 * Topaz publishes no JSON arm on either submit path, so a valid request is a
 * FORM — and the framing has to survive to the caller, or they will
 * `JSON.stringify` a body the API refuses.
 */
describe("the result is Topaz's own Validated, and it is multipart", () => {
  test("the framing, the empty headers and the route are all on `.request`", () => {
    const result = upscale({
      model: "topaz/Standard V2",
      source: STILL,
      output_width: 4096,
      output_height: 4096,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      model: "Standard V2",
      source_url: STILL.url,
      output_width: 4096,
      output_height: 4096,
    });
    expect(result.request.url).toBe("https://api.topazlabs.com/image/v1/enhance/async");
    expect(result.request.method).toBe("POST");
    // Empty on purpose: `fetch` derives the multipart boundary from the
    // FormData, and a hand-set content-type would break the request.
    expect(result.request.headers).toEqual({});
    expect(result.request.body).toBe("form");
  });

  test("the ref picks the ROUTE, because Topaz's two model enums are disjoint", () => {
    const classic = upscale({ model: "topaz/Standard V2", source: STILL });
    const generative = upscale({ model: "topaz/Redefine", source: STILL, prompt: "a sailing boat" });
    expect(classic.request.url).toBe("https://api.topazlabs.com/image/v1/enhance/async");
    expect(generative.request.url).toBe("https://api.topazlabs.com/image/v1/enhance-gen/async");
  });

  test("the body is what `toFormData` takes, and numbers cross as strings", () => {
    const result = upscale({
      model: "topaz/Redefine",
      source: STILL,
      prompt: "a wooden sailing boat at anchor",
      creativity: 4,
    });
    const form = toFormData(result);
    expect(form.get("model")).toBe("Redefine");
    expect(form.get("source_url")).toBe(STILL.url);
    expect(form.get("prompt")).toBe("a wooden sailing boat at anchor");
    // The spec types the whole settings space as
    // `additionalProperties: { type: string }`, so 4 goes out as "4".
    expect(form.get("creativity")).toBe("4");
  });

  test("`factor` is refused, naming the two fields Topaz has instead", () => {
    const result = upscale.safe({ model: "topaz/Standard V2", source: STILL, factor: 2 } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "factor");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("output_width");
    expect(issue?.message).toContain("output_height");
  });

  test("the estimate is EXACT when the request states an output size", () => {
    // Topaz bills per output megapixel, rounded up to a whole credit: 4096×4096
    // is 16.8 MP, and `Standard V2` fits 24 MP into one credit — so one credit,
    // at $0.12. The arithmetic is a pure function of the body, which is rare.
    expect(topazCostUSD({ model: "Standard V2", outputWidth: 4096, outputHeight: 4096 })).toBeCloseTo(
      0.12,
      10,
    );
    // Redefine fits 4 MP into a credit, so the same picture is five credits.
    expect(topazCostUSD({ model: "Redefine", outputWidth: 4096, outputHeight: 4096 })).toBeCloseTo(
      5 * 0.12,
      10,
    );
    // …and a request that lets Topaz choose the size declines rather than
    // guessing, because the input is a URL.
    expect(topazCostUSD({ model: "Standard V2" })).toBeUndefined();
  });
});

describe("the result is fal's own Validated", () => {
  test("the enumerable body IS the fetch payload, and the route is not in it", () => {
    const result = upscale({
      model: "fal/fal-ai/clarity-upscaler",
      source: STILL,
      factor: 2,
      creativity: 0.5,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      image_url: STILL.url,
      upscale_factor: 2,
      creativity: 0.5,
    });
    expect(result.request.url).toBe("https://queue.fal.run/fal-ai/clarity-upscaler");
    expect(result.request.method).toBe("POST");
    expect(result.request.headers).toEqual({ "content-type": "application/json" });
    expect(result.toSdk("fal")).toEqual({
      input: { image_url: STILL.url, upscale_factor: 2, creativity: 0.5 },
    });
    expect(result.warnings).toEqual([]);
  });

  test("it ends in the SAME validator the hand surface calls", () => {
    // The one design decision the whole unified layer rests on: a unified call
    // adds a compile step in front of the provider's validator, it does not add
    // a second, weaker validator beside it.
    const unified = upscale({ model: "fal/fal-ai/esrgan", source: STILL, factor: 4 });
    const byHand = falUpscale({ endpoint: "fal-ai/esrgan", image_url: STILL.url, scale: 4 });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(byHand)));
    expect(unified.request.url).toBe(byHand.request.url);
  });

  test("the one endpoint with a flat per-image rate estimates; the rest decline", () => {
    const flat = upscale.safe({ model: "fal/fal-ai/recraft/upscale/crisp", source: STILL });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.estimate?.costUSD).toBeCloseTo(0.004, 6);

    // Everything else is billed by the size of the OUTPUT, which is the INPUT
    // file's dimensions times the factor — and a submit body carries a URL, so
    // unmodel never sees them. A plausible number would be a wrong one.
    const open = upscale.safe({ model: "fal/fal-ai/clarity-upscaler", source: STILL, factor: 4 });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.estimate?.costUSD).toBeUndefined();
  });
});

describe("`factor` has three answers", () => {
  test("a range: the value goes out and fal's own IR checks the ends", () => {
    const ok = upscale({ model: "fal/fal-ai/seedvr/upscale/image", source: STILL, factor: 8 });
    expect(JSON.parse(JSON.stringify(ok))).toMatchObject({ upscale_factor: 8 });

    const over = upscale.safe({
      model: "fal/fal-ai/seedvr/upscale/image",
      source: STILL,
      factor: 12,
    });
    expect(over.ok).toBe(false);
    if (over.ok) return;
    // The bound is this endpoint's own, from its own schema — not a
    // category-wide one, which is why 12 is legal nowhere and 8 is legal here
    // and not at Clarity.
    expect(over.errors.some((issue) => issue.message.includes("10"))).toBe(true);
  });

  test("a closed set: an off-list multiplier names the one value, and does not snap", () => {
    // `as never` because the TYPE already refuses this — see
    // test/types/unified-upscale.test-d.ts. What is pinned here is the run-time
    // half, for the JavaScript callers a type cannot reach.
    const result = upscale.safe({ model: "fal/fal-ai/aura-sr", source: STILL, factor: 2 } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "factor");
    expect(issue?.code).toBe("invalid_enum_value");
    expect(issue?.meta?.["allowed"]).toEqual([4]);
    expect(issue?.message).toContain("nothing else");
  });

  test("none at all: the refusal says what kind of upscaler this is", () => {
    const result = upscale.safe({
      model: "fal/fal-ai/recraft/upscale/crisp",
      source: STILL,
      factor: 2,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "factor");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("upscales to a size it chooses");
    // …and it counts the siblings that DO take one, rather than claiming fal
    // has no multiplier (risk R7).
    expect(issue?.message).toContain("of the 11 fal upscale endpoints");
  });
});

describe("the `model` field that is not the route", () => {
  test("a unified caller's `model` is the REF; fal's is a body field", () => {
    const result = upscale({
      model: "fal/topaz/upscale/image/generative",
      source: STILL,
      factor: 4,
      providerOptions: { fal: { model: "Wonder 3.5" } },
    });
    const body = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    // The ref picked the endpoint; the override picked the network. Both arrived.
    expect(result.request.url).toBe("https://queue.fal.run/topaz/upscale/image/generative");
    expect(body["model"]).toBe("Wonder 3.5");
  });

  test("an override the endpoint refuses is reported at the wire spelling", () => {
    const result = upscale.safe({
      model: "fal/fal-ai/esrgan",
      source: STILL,
      providerOptions: { fal: { model: "RealESRGAN_x8plus" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "model");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("supplied via `providerOptions`");
  });
});

describe("the two media, one address", () => {
  test("a clip route and a still route are one product at fal, and both compile", () => {
    const still = upscale({ model: "fal/fal-ai/seedvr/upscale/image", source: STILL, factor: 2 });
    const clip = upscale({ model: "fal/fal-ai/seedvr/upscale/video", source: CLIP, factor: 2 });
    expect(JSON.parse(JSON.stringify(still))).toEqual({
      image_url: STILL.url,
      upscale_factor: 2,
    });
    expect(JSON.parse(JSON.stringify(clip))).toEqual({ video_url: CLIP.url, upscale_factor: 2 });
  });

  test("a still handed to a clip route goes out as written, and the type is where it is caught", () => {
    // fal takes any `data:` URI in `video_url`, so the shape gate passes and
    // the request goes out — unmodel cannot tell an MP4 from a PNG behind a
    // URL. What it CAN do is refuse it at the keystroke, which is where the
    // check belongs; see test/types/unified-upscale.test-d.ts.
    const result = upscale.safe({
      model: "fal/fal-ai/seedvr/upscale/video",
      source: { data: "AAAA", mimeType: "image/png" },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({
      video_url: "data:image/png;base64,AAAA",
    });
  });
});

describe("providerOptions", () => {
  test("reaches the params the vocabulary deliberately has no word for", () => {
    const result = upscale({
      model: "fal/fal-ai/clarity-upscaler",
      source: STILL,
      providerOptions: { fal: { resemblance: 0.8, negative_prompt: "blurry" } },
    });
    const body = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(body["resemblance"]).toBe(0.8);
    expect(body["negative_prompt"]).toBe("blurry");
  });

  test("and is still validated by fal's own IR on the way out", () => {
    const result = upscale.safe({
      model: "fal/fal-ai/clarity-upscaler",
      source: STILL,
      providerOptions: { fal: { resemblance: 9 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes("at most 1"))).toBe(true);
  });

  test("a block for a provider this pack does not have is a warning, not a merge", () => {
    const result = upscale.safe({
      model: "fal/fal-ai/clarity-upscaler",
      source: STILL,
      providerOptions: { clipdrop: { upscaling: "x4" } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
    expect(JSON.parse(JSON.stringify(result.params))).not.toHaveProperty("upscaling");
  });

  test("…and a block for the OTHER provider in the pack is ignored, not merged", () => {
    // The sharper half of the same rule now that there are two: `topaz` IS a
    // provider in this pack, and a `topaz` block on a `fal` ref still must not
    // reach fal's wire.
    const result = upscale.safe({
      model: "fal/fal-ai/clarity-upscaler",
      source: STILL,
      providerOptions: { topaz: { output_format: "png" } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).not.toHaveProperty("output_format");
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() =>
      upscale({ model: "fal/fal-ai/aura-sr", source: STILL, prompt: "sharper" } as never),
    ).toThrow(UnmodelValidationError);
    try {
      upscale({ model: "fal/fal-ai/aura-sr", source: STILL, prompt: "sharper" } as never);
    } catch (error) {
      expect((error as UnmodelValidationError).message).toContain("unmodel/upscale");
      expect((error as UnmodelValidationError).message).toContain("prompt");
    }
  });
});
