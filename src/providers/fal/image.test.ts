/**
 * `fal.image` — the wire contract.
 *
 * Five things are asserted here, and they are the five that are specific to
 * this provider rather than to the pipeline it runs on:
 *
 * 1. **The endpoint id becomes the URL, at any depth.** fal ids run from two
 *    segments (`fal-ai/flux-2`) to five (`fal-ai/bytedance/seedream/v4.5/
 *    text-to-image`), and every separator has to survive — `encodeURIComponent`
 *    over the whole id would produce `fal-ai%2Fflux%2Fdev` and a 404.
 * 2. **`endpoint` never reaches the wire.** It is unmodel's route selector, not
 *    a fal field, so it must be absent from the enumerable body while still
 *    being a legal — indeed required — key on the way in.
 * 3. **An unknown endpoint degrades rather than fails.** fal adds endpoints
 *    weekly; a roster is a snapshot.
 * 4. **A Tier-A rejection comes from the IR, and cites the endpoint.** The
 *    whole point of the generated per-endpoint rows is that
 *    `num_inference_steps: 50` is fine on `flux/dev` and refused on
 *    `flux/schnell`, with a message naming schnell's own ceiling and linking
 *    schnell's own documentation.
 * 5. **`.toSdk("fal")` matches the published client.** fal's own docs spell the
 *    call `fal.subscribe(id, { input })`, so the formatter nests.
 */

import { describe, expect, test } from "bun:test";
import { image } from "./image";
import { FAL_IMAGE_ENDPOINTS } from "./gen/endpoints.gen";

const PROMPT = "a lighthouse in fog";

describe("routing", () => {
  test("the endpoint id is the URL path, at every depth the roster uses", () => {
    const cases: Array<[string, string]> = [
      ["fal-ai/flux-2", "https://queue.fal.run/fal-ai/flux-2"],
      ["fal-ai/flux/dev", "https://queue.fal.run/fal-ai/flux/dev"],
      ["fal-ai/flux-pro/v1.1-ultra", "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra"],
      [
        "fal-ai/bytedance/seedream/v4.5/text-to-image",
        "https://queue.fal.run/fal-ai/bytedance/seedream/v4.5/text-to-image",
      ],
      // A vendor-namespaced id: the PUBLISHED id, not the internal `fal-ai/…`
      // alias its OpenAPI document is written against. Both are live routes;
      // this is the one fal documents.
      ["ideogram/v4", "https://queue.fal.run/ideogram/v4"],
      ["xai/grok-imagine-image", "https://queue.fal.run/xai/grok-imagine-image"],
    ];
    for (const [endpoint, url] of cases) {
      const params = image({ endpoint, prompt: PROMPT } as never);
      expect(params.request.url, endpoint).toBe(url);
      expect(params.request.method).toBe("POST");
      expect(params.request.headers).toMatchObject({ "content-type": "application/json" });
    }
  });

  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_IMAGE_ENDPOINTS) {
      const params = image({ endpoint, prompt: PROMPT } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
    }
  });

  test("`endpoint` is stripped from the body it routed", () => {
    const params = image({ endpoint: "fal-ai/flux/dev", prompt: PROMPT, num_images: 2 });
    expect(Object.keys(params).sort()).toEqual(["num_images", "prompt"]);
    expect(JSON.parse(JSON.stringify(params))).toEqual({ prompt: PROMPT, num_images: 2 });
    // …and the id it routed by survives on `.request.url`, which is the only
    // place a caller needs it: `JSON.stringify(params)` is the wire body, and
    // `params.request` is where it goes.
    expect(params.request.url).toContain("fal-ai/flux/dev");
  });

  test("`.toSdk(\"fal\")` nests the body under `input`, as @fal-ai/client documents", () => {
    const params = image({ endpoint: "fal-ai/flux/schnell", prompt: PROMPT });
    expect(params.toSdk("fal")).toEqual({ input: { prompt: PROMPT } });
  });
});

describe("degradation", () => {
  test("an endpoint the roster has never seen compiles, and warns once", () => {
    const result = image.safe({ endpoint: "fal-ai/released-last-tuesday", prompt: PROMPT } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_model"]);
    expect(result.warnings[0]?.message).toContain("fal-ai/released-last-tuesday");
    // It still routes: a request unmodel cannot vouch for is not a request it
    // refuses to address.
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/released-last-tuesday");
  });

  test("a known endpoint warns about nothing at all", () => {
    const result = image.safe({ endpoint: "fal-ai/flux/dev", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });
});

describe("per-endpoint narrowing, from the generated IR", () => {
  test("num_inference_steps: 50 is fine on flux/dev and refused on flux/schnell", () => {
    expect(image.safe({ endpoint: "fal-ai/flux/dev", prompt: PROMPT, num_inference_steps: 50 }).ok).toBe(
      true,
    );

    const result = image.safe({
      endpoint: "fal-ai/flux/schnell",
      prompt: PROMPT,
      num_inference_steps: 50,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [issue] = result.errors;
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.path).toEqual(["num_inference_steps"]);
    // The message carries schnell's own ceiling, schnell's own name…
    expect(issue?.message).toBe(
      "`num_inference_steps` must be at most 12 on fal-ai/flux/schnell; got 50.",
    );
    // …and a link to the page that says 12.
    expect(issue?.meta).toMatchObject({
      max: 12,
      source: "https://fal.ai/models/fal-ai/flux/schnell/api",
    });
  });

  test("a required parameter fal supplies no default for is an error", () => {
    const result = image.safe({ endpoint: "fal-ai/flux/dev" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toEqual(["prompt"]);
  });

  test("a parameter no fal image endpoint has draws exactly one generic warning", () => {
    // fal ships new parameters between snapshot refreshes; a caller who read
    // the release notes first should not be blocked by a stale roster. The
    // PIPELINE owns this case — the key is in no endpoint's schema, so the
    // category union schema catches it and `checkKnownParams` stands down
    // rather than saying the same thing twice in different words.
    const result = image.safe({
      endpoint: "fal-ai/flux/dev",
      prompt: PROMPT,
      brand_new_knob: true,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_param"]);
    expect(result.warnings[0]?.message).toContain("brand_new_knob");
    // …and it still goes out as written.
    expect((result.params as unknown as { brand_new_knob?: boolean }).brand_new_knob).toBe(true);
  });

  test("a parameter a SIBLING endpoint has is the interesting case, and names it", () => {
    // `aspect_ratio` is a real `fal.image` parameter — on nine of the 28
    // endpoints — so the category's union schema declares it and the pipeline
    // cannot see anything wrong. Only the per-endpoint IR knows that
    // `fal-ai/flux/dev` sizes by `image_size` and has no `aspect_ratio` at all.
    const result = image.safe({
      endpoint: "fal-ai/flux/dev",
      prompt: PROMPT,
      aspect_ratio: "16:9",
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_param"]);
    const [warning] = result.warnings;
    expect(warning?.message).toContain("aspect_ratio");
    // It lists what flux/dev DOES take…
    expect(warning?.message).toContain("image_size");
    // …says the key belongs to siblings, so the caller knows it was not a typo…
    // …says the key belongs to siblings, and the plural agrees with the count
    // (ten of them do, so "endpoints … do take it" rather than "endpoint …
    // does"). The grammar is checked because the message is the product.
    expect(warning?.message).toMatch(/\d+ other endpoints in this category do take it/);
    // …and links flux/dev's own page.
    expect(warning?.meta).toMatchObject({
      source: "https://fal.ai/models/fal-ai/flux/dev/api",
    });
    expect((warning?.meta as { takenBy?: string[] })?.takenBy).toContain("fal-ai/nano-banana-2");
  });

  test("a closed enum refuses an unlisted value; an OPEN one only warns", () => {
    const closed = image.safe({
      endpoint: "fal-ai/flux/dev",
      prompt: PROMPT,
      output_format: "gif",
    } as never);
    expect(closed.ok).toBe(false);

    // `fal-ai/flux-pro/v1.1-ultra` spells `aspect_ratio` as
    // `anyOf: [{enum: […]}, {type: "string"}]` — nine listed ratios, and any
    // other string accepted. Refusing one fal accepts would be worse than
    // saying nothing, so it is a warning.
    const open = image.safe({
      endpoint: "fal-ai/flux-pro/v1.1-ultra",
      prompt: PROMPT,
      aspect_ratio: "1234:567",
    } as never);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.warnings.map((issue) => issue.code)).toEqual(["invalid_enum_value"]);
    expect(open.warnings[0]?.meta).toMatchObject({ open: true });
  });

  test("image_size is checked per endpoint, both arms", () => {
    const preset = image.safe({
      endpoint: "fal-ai/flux/dev",
      prompt: PROMPT,
      image_size: "not_a_preset",
    } as never);
    expect(preset.ok).toBe(false);
    if (preset.ok) return;
    expect(preset.errors[0]?.message).toContain("landscape_4_3");

    const pixels = image.safe({
      endpoint: "fal-ai/flux/dev",
      prompt: PROMPT,
      image_size: { width: 20_000, height: 512 },
    });
    expect(pixels.ok).toBe(false);
    if (pixels.ok) return;
    expect(pixels.errors[0]?.path).toEqual(["image_size", "width"]);
    expect(pixels.errors[0]?.message).toContain("14142");
  });
});

describe("estimates", () => {
  test("a flat per-image rate is a number", () => {
    const result = image.safe({ endpoint: "reve/2.1/text-to-image", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBe(0.25);
  });

  test("per-megapixel needs pixels: explicit dimensions price, a preset does not", () => {
    // 1920x1080 is 2.07 MP, billed as 3 — fal rounds UP to the megapixel.
    const explicit = image.safe({
      endpoint: "fal-ai/flux/schnell",
      prompt: PROMPT,
      image_size: { width: 1920, height: 1080 },
    });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.estimate.costUSD).toBeCloseTo(0.009, 6);

    // A preset is a NAME. fal publishes no per-endpoint table of what its
    // presets measure, so there is no honest pixel count to bill.
    const preset = image.safe({
      endpoint: "fal-ai/flux/schnell",
      prompt: PROMPT,
      image_size: "landscape_4_3",
    });
    expect(preset.ok).toBe(true);
    if (!preset.ok) return;
    expect(preset.estimate.costUSD).toBeUndefined();
  });

  test("a conditional rate the request leaves open estimates nothing", () => {
    // nano-banana-2's rate is multiplied by `resolution` and surcharged by two
    // booleans. `undefined` beats a number that is wrong for most requests.
    const result = image.safe({ endpoint: "fal-ai/nano-banana-2", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBeUndefined();
  });
});
