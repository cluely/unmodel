/**
 * The capability table for `unmodel/image`, committed and then **probed**.
 *
 * The table below is the answer to "what does this provider do with each of the
 * eight canonical fields", written once, in one place, in five words:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed: reshaped, converted or re-spelled |
 * | `implicit` | accepted, and nothing is sent — because the provider only ever does this. Requires a `why` |
 * | `declared` | a provider-wide gap on the adapter's `unsupported` record; the kernel rejects it before compile |
 * | `refused` | a **model-dependent** gap: the sibling route has the field, so `compile` rejects it by hand |
 *
 * A table on its own is documentation that rots. Each row is therefore
 * asserted against behaviour:
 *
 * - `declared` must be **on the adapter** (so the kernel's uniform message
 *   applies) *and* actually rejected, at the canonical path;
 * - `refused` must be rejected at the canonical path and **not** declared —
 *   the distinction matters, because a field declared unsupported is refused
 *   for every model the adapter serves, and half of these providers serve two
 *   routes with different fields;
 * - `native` must compile **and** the probe value must appear verbatim in the
 *   request that comes out — body or url;
 * - `derived` must compile, must **not** carry the probe verbatim, and must
 *   change the request relative to the same request without the field;
 * - `implicit` must compile and change nothing, which is the one shape that
 *   looks exactly like a silent drop — so it is the only word that has to
 *   explain itself in the table.
 *
 * `size` gets its own column pair, because size is what this category is
 * actually about: which of the six derivation classes a shape lands in, and
 * under which wire key. That is what makes "S1–S6 are all covered" checkable
 * rather than a claim in a commit message.
 */
import { describe, expect, test } from "bun:test";
import type { ImageParams } from "../../src/core/unified/vocabulary/image";
import { image } from "../../src/unified/image";
import { image as blackForestLabs } from "../../src/providers/black-forest-labs/unified";
import { image as bria } from "../../src/providers/bria/unified";
import { image as bytedance } from "../../src/providers/bytedance/unified-image";
import { image as google } from "../../src/providers/google/unified-image";
import { image as ideogram } from "../../src/providers/ideogram/unified";
import { image as kling } from "../../src/providers/kling/unified-image";
import { image as krea } from "../../src/providers/krea/unified";
import { image as leonardo } from "../../src/providers/leonardo/unified";
import { image as luma } from "../../src/providers/luma/unified-image";
import { image as openai } from "../../src/providers/openai/unified";
import { image as recraft } from "../../src/providers/recraft/unified";
import { image as reve } from "../../src/providers/reve/unified";
import { image as runway } from "../../src/providers/runway/unified-image";
import { image as stability } from "../../src/providers/stability/unified";
import { image as vidu } from "../../src/providers/vidu/unified-image";

type Support = "native" | "derived" | "implicit" | "declared" | "refused";

/** The six size vocabularies, named for the `derive.ts` function that speaks them. */
type SizeClass =
  /** S1 `toRatioEnum` — a closed list of ratio spellings. */
  | "ratio-enum"
  /** S2 `toPixels` — a grid-snapped `width`/`height` pair. */
  | "pixels"
  /** S3 `toSizeEnum` — a closed list of `WxH` strings. */
  | "size-enum"
  /** S4 `toSizeFreeform` — an arbitrary `WxH` within bounds. */
  | "size-freeform"
  /** S5 `toRatioString` — any `W:H` inside a numeric range. */
  | "ratio-string";

interface Capability {
  ref: string;
  /** The adapter, so the `declared` column can be checked against data. */
  adapter: Readonly<{
    provider: string;
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  /**
   * Canonical params every probe for this provider must carry. Krea is the
   * only entry that needs one: `aspect_ratio` is required on its wire and it
   * documents no default, so a request without one is (correctly) refused
   * before any other row could be observed.
   */
  base?: Partial<ImageParams>;
  /** Where the shape lands, and which vocabulary it lands in. */
  size: { class: SizeClass; at: string };
  /** Where a tier lands, or `null` when the provider has no field for one. */
  tier: string | null;
  aspectRatio: Support;
  dimensions: Support;
  resolution: Support;
  n: Support;
  seed: Support;
  negativePrompt: Support;
  outputFormat: Support;
  /** The two deliveries are separate rows: most providers offer exactly one. */
  deliveryUrl: Support;
  deliveryBase64: Support;
  /**
   * Cells whose probe compiles **and** emits a translation warning — a value
   * the provider expresses only approximately. Listed rather than folded into
   * `derived`, because "the number reached the wire" and "the number means
   * something slightly different there" are independent facts: ModelArk takes
   * `n: 2` verbatim as `max_images` and still cannot promise two images.
   */
  warns?: readonly string[];
  /** Required whenever any row above is `implicit`. */
  why?: Partial<Record<string, string>>;
}

/**
 * One row per provider, ordered as `src/unified/image.ts` registers them, so
 * the two lists read the same way.
 */
const TABLE: Readonly<Record<string, Capability>> = {
  openai: {
    ref: "openai/gpt-image-2",
    adapter: openai,
    size: { class: "size-freeform", at: "size" },
    tier: "size",
    aspectRatio: "derived",
    dimensions: "derived",
    resolution: "derived",
    n: "native",
    seed: "declared",
    negativePrompt: "declared",
    outputFormat: "native",
    deliveryUrl: "refused",
    deliveryBase64: "implicit",
    why: { deliveryBase64: "the GPT image models have no `response_format` — they always return base64" },
  },
  google: {
    ref: "google/imagen-4.0-generate-001",
    adapter: google,
    size: { class: "ratio-enum", at: "parameters" },
    tier: "parameters",
    aspectRatio: "native",
    dimensions: "declared",
    resolution: "derived",
    n: "native",
    seed: "declared",
    negativePrompt: "declared",
    outputFormat: "derived",
    deliveryUrl: "refused",
    deliveryBase64: "implicit",
    why: { deliveryBase64: "`:predict` answers with `bytesBase64Encoded`; the URL mode is Vertex-only" },
  },
  "black-forest-labs": {
    ref: "black-forest-labs/flux-2-pro",
    adapter: blackForestLabs,
    size: { class: "pixels", at: "width" },
    tier: "width",
    aspectRatio: "derived",
    dimensions: "native",
    resolution: "derived",
    n: "declared",
    seed: "native",
    negativePrompt: "declared",
    outputFormat: "native",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
  },
  ideogram: {
    ref: "ideogram/ideogram-3.0-quality",
    adapter: ideogram,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: null,
    aspectRatio: "derived",
    dimensions: "derived",
    resolution: "implicit",
    n: "native",
    seed: "native",
    negativePrompt: "native",
    outputFormat: "declared",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
    why: {
      resolution:
        "every value in the 69-entry `RESOLUTIONS` list is ~1 MP, so `1k` is an assertion that " +
        "already holds and there is no tier field to send; 2k/4k are errors",
    },
  },
  recraft: {
    ref: "recraft/recraftv4_1",
    adapter: recraft,
    size: { class: "ratio-enum", at: "size" },
    tier: null,
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "implicit",
    n: "native",
    seed: "native",
    negativePrompt: "refused",
    outputFormat: "native",
    deliveryUrl: "native",
    deliveryBase64: "derived",
    why: {
      resolution:
        "the tier is expressed by choosing the model — there is no pixel-budget field — so a " +
        "matching tier is checked against the model and nothing is sent; a mismatch is an error",
    },
  },
  stability: {
    ref: "stability/stable-image-ultra",
    adapter: stability,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: null,
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "implicit",
    n: "declared",
    seed: "native",
    negativePrompt: "native",
    outputFormat: "native",
    deliveryUrl: "refused",
    deliveryBase64: "implicit",
    warns: ["dimensions"],
    why: {
      resolution:
        "ultra always returns 1 megapixel and has no size field, so `1k` is exact and unsendable; " +
        "core is 1.5 MP and warns, and 2k/4k are errors everywhere",
      deliveryBase64:
        "the generate routes answer with the image itself — raw bytes, or base64 inside JSON — " +
        "and never with a link, so inline delivery needs no field",
    },
  },
  luma: {
    ref: "luma/photon-1",
    adapter: luma,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: null,
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "declared",
    n: "declared",
    seed: "declared",
    negativePrompt: "declared",
    outputFormat: "native",
    deliveryUrl: "implicit",
    deliveryBase64: "refused",
    warns: ["dimensions"],
    why: { deliveryUrl: "the Dream Machine job's result is a URL; there is no delivery field to set" },
  },
  bytedance: {
    ref: "bytedance/seedream-4-0-250828",
    adapter: bytedance,
    size: { class: "size-freeform", at: "size" },
    tier: "size",
    aspectRatio: "derived",
    dimensions: "derived",
    resolution: "derived",
    n: "native",
    seed: "declared",
    negativePrompt: "declared",
    outputFormat: "refused",
    deliveryUrl: "native",
    deliveryBase64: "derived",
    warns: ["n"],
  },
  runway: {
    ref: "runway/gen4_image",
    adapter: runway,
    base: { aspectRatio: "1:1" },
    size: { class: "ratio-enum", at: "ratio" },
    tier: "ratio",
    aspectRatio: "derived",
    dimensions: "derived",
    resolution: "implicit",
    n: "refused",
    seed: "native",
    negativePrompt: "declared",
    outputFormat: "refused",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
    warns: ["dimensions"],
    why: {
      resolution:
        "`ratio` carries the size as well as the shape, so a tier selects which bucket of pixel " +
        "pairs the shape is matched against; gen4_image is 1k-only, so 1k changes nothing",
    },
  },
  kling: {
    ref: "kling/kling-v2-1",
    adapter: kling,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: "resolution",
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "native",
    n: "native",
    seed: "declared",
    negativePrompt: "native",
    outputFormat: "declared",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
    warns: ["dimensions"],
  },
  vidu: {
    ref: "vidu/viduq2",
    adapter: vidu,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: "resolution",
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "derived",
    n: "declared",
    seed: "native",
    negativePrompt: "declared",
    outputFormat: "declared",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
    warns: ["dimensions"],
  },
  bria: {
    ref: "bria/FIBO",
    adapter: bria,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: "resolution",
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "derived",
    n: "declared",
    seed: "native",
    negativePrompt: "native",
    outputFormat: "native",
    deliveryUrl: "implicit",
    deliveryBase64: "refused",
    warns: ["dimensions"],
    why: { deliveryUrl: "the generate routes answer 202 with a `status_url`; the result carries image URLs" },
  },
  leonardo: {
    ref: "leonardo/lucid-origin",
    adapter: leonardo,
    size: { class: "pixels", at: "parameters" },
    tier: "parameters",
    aspectRatio: "derived",
    dimensions: "native",
    resolution: "derived",
    n: "native",
    seed: "native",
    negativePrompt: "refused",
    outputFormat: "declared",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
  },
  krea: {
    ref: "krea/krea-2/large",
    adapter: krea,
    base: { aspectRatio: "1:1" },
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: "resolution",
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "implicit",
    n: "declared",
    seed: "native",
    negativePrompt: "declared",
    outputFormat: "declared",
    deliveryUrl: "declared",
    deliveryBase64: "declared",
    warns: ["dimensions"],
    why: {
      resolution:
        "`resolution` is required and `KREA_RESOLUTIONS` has exactly one member, so `\"1K\"` is " +
        "already on the wire whether or not the caller named a tier",
    },
  },
  reve: {
    ref: "reve/reve-v2-create",
    adapter: reve,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    tier: null,
    aspectRatio: "native",
    dimensions: "derived",
    resolution: "declared",
    n: "declared",
    seed: "declared",
    negativePrompt: "declared",
    outputFormat: "declared",
    deliveryUrl: "refused",
    deliveryBase64: "implicit",
    warns: ["dimensions"],
    why: { deliveryBase64: "both create routes answer inline with the image; there is no delivery field" },
  },
};

/**
 * The probes, chosen so the row under test is the mapping and not the bounds:
 * `9:16` is on every ratio enum in the pack, `1344×768` is on every documented
 * size list *and* on every pixel grid in it (16, 8 and 32 all divide both
 * numbers), and `1k` is the one tier every provider that has a tier field can
 * reach. The dimensions probe is deliberately **not** square: at a provider
 * that keeps only the shape, a 1:1 probe would land on the same body as the
 * base request and the anti-silent-drop check would have nothing to see.
 */
const PROBE = {
  aspectRatio: "9:16",
  dimensions: { width: 1344, height: 768 },
  resolution: "1k",
  n: 2,
  seed: 7,
  negativePrompt: "blurry, low quality",
  outputFormat: "png",
} as const;

/** The compiled request, in the two places an image param can end up. */
interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<ImageParams>): Compiled | string[] {
  // `dimensions` and `aspectRatio` are the XOR pair, so a base shape has to
  // step aside for a dimensions probe rather than fight it.
  const base = "dimensions" in extra ? { ...row.base, aspectRatio: undefined } : row.base;
  const result = image.safe({
    model: row.ref,
    prompt: "A probe.",
    ...base,
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
  };
}

/** Does this exact value appear anywhere in the compiled request? */
function carries(compiled: Compiled, value: string | number): boolean {
  const wanted = String(value);
  let found = false;
  const walk = (node: unknown): void => {
    if (found) return;
    if (typeof node === "string" || typeof node === "number") {
      if (String(node) === wanted) found = true;
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const item of Object.values(node)) walk(item);
    }
  };
  walk(compiled.body);
  return found || compiled.url.includes(wanted);
}

/**
 * The whole request as one string, for the "it changed something" check.
 *
 * A `derived` row only says the caller's value is not on the wire verbatim —
 * which a **silent drop** also satisfies. Comparing the request against the
 * same request without the field is what tells the two apart, and it is the
 * one property the loss contract cannot be allowed to lose.
 */
function serialize(compiled: Compiled): string {
  return JSON.stringify([compiled.body, compiled.url]);
}

const rows = Object.entries(TABLE);

test("the table covers exactly the providers in the pack", () => {
  expect(rows.map(([provider]) => provider).sort()).toEqual([...image.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  const cells = [
    ["aspectRatio", row.aspectRatio, PROBE.aspectRatio, { aspectRatio: PROBE.aspectRatio }],
    ["dimensions", row.dimensions, PROBE.dimensions.width, { dimensions: PROBE.dimensions }],
    ["resolution", row.resolution, PROBE.resolution, { resolution: PROBE.resolution }],
    ["n", row.n, PROBE.n, { n: PROBE.n }],
    ["seed", row.seed, PROBE.seed, { seed: PROBE.seed }],
    ["negativePrompt", row.negativePrompt, PROBE.negativePrompt, { negativePrompt: PROBE.negativePrompt }],
    ["outputFormat", row.outputFormat, PROBE.outputFormat, { outputFormat: PROBE.outputFormat }],
    ["deliveryUrl", row.deliveryUrl, "url", { outputDelivery: "url" }],
    ["deliveryBase64", row.deliveryBase64, "base64", { outputDelivery: "base64" }],
  ] as const;

  test.each(cells)("%s is %s", (field, support, probe, extra) => {
    // `deliveryUrl` / `deliveryBase64` are two probes of one canonical field.
    const canonical = field.startsWith("delivery") ? "outputDelivery" : field;
    const declared = row.adapter.unsupported?.[canonical];

    if (support === "declared" || support === "refused") {
      if (support === "declared") {
        expect(declared, `${provider}.unsupported.${canonical}`).toBeDefined();
      } else {
        expect(
          declared,
          `${provider} must NOT declare ${canonical} unsupported — it is model-dependent`,
        ).toBeUndefined();
      }
      const compiled = compile(row, extra as Partial<ImageParams>);
      expect(Array.isArray(compiled), `${provider} accepted a ${field} it cannot express`).toBe(true);
      if (!Array.isArray(compiled)) return;
      // Rejected at the CANONICAL path — the whole point of `ctx.from`.
      expect(compiled.some((issue) => issue.endsWith(`@ ${canonical}`)), compiled.join("; ")).toBe(
        true,
      );
      return;
    }

    expect(declared, `${provider} must not declare ${canonical} unsupported`).toBeUndefined();

    const compiled = compile(row, extra as Partial<ImageParams>);
    expect(compiled, `${provider} could not compile a ${field} probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;

    const without = compile(row, {});
    const changed = Array.isArray(without) || serialize(compiled) !== serialize(without);

    if (support === "implicit") {
      // The one word that has to explain itself: nothing was sent, and the
      // reason it is not a silent drop is written down beside the cell.
      expect(row.why?.[field], `${provider}.why.${field} is required for an implicit cell`)
        .toBeDefined();
      expect(changed, `${provider} ${field} claims implicit but changed the request`).toBe(false);
      return;
    }

    expect(changed, `${provider} silently dropped ${field}`).toBe(true);
    expect(carries(compiled, probe), `${provider} ${field} verbatim`).toBe(support === "native");

    // Approximate or exact — the third fact about a cell, and the one the loss
    // contract is actually about.
    const result = image.safe({
      model: row.ref,
      prompt: "A probe.",
      ...("dimensions" in extra ? { ...row.base, aspectRatio: undefined } : row.base),
      ...extra,
    } as never);
    const warnings = result.ok
      ? (result.params as unknown as { warnings: readonly unknown[] }).warnings
      : [];
    expect(warnings.length > 0, `${provider} ${field} approximates`).toBe(
      row.warns?.includes(field) === true,
    );
  });

  test(`size lands as ${row.size.class} at \`${row.size.at}\``, () => {
    const compiled = compile(row, { aspectRatio: PROBE.aspectRatio });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const value = compiled.body[row.size.at];
    expect(value, `${provider} wrote nothing at ${row.size.at}`).toBeDefined();

    switch (row.size.class) {
      case "pixels": {
        // A pair of numbers, possibly one level down in a `parameters` object.
        const holder = (typeof value === "object" && value !== null ? value : compiled.body) as
          Record<string, unknown>;
        expect(typeof holder["width"]).toBe("number");
        expect(typeof holder["height"]).toBe("number");
        break;
      }
      case "size-enum":
      case "size-freeform":
        expect(String(value)).toMatch(/^\d+x\d+$/);
        break;
      case "ratio-string":
        expect(String(value)).toMatch(/^\d+:\d+$/);
        break;
      default: {
        // A ratio enum, in whatever spelling this provider uses — Ideogram's
        // `9x16`, Runway's `720:1280`, everyone else's `9:16`. Possibly one
        // level down, in google's `parameters`.
        const rendered =
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
        expect(rendered).toMatch(/\d+\s*[:x]\s*\d+|auto/);
      }
    }
  });

  test(
    row.tier === null
      ? "has no tier field, and says so"
      : `a tier lands at \`${row.tier as string}\``,
    () => {
      const compiled = compile(row, {
        ...(row.base?.aspectRatio === undefined && { aspectRatio: PROBE.aspectRatio }),
        resolution: PROBE.resolution,
      } as Partial<ImageParams>);
      if (row.tier === null) {
        // Either refused outright, or absorbed with no field of its own —
        // both are honest, and which one is the `resolution` cell above.
        expect(["declared", "implicit"]).toContain(row.resolution);
        return;
      }
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      expect(compiled.body[row.tier]).toBeDefined();
    },
  );
});

test("every size class in the category is exercised by some provider", () => {
  const classes = new Set(rows.map(([, row]) => row.size.class));
  // `ratio-string` (S5) is black-forest-labs' ultra route, which is not the
  // ref this table probes — it is covered by the `ratio-21x9` golden case, and
  // named here so the gap is deliberate rather than forgotten.
  expect([...classes].sort()).toEqual(["pixels", "ratio-enum", "size-freeform"]);
  const S3 = image.safe({
    model: "openai/dall-e-3",
    prompt: "probe",
    aspectRatio: "1:1",
  } as never);
  expect(S3.ok && (S3.params as unknown as { size: string }).size).toBe("1024x1024");
  const S5 = image.safe({
    model: "black-forest-labs/flux-pro-1.1-ultra",
    prompt: "probe",
    aspectRatio: "21:9",
  } as never);
  expect(S5.ok && (S5.params as unknown as { aspect_ratio: string }).aspect_ratio).toBe("7:3");
});

test("every `implicit` cell in the table explains itself", () => {
  for (const [provider, row] of rows) {
    for (const [field, support] of Object.entries(row)) {
      if (support !== "implicit") continue;
      expect(row.why?.[field], `${provider}.why.${field}`).toBeTypeOf("string");
    }
  }
});

// ---------------------------------------------------------------------------
// The property that has to hold for every cell, not just the probed ones
// ---------------------------------------------------------------------------

const ALL_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "9:21",
  "5:4",
  "2.35:1",
] as const;
const ALL_TIERS = ["1k", "2k", "4k"] as const;
const ALL_FORMATS = ["png", "jpeg", "webp"] as const;
const ALL_DELIVERIES = ["url", "base64"] as const;

describe("no silent drops, over the whole sizing matrix", () => {
  /**
   * The one property the loss contract cannot survive losing: a canonical
   * field is either **refused** or **sent**. Never accepted and ignored.
   *
   * The probes above check one value per cell; this checks every ratio × tier
   * a caller can write, at every provider, which is what catches the case a
   * single probe cannot — a provider that honours `1k` and quietly ignores
   * `2k`, or one whose enum happens to contain the probe and nothing else.
   *
   * `implicit` cells are the documented exception and are excluded by name,
   * which is exactly why that word costs a `why` string.
   */
  test.each(rows)("%s", (provider, row) => {
    const bare = compile(row, {});
    const dropped: string[] = [];
    let accepted = 0;

    for (const aspectRatio of ALL_RATIOS) {
      // A shape identical to the base one is the same request by definition;
      // asking whether it "changed" anything is a question about the probe.
      if (aspectRatio === row.base?.aspectRatio) continue;
      // Tier-less too: a provider whose `resolution` is a declared gap would
      // otherwise refuse every combination and be scored as accepting nothing.
      for (const resolution of [undefined, ...ALL_TIERS]) {
        const compiled = compile(row, {
          aspectRatio,
          ...(resolution !== undefined && { resolution }),
        } as Partial<ImageParams>);
        if (Array.isArray(compiled)) continue; // refused — the other half of the contract
        accepted += 1;
        if (row.aspectRatio === "implicit" && row.resolution === "implicit") continue;
        const landed = Array.isArray(bare) || serialize(compiled) !== serialize(bare);
        if (!landed) dropped.push(`${aspectRatio}@${resolution ?? "-"}`);
      }
    }

    // …and the same for the two output fields, whose cells are independent of
    // the size decision.
    for (const outputFormat of ALL_FORMATS) {
      if (row.outputFormat === "implicit") break;
      const compiled = compile(row, { outputFormat } as Partial<ImageParams>);
      if (Array.isArray(compiled)) continue;
      accepted += 1;
      const landed = Array.isArray(bare) || serialize(compiled) !== serialize(bare);
      if (!landed) dropped.push(`outputFormat=${outputFormat}`);
    }
    for (const outputDelivery of ALL_DELIVERIES) {
      const cell = outputDelivery === "url" ? row.deliveryUrl : row.deliveryBase64;
      if (cell === "implicit") continue;
      const compiled = compile(row, { outputDelivery } as Partial<ImageParams>);
      if (Array.isArray(compiled)) continue;
      accepted += 1;
      const landed = Array.isArray(bare) || serialize(compiled) !== serialize(bare);
      if (!landed) dropped.push(`outputDelivery=${outputDelivery}`);
    }

    expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
    expect(dropped, `${provider} accepted and ignored a value`).toEqual([]);
  });
});
