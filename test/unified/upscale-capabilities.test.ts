/**
 * The capability table for `unmodel/upscale`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, for its lipsync sibling's reason: at
 * fal the route is a parameter, so "which fields does this support" is a
 * per-ENDPOINT question and a per-provider table would answer it ten ways at
 * once. Unlike lipsync, though, the ten rows here genuinely disagree with each
 * other — which is the point of the category and the reason it narrows two
 * fields rather than one.
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

type Support = "native" | "unsupported";

interface Capability {
  ref: string;
  /** The wire field the source lands in, and which medium it carries. */
  source: { at: "image_url" | "video_url"; kind: "image" | "video" };
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
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 4] },
    prompt: "native",
    creativity: "creativity",
  },
  "topaz/precision": {
    ref: "fal/topaz/upscale/image/precision",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 4] },
    // A restoration network rather than a generator: it has no prompt at all,
    // and that is the difference from its `generative` sibling below.
    prompt: "unsupported",
    creativity: undefined,
  },
  "topaz/generative": {
    ref: "fal/topaz/upscale/image/generative",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 4] },
    prompt: "native",
    creativity: "creativity",
  },
  esrgan: {
    ref: "fal/fal-ai/esrgan",
    source: { at: "image_url", kind: "image" },
    // The second spelling, and the reason the row states the wire name rather
    // than the adapter assuming one.
    factor: { at: "scale", range: [1, 8] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "aura-sr": {
    ref: "fal/fal-ai/aura-sr",
    source: { at: "image_url", kind: "image" },
    // A `const 4` in the schema: it upscales by four or not at all.
    factor: { at: "upscale_factor", only: [4] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "seedvr/image": {
    ref: "fal/fal-ai/seedvr/upscale/image",
    source: { at: "image_url", kind: "image" },
    factor: { at: "upscale_factor", range: [1, 10] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "seedvr/video": {
    ref: "fal/fal-ai/seedvr/upscale/video",
    // The same vendor's same product, one path over, taking a CLIP. This pair
    // is why `sources` is a narrowing here rather than a constant.
    source: { at: "video_url", kind: "video" },
    factor: { at: "upscale_factor", range: [1, 10] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "recraft/crisp": {
    ref: "fal/fal-ai/recraft/upscale/crisp",
    source: { at: "image_url", kind: "image" },
    // The empty-`factors` arm: this route picks its own output size.
    factor: "unsupported",
    prompt: "unsupported",
    creativity: undefined,
  },
  "topaz/video": {
    ref: "fal/topaz/upscale/video/precision",
    source: { at: "video_url", kind: "video" },
    factor: { at: "upscale_factor", range: [1, 4] },
    prompt: "unsupported",
    creativity: undefined,
  },
  "flux-video-upscale": {
    ref: "fal/blackforestlabs/flux-video-upscale",
    source: { at: "video_url", kind: "video" },
    // The narrowest range in the roster, and it does not start at 1.
    factor: { at: "upscale_factor", range: [1.5, 3] },
    prompt: "native",
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

test("the table covers exactly the endpoints the adapter serves", () => {
  expect(rows.map(([, row]) => row.ref.slice("fal/".length)).sort()).toEqual([...fal.models].sort());
});

test("the pack registers exactly one provider", () => {
  expect([...upscale.providers]).toEqual(["fal"]);
});

describe.each(rows)("%s", (name, row) => {
  test(`the source lands at \`${row.source.at}\``, () => {
    const compiled = compile(row);
    expect(compiled, `${name} could not compile a minimal request`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.source.at]).toBe(row.source.kind === "video" ? CLIP.url : STILL.url);
    expect(compiled.url).toBe(`https://queue.fal.run/${row.ref.slice("fal/".length)}`);
  });

  test("inline bytes are DERIVED into a data: URI, never dropped", () => {
    const mimeType = row.source.kind === "video" ? "video/mp4" : "image/png";
    const compiled = compile(row, {
      source: { data: "AAAA", mimeType },
    } as Partial<UpscaleParams>);
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.source.at]).toBe(`data:${mimeType};base64,AAAA`);
  });

  test("inline bytes with no media type are refused, not guessed", () => {
    // A `data:;base64,` string is a 400 at every one of these routes, so the
    // refusal names the field rather than building one.
    expect(compile(row, { source: { data: "AAAA" } } as Partial<UpscaleParams>)).toEqual([
      "invalid_shape @ source",
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
  const declared = Object.values(fal.modelParams).map((entry) => [...(entry.sources ?? [])]);
  expect(declared.every((sources) => sources.length === 1)).toBe(true);
  expect([...new Set(declared.flat())].sort()).toEqual(["image", "video"]);
  // …and the table agrees with the rows, which is what stops this file from
  // becoming a second, drifting declaration of the same fact.
  for (const [, row] of rows) {
    const sources = fal.modelParams[row.ref.slice("fal/".length) as never] as
      | { sources?: readonly string[] }
      | undefined;
    expect(sources?.sources).toEqual([row.source.kind]);
  }
});

/** And that `factors` really does carry all three of its states. */
test("the factor row exercises range, closed set and absent", () => {
  const kinds = rows.map(([, row]) =>
    row.factor === "unsupported" ? "absent" : "only" in row.factor ? "closed" : "range",
  );
  expect([...new Set(kinds)].sort()).toEqual(["absent", "closed", "range"]);
});
