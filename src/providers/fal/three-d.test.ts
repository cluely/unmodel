/**
 * `fal.threeD` — the wire contract of the tenth and last verb.
 *
 * Most of the routing contract is `fal.image`'s (stripping, degradation,
 * `.toSdk`), asserted there and not repeated. What is asserted HERE is what is
 * particular to this address: the reference image has FOUR wire spellings and
 * one of them is a list, the geometry seed has two, one endpoint publishes a
 * real `model` body field, and the category is the first whose `required` list
 * is a genuine either/or across sibling routes rather than a fixed field.
 */

import { describe, expect, test } from "bun:test";
import { threeD } from "./three-d";
import { FAL_THREE_D_ENDPOINTS } from "./gen/endpoints.gen";
import type { ModelInfo } from "../../core/catalog-types";
import { threeDModels } from "./gen/models-three-d.gen";
import { FAL_THREE_D_SHAPES } from "./gen/three-d-narrow.gen";
import { FAL_THREE_D_PARAM_SHAPES } from "./gen/three-d-params.gen";

const PHOTO = "https://example.com/chair.png";
const PROMPT = "a brass astrolabe on a walnut stand";

/** The catalog slice, widened to `ModelInfo` — see `src/providers/fal/stt.test.ts`. */
const CATALOG = threeDModels as Readonly<Record<string, ModelInfo>>;

const SHAPES = FAL_THREE_D_SHAPES as Readonly<
  Record<string, { props: Record<string, unknown>; order: readonly string[] }>
>;

const ROWS = FAL_THREE_D_PARAM_SHAPES as Readonly<
  Record<string, { inputs?: readonly string[]; imageWire?: string; imageWireList?: true }>
>;

/** The one required input each endpoint takes, in whichever mood it reads. */
function minimal(endpoint: string): Record<string, unknown> {
  const row = ROWS[endpoint];
  const wire = row?.imageWire;
  if (row?.inputs?.includes("image") === true && wire !== undefined) {
    return { [wire]: row.imageWireList === true ? [PHOTO] : PHOTO };
  }
  return { prompt: PROMPT };
}

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_THREE_D_ENDPOINTS) {
      const params = threeD({ endpoint, ...minimal(endpoint) } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
      expect(Object.keys(params)).not.toContain("endpoint");
    }
  });

  test("the vendor-namespaced ids route to the PUBLISHED id", () => {
    // Four of the seven vendors here namespace their own ids rather than
    // sitting under `fal-ai/` — the `ideogram/v4` precedent, three categories
    // over. The id unmodel submits to is the one fal publishes and catalogues.
    for (const endpoint of ["tripo3d/h3.1/text-to-3d", "meshy/v7/text-to-3d"]) {
      expect(threeD({ endpoint, prompt: PROMPT } as never).request.url).toBe(
        `https://queue.fal.run/${endpoint}`,
      );
    }
    expect(
      threeD({ endpoint: "hitem3d/hi3d/v3.0/image-to-3d", image_url: PHOTO } as never).request.url,
    ).toBe("https://queue.fal.run/hitem3d/hi3d/v3.0/image-to-3d");
  });
});

describe("the two moods", () => {
  test("nine endpoints are told what to build in words and ten are shown", () => {
    const text = FAL_THREE_D_ENDPOINTS.filter((id) => ROWS[id]?.inputs?.includes("text") === true);
    const image = FAL_THREE_D_ENDPOINTS.filter((id) => ROWS[id]?.inputs?.includes("image") === true);
    // Every endpoint reads at least one, which is what the generator enforces:
    // a 3D route told nothing about what to build is a curation error.
    for (const id of FAL_THREE_D_ENDPOINTS) {
      expect((ROWS[id]?.inputs ?? []).length, id).toBeGreaterThan(0);
    }
    expect(text.length + image.length).toBeGreaterThan(FAL_THREE_D_ENDPOINTS.length);
  });

  test("`fal-ai/hyper3d/rodin/v2.5` reads BOTH, and is the only one that does", () => {
    const both = FAL_THREE_D_ENDPOINTS.filter(
      (id) => ROWS[id]?.inputs?.length === 2,
    );
    expect(both).toEqual(["fal-ai/hyper3d/rodin/v2.5"]);
    // Both fields on one body, and fal marks neither required.
    const params = threeD({
      endpoint: "fal-ai/hyper3d/rodin/v2.5",
      prompt: PROMPT,
      image_urls: [PHOTO],
    } as never);
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      prompt: PROMPT,
      image_urls: [PHOTO],
    });
  });

  test("a prompt handed to a reconstruction route is an unknown param", () => {
    const result = threeD.safe({
      endpoint: "fal-ai/trellis",
      image_url: PHOTO,
      prompt: PROMPT,
    } as never);
    // TRELLIS declares no `prompt`; the schema is loose, so this is a warning
    // from `checkKnownParams` naming the endpoint's own declared list.
    const issue = result.warnings.find((i) => i.path?.[0] === "prompt");
    expect(issue?.code).toBe("unknown_param");
    expect(issue?.message).toContain("fal-ai/trellis");
  });

  test("a route missing its required input is refused by name", () => {
    const bad = threeD.safe({ endpoint: "tripo3d/h3.1/text-to-3d" } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((i) => i.path?.[0] === "prompt");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("required");
  });
});

describe("the image has four wire spellings", () => {
  test("each endpoint's own spelling round-trips onto the body", () => {
    const cases: Array<[endpoint: string, wire: string]> = [
      ["fal-ai/trellis", "image_url"],
      ["fal-ai/hunyuan3d/v2", "input_image_url"],
      ["tripo3d/tripo/v2.5/multiview-to-3d", "front_image_url"],
      ["fal-ai/hyper3d/rodin/v2.5", "image_urls"],
    ];
    for (const [endpoint, wire] of cases) {
      expect(ROWS[endpoint]?.imageWire, endpoint).toBe(wire);
      expect(SHAPES[endpoint]?.props[wire], `${endpoint}.${wire}`).toBeDefined();
    }
  });

  test("only Rodin's is a LIST, which is what the row's flag says", () => {
    const lists = FAL_THREE_D_ENDPOINTS.filter((id) => ROWS[id]?.imageWireList === true);
    expect(lists).toEqual(["fal-ai/hyper3d/rodin/v2.5"]);
    const params = threeD({
      endpoint: "fal-ai/hyper3d/rodin/v2.5",
      image_urls: [PHOTO, PHOTO],
    } as never);
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ image_urls: [PHOTO, PHOTO] });
  });
});

describe("the `model` field that is not the route", () => {
  test("`model` stays on the wire while `endpoint` routes", () => {
    const params = threeD({
      endpoint: "hitem3d/hi3d/v3.0/image-to-3d",
      image_url: PHOTO,
      model: "hi3dv3.0",
    } as never);
    expect(Object.keys(params)).toContain("model");
    expect(Object.keys(params)).not.toContain("endpoint");
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ model: "hi3dv3.0" });
    expect(params.request.url).toBe("https://queue.fal.run/hitem3d/hi3d/v3.0/image-to-3d");
  });

  test("it is the only endpoint in the category that declares one", () => {
    const withModel = FAL_THREE_D_ENDPOINTS.filter(
      (id) => SHAPES[id]?.props["model"] !== undefined,
    );
    expect(withModel).toEqual(["hitem3d/hi3d/v3.0/image-to-3d"]);
  });
});

describe("catalog", () => {
  test("every curated endpoint has a row, and every row outputs 3d", () => {
    for (const endpoint of FAL_THREE_D_ENDPOINTS) {
      const row = CATALOG[endpoint];
      expect(row, endpoint).toBeDefined();
      expect(row?.modalities.output, endpoint).toEqual(["3d"]);
      // Not a token model: the pipeline skips context checks when this is 0.
      expect(row?.limit.context, endpoint).toBe(0);
    }
    expect(Object.keys(CATALOG).length).toBe(FAL_THREE_D_ENDPOINTS.length);
  });

  test("no row carries a `cost`, and that is the honest answer", () => {
    // Sixteen of the nineteen publish a CONDITIONAL rate (the price turns on
    // whether textures were asked for, and at Tripo on three more switches),
    // which `ModelCost` cannot express; the other three are a flat
    // per-generation rate, which it also cannot express — `perImage` is an
    // IMAGE rate and a mesh is not an image. So the rates live in the hand
    // pricing table and reach a caller as an estimate.
    for (const endpoint of FAL_THREE_D_ENDPOINTS) {
      expect(CATALOG[endpoint]?.cost, endpoint).toBeUndefined();
    }
  });
});

describe("cost", () => {
  test("the two flat-rate endpoints estimate, and they are the cheap ones", () => {
    const trellis = threeD.safe({ endpoint: "fal-ai/trellis", image_url: PHOTO } as never);
    expect(trellis.ok).toBe(true);
    if (!trellis.ok) return;
    expect(trellis.estimate?.costUSD).toBeCloseTo(0.02, 8);

    const triposr = threeD.safe({ endpoint: "fal-ai/triposr", image_url: PHOTO } as never);
    expect(triposr.ok).toBe(true);
    if (!triposr.ok) return;
    expect(triposr.estimate?.costUSD).toBeCloseTo(0.07, 8);
  });

  test("a conditional rate declines rather than picking a tier", () => {
    // Hunyuan3D charges $0.16 for a white mesh and $0.48 with textures — three
    // times, by its own field description. A scalar would be wrong by 3x for
    // half the requests.
    const result = threeD.safe({ endpoint: "fal-ai/hunyuan3d/v2", input_image_url: PHOTO } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });

  test("an endpoint fal publishes no rate for declines too", () => {
    const result = threeD.safe({
      endpoint: "fal-ai/hunyuan3d/v2/turbo",
      input_image_url: PHOTO,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("per-endpoint constraints", () => {
  test("a range is checked from the endpoint's own IR", () => {
    // TRELLIS's `mesh_simplify` is 0.9–0.98; 2 is far outside it.
    const bad = threeD.safe({
      endpoint: "fal-ai/trellis",
      image_url: PHOTO,
      mesh_simplify: 2,
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((i) => i.path?.[0] === "mesh_simplify")).toBe(true);
  });

  test("an unknown endpoint degrades to a warning and still routes", () => {
    const result = threeD.safe({
      endpoint: "fal-ai/not-a-3d-model",
      prompt: PROMPT,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/not-a-3d-model");
    expect(result.warnings.some((i) => i.code === "unknown_model")).toBe(true);
  });
});
