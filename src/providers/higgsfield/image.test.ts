import { describe, expect, test } from "bun:test";
import { HIGGSFIELD_IMAGE_ENDPOINTS, HIGGSFIELD_IMAGE_EDIT_ENDPOINTS, HIGGSFIELD_VIDEO_ENDPOINTS, HIGGSFIELD_ENDPOINTS, HIGGSFIELD_DOC_URLS, HIGGSFIELD_EXCLUDED } from "./gen/endpoints.gen";
import { HIGGSFIELD_IMAGE_SHAPES } from "./gen/image-narrow.gen";
import { imageModels } from "./gen/models-image.gen";
import { HIGGSFIELD_VIDEO_SHAPES } from "./gen/video-narrow.gen";
import { image } from "./image";
import type { Issue } from "../../core/issues";
import type { HiggsfieldEndpointShape, HiggsfieldPropSpec } from "./shape-types";

/** The JSON a validated result serialises to: its enumerable properties, which are the wire body. */
function bodyOf(validated: object): unknown {
  return JSON.parse(JSON.stringify(validated));
}

/**
 * `higgsfield.image` against the REAL generated rows. Catalog-coupled on
 * purpose; the battery's own behaviours are in `checks.test.ts`.
 */

const SOUL = "higgsfield-ai/soul/standard";
const SOUL_V2 = "higgsfield-ai/soul/v2/standard";

/**
 * A result's warnings about the REQUEST. Every priced Soul request also
 * carries `unconfirmed_cost`, which is about the estimate and has a test of
 * its own; the tests below each read one fact of the body.
 */
function findings(warnings: readonly Issue[]): Issue[] {
  return warnings.filter((issue) => issue.code !== "unconfirmed_cost");
}

describe("higgsfield.image — the request it builds", () => {
  test("the route id becomes the path and the body is what was written", () => {
    const params = image({ endpoint: SOUL, prompt: "Editorial portrait in soft daylight", resolution: "1080p", batch_size: 4 });
    expect(bodyOf(params)).toEqual({ prompt: "Editorial portrait in soft daylight", resolution: "1080p", batch_size: 4 });
    expect(params.request).toEqual({
      url: "https://api.higgsfield.ai/higgsfield-ai/soul/standard",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
  });

  test("explicit `null`s and explicit defaults survive: the idempotency fingerprint counts them", () => {
    const body = { prompt: "x", seed: null, custom_reference_id: null, image_reference_url: null, batch_size: 1, aspect_ratio: "4:3", resolution: "720p" } as const;
    const result = image.safe({ endpoint: SOUL, ...body, hf_webhook: "https://hooks.example.com/hf" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual(body);
    expect(JSON.stringify(result.params)).toBe(JSON.stringify(body));
    expect(result.params.request.url).toBe("https://api.higgsfield.ai/higgsfield-ai/soul/standard?hf_webhook=https%3A%2F%2Fhooks.example.com%2Fhf");
    expect(findings(result.warnings)).toEqual([]);
  });

  test('`.toSdk("higgsfield")` carries the webhook the URL carries', () => {
    expect(image({ endpoint: SOUL, prompt: "x" }).toSdk("higgsfield")).toEqual({ input: { prompt: "x" } });
    expect(image({ endpoint: SOUL, prompt: "x", hf_webhook: "https://hooks.example.com/hf" }).toSdk("higgsfield")).toEqual({
      input: { prompt: "x" },
      webhook: { url: "https://hooks.example.com/hf" },
    });
  });

  test("Soul is estimated per resolution, at the default when none is stated, and not for a batch of four", () => {
    function estimateOf(body: Record<string, unknown>): unknown {
      const result = image.safe({ endpoint: SOUL, prompt: "x", ...body } as never);
      return result.ok ? result.estimate : result.errors;
    }
    expect(estimateOf({})).toEqual({ costUSD: 0.0938 });
    expect(estimateOf({ resolution: "1080p" })).toEqual({ costUSD: 0.1875 });
    expect(estimateOf({ resolution: "1080p", batch_size: 4 })).toEqual({});
  });

  test("an estimate from a rate Higgsfield contradicts itself on says so on the result", () => {
    const result = image.safe({ endpoint: SOUL, prompt: "x" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ severity: "warning", code: "unconfirmed_cost", path: [], model: SOUL });
    expect(result.warnings[0]?.message).toBe(
      "The $0.0938 estimate for higgsfield-ai/soul/standard is computed from a rate Higgsfield contradicts itself on. " +
        "Higgsfield's model page states this rate, while the same route's console document says \"Public pricing information is not available for this model.\" " +
        "Treat it as an unconfirmed list price. `POST estimateUrl(endpoint)` with the same body answers the amount for your account.",
    );
    // No estimate, no caveat: a batch of four has no price to be unsure of.
    const batch = image.safe({ endpoint: SOUL, prompt: "x", batch_size: 4 });
    expect(batch.ok && batch.warnings).toEqual([]);
    // A rate no page contradicts is silent.
    const marketing = image.safe({ endpoint: "marketing-studio/image", prompt: "x" });
    expect(marketing.ok && marketing.warnings.map((issue) => issue.code)).not.toContain("unconfirmed_cost");
  });

  test("the catalog row of a Soul route carries the default resolution's figure", () => {
    expect(imageModels[SOUL].cost).toEqual({ perImage: 0.0938 });
    // Ideogram's page states "$0.03 each" and its console document says no price is public: not catalogued.
    expect("cost" in imageModels["ideogram/v4.0"]).toBe(false);
    expect("cost" in imageModels["marketing-studio/image"]).toBe(false);
  });
});

describe("higgsfield.image — an id that is not its own", () => {
  test("a VIDEO route's id is a warning naming `higgsfield.video`, and the request is still built", () => {
    const result = image.safe({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "x", output_format: "mp4" } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.params.request.url).toBe("https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ severity: "warning", code: "unsupported_capability" });
    expect(result.warnings[0]?.meta?.["address"]).toBe("higgsfield.video");
  });

  test("an excluded id carries its recorded reason, as a warning", () => {
    const result = image.safe({ endpoint: "higgsfiled/genjutsu/object-swap/v1.0" });
    expect(result.ok && result.warnings.map((issue) => [issue.severity, issue.code, issue.meta?.["excluded"]])).toEqual([["warning", "unknown_model", true]]);
  });
});

describe("higgsfield.image — the roster", () => {
  test("24 image routes and 87 video routes partition the generated roster", () => {
    expect(HIGGSFIELD_IMAGE_ENDPOINTS).toHaveLength(24);
    expect(Object.keys(HIGGSFIELD_IMAGE_SHAPES).sort()).toEqual([...HIGGSFIELD_IMAGE_ENDPOINTS].sort());
    expect(Object.keys(imageModels).sort()).toEqual([...HIGGSFIELD_IMAGE_ENDPOINTS].sort());
    expect([...HIGGSFIELD_IMAGE_ENDPOINTS, ...HIGGSFIELD_VIDEO_ENDPOINTS].sort()).toEqual([...HIGGSFIELD_ENDPOINTS]);
    for (const id of HIGGSFIELD_IMAGE_EDIT_ENDPOINTS) expect(HIGGSFIELD_IMAGE_ENDPOINTS).toContain(id);
  });

  test("every route has a documentation page, and no excluded id is served", () => {
    for (const id of HIGGSFIELD_ENDPOINTS) expect(HIGGSFIELD_DOC_URLS[id], id).toStartWith("https://");
    for (const id of Object.keys(HIGGSFIELD_EXCLUDED)) expect(HIGGSFIELD_ENDPOINTS as readonly string[]).not.toContain(id);
  });

  test("every published pattern compiles the way the battery compiles it", () => {
    const patterns = new Set<string>();
    function collect(spec: HiggsfieldPropSpec | undefined): void {
      if (spec === undefined) return;
      if (spec.pat !== undefined) patterns.add(spec.pat);
      collect(spec.items);
      collect(spec.values);
      for (const own of Object.values(spec.props ?? {})) collect(own);
    }
    const shapes: Record<string, HiggsfieldEndpointShape> = { ...HIGGSFIELD_IMAGE_SHAPES, ...HIGGSFIELD_VIDEO_SHAPES };
    for (const shape of Object.values(shapes)) {
      for (const spec of Object.values(shape.props)) collect(spec);
    }
    expect(patterns.size).toBeGreaterThan(0);
    for (const pattern of patterns) expect(() => new RegExp(pattern, "u"), pattern).not.toThrow();
  });

  test("every catalog row is a non-token image model keyed by its own id", () => {
    for (const [id, row] of Object.entries(imageModels)) {
      expect<string>(row.id, id).toBe(id);
      expect(row.limit.context, id).toBe(0);
      expect(row.modalities.output, id).toEqual(["image"]);
    }
  });
});

describe("higgsfield.image — the published facts of real routes", () => {
  test("`resolution` is the route's own vocabulary: pixel classes on Soul, tiers on Marketing Studio", () => {
    const soul = image.safe({ endpoint: SOUL, prompt: "x", resolution: "2k" } as never);
    expect(!soul.ok && soul.errors[0]?.message).toBe('`resolution` must be "720p" or "1080p" on higgsfield-ai/soul/standard; got "2k".');
    expect(image.safe({ endpoint: "marketing-studio/image", prompt: "x", resolution: "2k" }).ok).toBe(true);
  });

  test("Soul takes `batch_size` 1 or 4 and nothing between", () => {
    const result = image.safe({ endpoint: SOUL, prompt: "x", batch_size: 2 } as never);
    expect(!result.ok && result.errors[0]?.message).toBe("`batch_size` must be 1 or 4 on higgsfield-ai/soul/standard; got 2.");
  });

  test("Soul Standard: the console document's own example request validates, `style_id: null` and all", () => {
    // https://dash.higgsfield.ai/models/higgsfield-ai/soul/standard/llms.txt, "Required Parameters Example", read 2026-11-25.
    const published = { seed: null, prompt: "A cinematic scene at sunset", style_id: null, batch_size: 1, resolution: "720p", aspect_ratio: "4:3", enhance_prompt: true, style_strength: 1 } as const;
    const result = image.safe({ endpoint: SOUL, ...published });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual(published);
    expect(findings(result.warnings).map((issue) => [issue.severity, issue.path])).toEqual([["warning", ["style_id"]]]);
  });

  test("Qwen Image 3: `enable_thinking` without `prompt_extend` is a warning — the published default is the required value", () => {
    const result = image.safe({ endpoint: "alibaba/qwen-image-3/text-to-image", prompt: "x", enable_thinking: true });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings.map((issue) => [issue.path, issue.meta?.["default"]])).toEqual([[["prompt_extend"], true]]);
    expect(image.safe({ endpoint: "alibaba/qwen-image-3/text-to-image", prompt: "x", enable_thinking: true, prompt_extend: false }).ok).toBe(false);
  });

  test("Soul V2: `seed: null` is accepted and reported, because the two sources contradict each other", () => {
    const result = image.safe({ endpoint: SOUL_V2, prompt: "x", seed: null } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect((result.params as Record<string, unknown>)["seed"]).toBeNull();
    expect(findings(result.warnings).map((issue) => [issue.severity, issue.path])).toEqual([["warning", ["seed"]]]);
  });

  test("Soul V2: `custom_reference_strength: 0` is a warning — the schema accepts it and the usage notes say it fails", () => {
    const result = image.safe({ endpoint: SOUL_V2, prompt: "x", custom_reference_strength: 0 });
    expect(result.ok && findings(result.warnings).map((issue) => issue.path)).toEqual([["custom_reference_strength"]]);
  });

  test("an open route sends a key it does not declare whatever its value: another route's vocabulary is not its own", () => {
    // Kling publishes `sound` as `on | off`. Soul does not declare `sound` and
    // is not closed, so the API ignores it there, and so does the shape gate.
    const result = image.safe({ endpoint: SOUL, prompt: "x", sound: "auto" } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual({ prompt: "x", sound: "auto" });
    expect(findings(result.warnings).map((issue) => [issue.code, issue.path])).toEqual([["unknown_param", ["sound"]]]);
  });

  test("the Soul routes are open, and Ideogram is closed", () => {
    const soul = image.safe({ endpoint: SOUL, prompt: "x", style_preset: "noir" } as never);
    expect(soul.ok && findings(soul.warnings).map((issue) => issue.code)).toEqual(["unknown_param"]);
    const ideogram = image.safe({ endpoint: "ideogram/v4.0", prompt: "a fox", style_preset: "noir" } as never);
    expect(!ideogram.ok && ideogram.errors.map((issue) => issue.code)).toEqual(["unsupported_param"]);
  });

  test("Marketing Studio: `enhance_prompt` requires a preset and one or two pictures", () => {
    const id = "marketing-studio/image";
    const result = image.safe({ endpoint: id, prompt: "x", enhance_prompt: true });
    expect(!result.ok && result.errors.map((issue) => issue.message)).toEqual([
      "`preset_id` is required by marketing-studio/image when `enhance_prompt` is true.",
      "`image_urls` is required by marketing-studio/image when `enhance_prompt` is true.",
    ]);
    expect(
      image.safe({ endpoint: id, prompt: "x", enhance_prompt: true, preset_id: "c2143317-f28d-4c3c-a0b8-39bd547e08a7", image_urls: ["https://example.com/a.png"] }).ok,
    ).toBe(true);
    // An omitted `enhance_prompt` is not held to the branch.
    expect(image.safe({ endpoint: id, prompt: "x" }).ok).toBe(true);
  });

  test("AI Influencer: a request that omits `tier` is held to the default tier's rule", () => {
    const id = "higgsfield/ai-influencer";
    expect(image.safe({ endpoint: id }).ok).toBe(true);
    const result = image.safe({ endpoint: id, pinned_species: "frog" });
    expect(!result.ok && result.errors.map((issue) => issue.path)).toContainEqual(["pinned_species"]);
    expect(image.safe({ endpoint: id, tier: "insects", pinned_species: "frog" }).ok).toBe(true);
  });

  test("Z-Image Turbo: 801 characters is inside one schema and outside the other, so it is reported and sent", () => {
    const result = image.safe({ endpoint: "z-image/turbo", prompt: "a".repeat(801) });
    expect(result.ok && result.warnings.map((issue) => [issue.severity, issue.path])).toEqual([["warning", ["prompt"]]]);
    expect(image.safe({ endpoint: "z-image/turbo", prompt: "a".repeat(2501) }).ok).toBe(false);
  });

  test("a prompt of whitespace fails the pattern the route publishes", () => {
    const result = image.safe({ endpoint: "kling-image/v4.0/text-to-image", prompt: "   " });
    expect(!result.ok && result.errors.map((issue) => issue.meta?.["pattern"])).toEqual(["\\S"]);
  });
});
