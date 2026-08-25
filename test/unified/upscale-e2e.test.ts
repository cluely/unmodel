/**
 * `unmodel/upscale`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back — fal's own `Validated`, its `.request`, its `.toSdk`, its
 * estimate — plus the two things this category has that its siblings do not: a
 * `factor` with three different per-model answers, and a `model` wire field at
 * four of the ten endpoints that names the restoration NETWORK rather than the
 * route.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { upscale as falUpscale } from "../../src/providers/fal";
import { createUpscale, upscale } from "../../src/unified/upscale";
import { upscale as falAdapter } from "../../src/providers/fal/unified-upscale";

const STILL = { url: "https://example.com/portrait.png" } as const;
const CLIP = { url: "https://example.com/take-3.mp4" } as const;

describe("the pack", () => {
  test("registers exactly the one upscale provider", () => {
    expect([...upscale.providers]).toEqual(["fal"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => upscale({ model: "topaz/gigapixel", source: STILL } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = upscale.safe({ model: "topaz/gigapixel", source: STILL } as never);
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

  test("the ten endpoints are one adapter, and the pack is that adapter", () => {
    expect(falAdapter.models).toHaveLength(10);
    const built = createUpscale([falAdapter]);
    expect([...built.providers]).toEqual(["fal"]);
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
    expect(issue?.message).toContain("of the 10 fal upscale endpoints");
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
      providerOptions: { topaz: { model: "Wonder 3.5" } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
    expect(JSON.parse(JSON.stringify(result.params))).not.toHaveProperty("model");
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
