/**
 * The capability table for `unmodel/upscale`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, for its lipsync sibling's reason: at
 * fal the route is a parameter, so "which fields does this support" is a
 * per-ENDPOINT question and a per-provider table would answer it ten ways at
 * once. Unlike lipsync, though, the rows here genuinely disagree with each
 * other — which is the point of the category and the reason it narrows two
 * fields rather than one.
 *
 * Two providers now, and the native half disagrees with the aggregator on the
 * two columns that matter most. Topaz has no `factor` AT ALL — it states an
 * absolute output size — where fal's resale of the very same models exposes an
 * `upscale_factor` with a 1–4 range; and Topaz refuses inline bytes where fal
 * derives a `data:` URI from them. Neither is a superset of the other, which is
 * what the `inline` and `factor` columns below exist to pin.
 *
 * The words mean what they mean everywhere else in this suite:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed (a `data:` URI built from inline bytes) |
 * | `unsupported` | this endpoint has no field for it; the adapter refuses it by name |
 */
import { describe, expect, test } from "bun:test";
import type { UpscaleParams } from "../../src/core/unified/vocabulary/upscale";
import { upscale } from "../../src/unified/upscale";
import { upscale as fal } from "../../src/providers/fal/unified-upscale";
import { upscale as topaz } from "../../src/providers/topaz/unified";

type Support = "native" | "unsupported";

interface Capability {
  ref: string;
  /** The POST this ref compiles to. */
  url: string;
  /** The wire field the source lands in, and which medium it carries. */
  source: { at: string; kind: "image" | "video" };
  /**
   * What happens to `{ data, mimeType }`.
   *
   * `derived` builds a `data:` URI; `unsupported` refuses by name. fal fetches
   * either; Topaz reads raw bytes only as a multipart file part, which
   * `UpscaleSource` has no way to carry.
   */
  inline: "derived" | "unsupported";
  /**
   * How the multiplier is expressed: a wire name plus a RANGE, a wire name plus
   * a closed SET, or nothing at all.
   */
  factor:
    | { at: string; range: [min: number, max: number] }
    | { at: string; only: readonly number[] }
    | "unsupported";
  prompt: Support;
  /** This endpoint's own dial for how much detail to invent, or none. */
  creativity: string | undefined;
}

const TABLE: Readonly<Record<string, Capability>> = {
  "clarity-upscaler": {
    ref: "fal/fal-ai/clarity-upscaler",
    url: "https://queue.fal.run/fal-ai/clarity-upscaler",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 4] },
    prompt: "native",
    creativity: "creativity",
  },
  "topaz/precision": {
    ref: "fal/topaz/upscale/image/precision",
    url: "https://queue.fal.run/topaz/upscale/image/precision",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 4] },
    // A restoration network rather than a generator: it has no prompt at all,
    // and that is the difference from its `generative` sibling below.
    prompt: "unsupported",
    creativity: undefined,
  },
  "topaz/generative": {
    ref: "fal/topaz/upscale/image/generative",
    url: "https://queue.fal.run/topaz/upscale/image/generative",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 4] },
    prompt: "native",
    creativity: "creativity",
  },
  esrgan: {
    ref: "fal/fal-ai/esrgan",
    url: "https://queue.fal.run/fal-ai/esrgan",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    // The second spelling, and the reason the row states the wire name rather
    // than the adapter assuming one.
    factor: { at: "scale", range: [1, 8] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "aura-sr": {
    ref: "fal/fal-ai/aura-sr",
    url: "https://queue.fal.run/fal-ai/aura-sr",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    // A `const 4` in the schema: it upscales by four or not at all.
    factor: { at: "upscale_factor", only: [4] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "seedvr/image": {
    ref: "fal/fal-ai/seedvr/upscale/image",
    url: "https://queue.fal.run/fal-ai/seedvr/upscale/image",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 10] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "seedvr/video": {
    ref: "fal/fal-ai/seedvr/upscale/video",
    url: "https://queue.fal.run/fal-ai/seedvr/upscale/video",
    inline: "derived",
    // The same vendor's same product, one path over, taking a CLIP. This pair
    // is why `sources` is a narrowing here rather than a constant.
    source: { at: "video_url", kind: "video" },
    factor: { at: "upscale_factor", range: [1, 10] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "recraft/crisp": {
    ref: "fal/fal-ai/recraft/upscale/crisp",
    url: "https://queue.fal.run/fal-ai/recraft/upscale/crisp",
    inline: "derived",
    source: { at: "image_url", kind: "image" },
    // The empty-`factors` arm: this route picks its own output size.
    factor: "unsupported",
    prompt: "unsupported",
    creativity: undefined,
  },
  "topaz/video": {
    ref: "fal/topaz/upscale/video/precision",
    url: "https://queue.fal.run/topaz/upscale/video/precision",
    inline: "derived",
    source: { at: "video_url", kind: "video" },
    factor: { at: "upscale_factor", range: [1, 4] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "flux-video-upscale": {
    ref: "fal/blackforestlabs/flux-video-upscale",
    url: "https://queue.fal.run/blackforestlabs/flux-video-upscale",
    inline: "derived",
    source: { at: "video_url", kind: "video" },
    // The narrowest range in the roster, and it does not start at 1.
    factor: { at: "upscale_factor", range: [1.5, 3] },
    prompt: "native",
    creativity: "creativity",
  },

  // ---- topaz, the native half ---------------------------------------------
  // Four of fifteen: one classic model, one classic model with its own extra
  // dials, and both generative families. The whole roster is swept by
  // `upscale-presets.test.ts`; this table is where the SHAPES are pinned.
  "topaz/standard-v2": {
    ref: "topaz/Standard V2",
    url: "https://api.topazlabs.com/image/v1/enhance/async",
    inline: "unsupported",
    source: { at: "source_url", kind: "image" },
    // The column that separates the two providers. `fal/topaz/upscale/image/
    // precision` above is this same product with a 1–4 `upscale_factor` bolted
    // on by the reseller; natively there is no multiplier anywhere.
    factor: "unsupported",
    prompt: "unsupported",
    creativity: undefined,
  },
  "topaz/text-refine": {
    ref: "topaz/Text Refine",
    url: "https://api.topazlabs.com/image/v1/enhance/async",
    inline: "unsupported",
    source: { at: "source_url", kind: "image" },
    factor: "unsupported",
    prompt: "unsupported",
    creativity: undefined,
  },
  "topaz/redefine": {
    ref: "topaz/Redefine",
    // The second URL. Topaz forks the route on the model, so the ref decides
    // the path — which is why `topaz.upscaleGenerative` is its own address.
    url: "https://api.topazlabs.com/image/v1/enhance-gen/async",
    inline: "unsupported",
    source: { at: "source_url", kind: "image" },
    factor: "unsupported",
    // The second independent witness for the canonical `prompt`, and the
    // reason the word survived the category gaining a provider.
    prompt: "native",
    creativity: "creativity",
  },
  "topaz/bloom-realism": {
    ref: "topaz/Bloom Realism",
    url: "https://api.topazlabs.com/image/v1/enhance-gen/async",
    inline: "unsupported",
    source: { at: "source_url", kind: "image" },
    factor: "unsupported",
    prompt: "native",
    // Same word as its siblings, narrower range: 1–4 where the endpoint's own
    // block says 1–9. The one per-model narrowing of a SHARED dial at Topaz.
    creativity: "creativity",
  },
};

const STILL = { url: "https://example.com/portrait.png" } as const;
const CLIP = { url: "https://example.com/take-3.mp4" } as const;
const PROBE_PROMPT = "sharp fabric weave, natural skin texture";

interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<UpscaleParams> = {}): Compiled | string[] {
  const result = upscale.safe({
    model: row.ref,
    source: row.source.kind === "video" ? CLIP : STILL,
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
  };
}

const rows = Object.entries(TABLE);

/** The bare model id a ref points at. */
const bare = (ref: string): string => ref.slice(ref.indexOf("/") + 1);

const providerOf = (ref: string): string => ref.slice(0, ref.indexOf("/"));

test("the table covers every fal endpoint, and names both providers", () => {
  const falRefs = rows.filter(([, row]) => providerOf(row.ref) === "fal");
  expect(falRefs.map(([, row]) => bare(row.ref)).sort()).toEqual([...fal.models].sort());
  // Topaz is sampled rather than exhausted — fifteen models across two routes,
  // whose whole roster `upscale-presets.test.ts` sweeps. What this table pins
  // is that every SHAPE it has is represented.
  const topazRefs = rows.filter(([, row]) => providerOf(row.ref) === "topaz");
  expect(topazRefs.length).toBeGreaterThanOrEqual(4);
  const topazModels: readonly string[] = topaz.models;
  for (const [, row] of topazRefs) expect(topazModels).toContain(bare(row.ref));
  expect([...new Set(rows.map(([, row]) => providerOf(row.ref)))].sort()).toEqual([
    ...upscale.providers,
  ]);
});

test("the pack registers exactly two providers", () => {
  expect([...upscale.providers]).toEqual(["fal", "topaz"]);
});

describe.each(rows)("%s", (name, row) => {
  test(`the source lands at \`${row.source.at}\``, () => {
    const compiled = compile(row);
    expect(compiled, `${name} could not compile a minimal request`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.source.at]).toBe(row.source.kind === "video" ? CLIP.url : STILL.url);
    expect(compiled.url).toBe(row.url);
  });

  test(`inline bytes are ${row.inline}`, () => {
    const mimeType = row.source.kind === "video" ? "video/mp4" : "image/png";
    const compiled = compile(row, {
      source: { data: "AAAA", mimeType },
    } as Partial<UpscaleParams>);
    if (row.inline === "unsupported") {
      // Topaz reads raw bytes as the multipart `image` file part and fetches
      // `source_url` as a URL; a `data:` string in that field is a fetch it
      // would fail. Refused by name, naming the hand surface that can take a
      // Blob.
      expect(compiled).toEqual(["unsupported_param @ source"]);
      return;
    }
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.source.at]).toBe(`data:${mimeType};base64,AAAA`);
  });

  test("inline bytes with no media type are refused, not guessed", () => {
    // A `data:;base64,` string is a 400 at every one of these routes, so the
    // refusal names the field rather than building one. At the routes that take
    // no bytes at all the refusal comes one step earlier and says so instead.
    expect(compile(row, { source: { data: "AAAA" } } as Partial<UpscaleParams>)).toEqual([
      row.inline === "unsupported" ? "unsupported_param @ source" : "invalid_shape @ source",
    ]);
  });

  test(`factor is ${row.factor === "unsupported" ? "unsupported" : `\`${row.factor.at}\``}`, () => {
    if (row.factor === "unsupported") {
      expect(compile(row, { factor: 2 })).toEqual(["unsupported_param @ factor"]);
      return;
    }
    if ("only" in row.factor) {
      const good = compile(row, { factor: row.factor.only[0] as number });
      expect(good).not.toBeInstanceOf(Array);
      if (Array.isArray(good)) return;
      expect(good.body[row.factor.at]).toBe(row.factor.only[0] as number);
      // A multiplier outside the closed set is a named refusal, not a snap.
      expect(compile(row, { factor: 3 })).toEqual(["invalid_enum_value @ factor"]);
      return;
    }
    const [min, max] = row.factor.range;
    const inside = compile(row, { factor: max });
    expect(inside).not.toBeInstanceOf(Array);
    if (Array.isArray(inside)) return;
    expect(inside.body[row.factor.at]).toBe(max);
    // The floor is real too, and the ceiling is checked by fal's own IR rather
    // than by this adapter — which is the split the whole provider is built on.
    const above = compile(row, { factor: max + 1 });
    expect(above, `${name} accepted ${max + 1}× past its ceiling`).toBeInstanceOf(Array);
    if (min > 1) {
      expect(compile(row, { factor: 1 }), `${name} accepted 1× below its floor`).toBeInstanceOf(
        Array,
      );
    }
  });

  test(`prompt is ${row.prompt}`, () => {
    const compiled = compile(row, { prompt: PROBE_PROMPT });
    if (row.prompt === "unsupported") {
      expect(compiled).toEqual(["unsupported_param @ prompt"]);
      return;
    }
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body["prompt"]).toBe(PROBE_PROMPT);
  });

  test("the creativity dial is this endpoint's own word, or none", () => {
    const compiled = compile(row, { creativity: 1 } as never);
    if (row.creativity === undefined) {
      // Not this endpoint's word: refused by the kernel's envelope check or by
      // the extras check. Either way it must not reach the wire silently.
      if (!Array.isArray(compiled)) {
        expect(compiled.body["creativity"], `${name} accepted a dial it does not declare`)
          .toBeUndefined();
      }
      return;
    }
    expect(compiled, `${name} should take ${row.creativity}`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.creativity]).toBe(1);
  });
});

/**
 * The property that has to hold for every cell, not just the probed ones: a
 * canonical word is either **refused** or **sent**. Never accepted and ignored.
 */
describe("no silent drops, over the whole vocabulary", () => {
  test.each(rows)("%s", (name, row) => {
    const bare = compile(row);
    expect(bare).not.toBeInstanceOf(Array);
    if (Array.isArray(bare)) return;
    const baseline = JSON.stringify(bare);

    const mimeType = row.source.kind === "video" ? "video/webm" : "image/webp";
    const probes: Array<Partial<UpscaleParams>> = [
      { factor: 2 },
      { factor: 4 },
      { prompt: PROBE_PROMPT },
      { source: { data: "AAAA", mimeType } } as Partial<UpscaleParams>,
      { source: { data: `data:${mimeType};base64,BBBB` } } as Partial<UpscaleParams>,
    ];
    const dropped: string[] = [];
    for (const probe of probes) {
      const compiled = compile(row, probe);
      if (Array.isArray(compiled)) continue; // refused — the other half
      if (JSON.stringify(compiled) === baseline) dropped.push(JSON.stringify(probe));
    }
    expect(dropped, `${name} accepted and ignored a param`).toEqual([]);
  });
});

/**
 * The category's own boundary, asserted from the generated rows rather than
 * from prose: this is the ONE category where `sources` is a real narrowing
 * across the roster rather than the same answer repeated.
 */
test("both source shapes are served, and every row names exactly one", () => {
  const ROWS = { ...fal.modelParams, ...topaz.modelParams } as Readonly<
    Record<string, { readonly sources?: readonly string[] }>
  >;
  const declared = Object.values(ROWS).map((entry) => [...(entry.sources ?? [])]);
  expect(declared.every((sources) => sources.length === 1)).toBe(true);
  expect([...new Set(declared.flat())].sort()).toEqual(["image", "video"]);
  // The clip half is fal's alone, and that is a fact about the PROVIDERS rather
  // than about the category: Topaz's video upscalers live behind a five-step
  // upload protocol its own API publishes separately, so `unmodel/upscale`
  // reaches them through the aggregator. See src/providers/topaz/models.ts.
  expect([...new Set(Object.values(topaz.modelParams).flatMap((r) => [...r.sources]))]).toEqual([
    "image",
  ]);
  // …and the table agrees with the rows, which is what stops this file from
  // becoming a second, drifting declaration of the same fact.
  for (const [, row] of rows) {
    const entry = ROWS[bare(row.ref)];
    expect(entry?.sources, row.ref).toEqual([row.source.kind]);
  }
});

/** And that `factors` really does carry all three of its states. */
test("the factor row exercises range, closed set and absent", () => {
  const kinds = rows.map(([, row]) =>
    row.factor === "unsupported" ? "absent" : "only" in row.factor ? "closed" : "range",
  );
  expect([...new Set(kinds)].sort()).toEqual(["absent", "closed", "range"]);
});

/**
 * The comparison the second provider exists to make: the SAME Topaz product,
 * reached two ways, disagreeing on the two columns a caller would notice.
 *
 * `fal/topaz/upscale/image/precision` and `topaz/Standard V2` are the same
 * vendor's precision upscaler. Through fal it takes a multiplier and inline
 * bytes; natively it takes neither, and takes an absolute output size and a
 * per-model dial table instead. Neither route is a superset — which is exactly
 * the fact `unmodel/upscale` exists to make cheap to see.
 */
test("the same Topaz product disagrees with itself through the two providers", () => {
  const viaFal = TABLE["topaz/precision"] as Capability;
  const natively = TABLE["topaz/standard-v2"] as Capability;

  expect(viaFal.factor).not.toBe("unsupported");
  expect(natively.factor).toBe("unsupported");
  expect(viaFal.inline).toBe("derived");
  expect(natively.inline).toBe("unsupported");
  expect(viaFal.source.at).toBe("image_url");
  expect(natively.source.at).toBe("source_url");

  // And the dials: fal publishes a flat, generic schema for its resale, while
  // Topaz's own per-model documentation is what `topaz/upscale-params.ts`
  // transcribes — none of which is in Topaz's OpenAPI document either.
  const nativeExtras = Object.keys(
    (topaz.modelParams["Standard V2"] as { extras: Record<string, unknown> }).extras,
  );
  for (const dial of ["faceEnhancement", "fixCompression", "strength", "output_width"]) {
    expect(nativeExtras, dial).toContain(dial);
  }
  const falExtras = Object.keys(
    (fal.modelParams["topaz/upscale/image/precision" as never] as {
      extras: Record<string, unknown>;
    }).extras,
  );
  expect(falExtras).not.toContain("faceEnhancement");
});
