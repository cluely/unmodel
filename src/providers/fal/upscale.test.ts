/**
 * `fal.upscale` — the wire contract, and the largest concentration of the
 * `model` collision in this provider.
 *
 * Most of the routing contract is `fal.image`'s (stripping, degradation,
 * `.toSdk`), asserted there and not repeated. What is asserted HERE is what is
 * particular to this address: FOUR of its ten endpoints publish a real `model`
 * body field naming a restoration NETWORK, the multiplier has two spellings
 * with five different ranges behind them, and the category is the one whose
 * output modality varies per endpoint.
 */

import { describe, expect, test } from "bun:test";
import { upscale } from "./upscale";
import { FAL_UPSCALE_ENDPOINTS } from "./gen/endpoints.gen";
import type { ModelInfo } from "../../core/catalog-types";
import { upscaleModels } from "./gen/models-upscale.gen";
import { FAL_UPSCALE_SHAPES } from "./gen/upscale-narrow.gen";

const STILL = "https://example.com/portrait.png";
const CLIP = "https://example.com/take-3.mp4";

/** The catalog slice, widened to `ModelInfo` — see `src/providers/fal/stt.test.ts`. */
const CATALOG = upscaleModels as Readonly<Record<string, ModelInfo>>;

/** The one required parameter each endpoint takes, by medium. */
function minimal(endpoint: string): Record<string, unknown> {
  const shape = (FAL_UPSCALE_SHAPES as Readonly<Record<string, { props: Record<string, unknown> }>>)[
    endpoint
  ];
  return shape?.props["video_url"] !== undefined ? { video_url: CLIP } : { image_url: STILL };
}

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_UPSCALE_ENDPOINTS) {
      const params = upscale({ endpoint, ...minimal(endpoint) } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
      expect(Object.keys(params)).not.toContain("endpoint");
    }
  });

  test("the vendor-namespaced ids route to the PUBLISHED id, not the documented route", () => {
    // fal's OpenAPI for `blackforestlabs/flux-video-upscale` documents the
    // internal path `/fal-ai/flux-video-upscale`, and the Topaz ids document
    // `/fal-ai/topaz/...`. The id unmodel submits to is the one fal publishes
    // and catalogues — the `ideogram/v4` precedent, three vendors over.
    expect(upscale({ endpoint: "blackforestlabs/flux-video-upscale", video_url: CLIP }).request.url)
      .toBe("https://queue.fal.run/blackforestlabs/flux-video-upscale");
    expect(upscale({ endpoint: "topaz/upscale/video/precision", video_url: CLIP }).request.url).toBe(
      "https://queue.fal.run/topaz/upscale/video/precision",
    );
  });
});

describe("the `model` field that is not the route", () => {
  test("`model` stays on the wire while `endpoint` routes, at all four", () => {
    const cases: Array<[endpoint: string, model: string]> = [
      ["topaz/upscale/image/precision", "High Fidelity V3"],
      ["topaz/upscale/image/generative", "Wonder 3.5"],
      ["topaz/upscale/video/precision", "Proteus"],
      ["fal-ai/esrgan", "RealESRGAN_x4plus_anime_6B"],
    ];
    for (const [endpoint, model] of cases) {
      const params = upscale({ endpoint, ...minimal(endpoint), model } as never);
      // The route came off; the network did not.
      expect(Object.keys(params)).toContain("model");
      expect(JSON.parse(JSON.stringify(params))).toMatchObject({ model });
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
    }
  });

  test("its vocabulary is enforced per endpoint — Topaz's networks are not ESRGAN's", () => {
    const bad = upscale.safe({
      endpoint: "fal-ai/esrgan",
      image_url: STILL,
      model: "Wonder 3.5",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "model");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("RealESRGAN");
  });

  test("the endpoints WITHOUT one report it, and say how many siblings have it", () => {
    const result = upscale.safe({
      endpoint: "fal-ai/clarity-upscaler",
      image_url: STILL,
      model: "Wonder 3.5",
    } as never);
    // A WARNING and not an error, deliberately: fal adds parameters between
    // snapshot refreshes, so an unknown key is a stale-roster signal rather
    // than a request unmodel is entitled to refuse. See `checkKnownParams`.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issue = result.warnings.find((w) => w.path?.[0] === "model");
    expect(issue?.code).toBe("unknown_param");
    // The count is the useful half: `model` at Clarity reads like a request
    // written for Topaz, and the message says so.
    expect(issue?.message).toContain("5 other endpoints in this category do take it");
  });
});

describe("the multiplier", () => {
  test("two spellings, and each endpoint takes exactly one", () => {
    expect(JSON.parse(JSON.stringify(upscale({ endpoint: "fal-ai/esrgan", image_url: STILL, scale: 4 }))))
      .toEqual({ image_url: STILL, scale: 4 });
    expect(
      JSON.parse(
        JSON.stringify(
          upscale({ endpoint: "fal-ai/clarity-upscaler", image_url: STILL, upscale_factor: 4 }),
        ),
      ),
    ).toEqual({ image_url: STILL, upscale_factor: 4 });

    // …and the other spelling is an unknown parameter, not a synonym.
    const crossed = upscale.safe({
      endpoint: "fal-ai/esrgan",
      image_url: STILL,
      upscale_factor: 4,
    } as never);
    expect(crossed.ok).toBe(true);
    if (!crossed.ok) return;
    const issue = crossed.warnings.find((w) => w.path?.[0] === "upscale_factor");
    expect(issue?.code).toBe("unknown_param");
    expect(issue?.message).toContain('it takes "image_url", "scale"');
  });

  test("the range is this endpoint's own, read from its own schema", () => {
    // 8 is legal at ESRGAN (1..8) and at SeedVR (1..10), and illegal at Clarity
    // and Topaz (1..4). A category-wide bound would have to accept all of them.
    expect(upscale.safe({ endpoint: "fal-ai/esrgan", image_url: STILL, scale: 8 }).ok).toBe(true);
    expect(
      upscale.safe({ endpoint: "fal-ai/clarity-upscaler", image_url: STILL, upscale_factor: 8 }).ok,
    ).toBe(false);
    // FLUX's floor is 1.5 — the one endpoint where 1× is not a legal request.
    expect(
      upscale.safe({ endpoint: "blackforestlabs/flux-video-upscale", video_url: CLIP, upscale_factor: 1 })
        .ok,
    ).toBe(false);
  });

  test("`fal-ai/aura-sr` publishes a single-value enum, and it is enforced", () => {
    expect(upscale.safe({ endpoint: "fal-ai/aura-sr", image_url: STILL, upscale_factor: 4 }).ok).toBe(
      true,
    );
    const bad = upscale.safe({ endpoint: "fal-ai/aura-sr", image_url: STILL, upscale_factor: 2 } as never);
    expect(bad.ok).toBe(false);
  });
});

describe("the catalog", () => {
  test("the output modality is read per endpoint, not fixed by the verb", () => {
    // The only address in this provider where it varies — which is why
    // `VERB_OUTPUT_MODALITY` in scripts/codegen-fal.ts deliberately omits
    // `upscale` and the response schema decides.
    expect(CATALOG["fal-ai/aura-sr"]?.modalities.output).toEqual(["image"]);
    expect(CATALOG["fal-ai/seedvr/upscale/video"]?.modalities.output).toEqual(["video"]);
    expect(CATALOG["topaz/upscale/video/precision"]?.modalities.output).toEqual(["video"]);
  });

  test("only the flat per-image rate reaches `cost`", () => {
    // Every other rate here is per compute-second, per 24-megapixel block, or
    // conditional on a network or a resolution the request does not state.
    expect(CATALOG["fal-ai/recraft/upscale/crisp"]?.cost).toEqual({ perImage: 0.004 });
    const priced = Object.values(CATALOG).filter((row) => row.cost !== undefined);
    expect(priced).toHaveLength(1);
  });
});

describe("degradation", () => {
  test("an endpoint outside the roster still routes, with a warning", () => {
    const result = upscale.safe({
      endpoint: "fal-ai/clarity-upscaler-v2",
      image_url: STILL,
      upscale_factor: 3,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/clarity-upscaler-v2");
  });
});
