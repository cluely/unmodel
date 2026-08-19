/**
 * The capability table for `unmodel/video`, committed and then **probed**.
 *
 * The table below is the answer to "what does this provider do with each of the
 * nine canonical fields", written once, in one place, in five words:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed: re-spelled, re-typed, bucketed or nested |
 * | `implicit` | accepted, and nothing is sent — because the provider only ever does this. Requires a `why` |
 * | `declared` | a provider-wide gap on the adapter's `unsupported` record; the kernel rejects it before compile |
 * | `refused` | a **model-dependent** gap: a sibling route or model has the field, so `compile` (or the provider's own table) rejects it by hand |
 *
 * A table on its own is documentation that rots. Each row is therefore
 * asserted against behaviour:
 *
 * - `declared` must be **on the adapter** (so the kernel's uniform message
 *   applies) *and* actually rejected, at the canonical path;
 * - `refused` must be rejected at the canonical path and **not** declared —
 *   the distinction carries most of this category's weight, because eight of
 *   these ten providers serve more than one route and the fields differ
 *   between them;
 * - `native` must compile **and** the probe value must appear verbatim in the
 *   request that comes out;
 * - `derived` must compile, must **not** carry the probe verbatim, and must
 *   change the request relative to the same request without the field;
 * - `implicit` must compile and change nothing, which is the one shape that
 *   looks exactly like a silent drop — so it is the only word that has to
 *   explain itself in the table.
 *
 * **Verbatim means the same value *and* the same type.** `duration: 8` reaching
 * the wire as `"8"` is not the number the caller wrote — it is Sora's string
 * enum — and the whole reason the canonical duration is a plain number is that
 * five providers spell it five ways. A looser check would score every one of
 * them `native` and assert nothing.
 *
 * `duration` and `size` get their own columns, because they are what this
 * category is actually about: which encoder a duration lands in, and whether
 * the tier gets a field of its own or has to pick between `ratio` entries.
 */
import { describe, expect, test } from "bun:test";
import type { VideoParams } from "../../src/core/unified/vocabulary/video";
import { video } from "../../src/unified/video";
import { video as bytedance } from "../../src/providers/bytedance/unified-video";
import { video as google } from "../../src/providers/google/unified-video";
import { video as kling } from "../../src/providers/kling/unified-video";
import { video as lightricks } from "../../src/providers/lightricks/unified";
import { video as luma } from "../../src/providers/luma/unified-video";
import { video as minimax } from "../../src/providers/minimax/unified-video";
import { video as openai } from "../../src/providers/openai/unified";
import { video as pixverse } from "../../src/providers/pixverse/unified";
import { video as runway } from "../../src/providers/runway/unified-video";
import { video as vidu } from "../../src/providers/vidu/unified-video";

type Support = "native" | "derived" | "implicit" | "declared" | "refused";

/** The five duration encodings, named for the shape they put on the wire. */
type DurationClass =
  /** `toDurationNumber` — plain seconds. */
  | "number"
  /** `toDurationNumber`, one level down in a `settings` object. */
  | "nested-number"
  /** `toDurationString` — the same seconds, quoted. */
  | "string"
  /** `toDurationSuffixedString` — `"5s"`. */
  | "suffixed";

/** Where the size decision lands, which is a per-provider question here. */
type SizeClass =
  /** A tier field of its own (`resolution`, `mode`, `quality`). */
  | "tier-field"
  /** A `WxH` string that carries the tier *and* the shape. */
  | "size-enum"
  /** A ratio enum whose members are pixel pairs: the tier picks the bucket. */
  | "ratio-bucket";

interface Capability {
  ref: string;
  /** The adapter, so the `declared` column can be checked against data. */
  adapter: Readonly<{
    provider: string;
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  /**
   * Canonical params every probe for this provider must carry.
   *
   * Two reasons a row needs one, and both are honest facts about the provider:
   * runway's `ratio` is required for a tier to have anything to pick between,
   * and pixverse and lightricks have required wire fields with no documented
   * default, so a request without them compiles *with warnings* — which would
   * score every cell as approximating.
   */
  base?: Partial<VideoParams>;
  /** Per-row probe values, where the default is not one this model serves. */
  probe?: { duration?: number; resolution?: VideoParams["resolution"]; aspectRatio?: string };
  duration: { support: Support; class: DurationClass; at: string };
  size: { class: SizeClass; at: string };
  resolution: Support;
  aspectRatio: Support;
  imageFirst: Support;
  imageLast: Support;
  imageReference: Support;
  video: Support;
  negativePrompt: Support;
  seed: Support;
  n: Support;
  /** Cells whose probe compiles **and** emits a translation warning. */
  warns?: readonly string[];
  /** Required whenever any row above is `implicit`. */
  why?: Partial<Record<string, string>>;
}

/**
 * One row per provider, ordered as `src/unified/video.ts` registers them, so
 * the two lists read the same way.
 */
const TABLE: Readonly<Record<string, Capability>> = {
  openai: {
    ref: "openai/sora-2-pro",
    adapter: openai,
    duration: { support: "derived", class: "string", at: "seconds" },
    size: { class: "size-enum", at: "size" },
    resolution: "derived",
    aspectRatio: "derived",
    imageFirst: "native",
    imageLast: "refused",
    imageReference: "refused",
    video: "declared",
    negativePrompt: "declared",
    seed: "declared",
    n: "declared",
  },
  google: {
    ref: "google/veo-3.1-generate-preview",
    adapter: google,
    // Bytes, not a URL: `gcsUri` is Vertex-only, so this is the one provider
    // whose image probe is inline.
    probe: {},
    duration: { support: "native", class: "number", at: "parameters.durationSeconds" },
    size: { class: "tier-field", at: "parameters.resolution" },
    resolution: "native",
    aspectRatio: "native",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "native",
    video: "native",
    negativePrompt: "native",
    seed: "native",
    n: "native",
  },
  runway: {
    ref: "runway/seedance2",
    adapter: runway,
    // `ratio` members are pixel pairs, so a tier with no shape beside it has
    // nothing to pick between — which the adapter says rather than guesses.
    base: { aspectRatio: "16:9" },
    probe: { aspectRatio: "9:16" },
    duration: { support: "native", class: "number", at: "duration" },
    size: { class: "ratio-bucket", at: "ratio" },
    resolution: "derived",
    aspectRatio: "derived",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "native",
    video: "native",
    negativePrompt: "refused",
    seed: "refused",
    n: "declared",
  },
  kling: {
    ref: "kling/kling-v3",
    adapter: kling,
    duration: { support: "derived", class: "string", at: "duration" },
    size: { class: "tier-field", at: "mode" },
    resolution: "derived",
    aspectRatio: "native",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "refused",
    video: "refused",
    negativePrompt: "native",
    seed: "declared",
    n: "declared",
  },
  luma: {
    ref: "luma/ray-2",
    adapter: luma,
    probe: { duration: 5 },
    duration: { support: "derived", class: "suffixed", at: "duration" },
    size: { class: "tier-field", at: "resolution" },
    resolution: "native",
    aspectRatio: "native",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "refused",
    video: "declared",
    negativePrompt: "declared",
    seed: "declared",
    n: "declared",
  },
  minimax: {
    ref: "minimax/MiniMax-Hailuo-02",
    adapter: minimax,
    probe: { duration: 6 },
    duration: { support: "native", class: "number", at: "duration" },
    size: { class: "tier-field", at: "resolution" },
    resolution: "derived",
    aspectRatio: "refused",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "refused",
    video: "refused",
    negativePrompt: "declared",
    seed: "declared",
    n: "declared",
  },
  vidu: {
    ref: "vidu/viduq3-turbo",
    adapter: vidu,
    duration: { support: "native", class: "number", at: "duration" },
    size: { class: "tier-field", at: "resolution" },
    resolution: "native",
    aspectRatio: "native",
    imageFirst: "native",
    imageLast: "refused",
    imageReference: "native",
    video: "refused",
    negativePrompt: "declared",
    seed: "native",
    n: "declared",
  },
  pixverse: {
    ref: "pixverse/v6",
    adapter: pixverse,
    base: { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
    probe: { duration: 5, resolution: "720p", aspectRatio: "9:16" },
    duration: { support: "native", class: "number", at: "duration" },
    size: { class: "tier-field", at: "quality" },
    resolution: "native",
    aspectRatio: "native",
    imageFirst: "declared",
    imageLast: "declared",
    imageReference: "declared",
    video: "declared",
    negativePrompt: "declared",
    seed: "native",
    n: "declared",
  },
  bytedance: {
    ref: "bytedance/dreamina-seedance-2-0-260128",
    adapter: bytedance,
    duration: { support: "native", class: "number", at: "duration" },
    size: { class: "tier-field", at: "resolution" },
    resolution: "native",
    aspectRatio: "native",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "native",
    video: "native",
    negativePrompt: "declared",
    seed: "refused",
    n: "declared",
  },
  lightricks: {
    ref: "lightricks/ltx-2-5-fast",
    adapter: lightricks,
    // The shape is in the base because LTX's default *is* 16:9: without it,
    // an `aspectRatio: "16:9"` probe would compile to the same body as the
    // bare request and read as a silent drop.
    base: { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
    probe: { duration: 6, resolution: "720p", aspectRatio: "9:16" },
    duration: { support: "native", class: "number", at: "duration" },
    size: { class: "size-enum", at: "resolution" },
    resolution: "derived",
    aspectRatio: "derived",
    imageFirst: "native",
    imageLast: "native",
    imageReference: "refused",
    video: "declared",
    negativePrompt: "declared",
    seed: "declared",
    n: "declared",
  },
};

/**
 * The defaults, chosen so the row under test is the mapping and not the bounds:
 * `16:9` is on every ratio enum in the pack, `1080p` is the tier every provider
 * that has a tier field can reach, and `8` is a duration six of the ten offer
 * (the other four name theirs in `probe`).
 */
const PROBE = {
  duration: 8,
  resolution: "1080p",
  aspectRatio: "16:9",
  seed: 7,
  n: 1,
  negativePrompt: "blurry, low quality",
  url: "https://example.com/frame.png",
  last: "https://example.com/last.png",
  clip: "https://example.com/clip.mp4",
  bytes:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  lastBytes:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
} as const;

/** google is the one provider with no URL form anywhere on the route. */
const first = (row: Capability): VideoParams["image"] =>
  row.adapter.provider === "google"
    ? { data: PROBE.bytes, mimeType: "image/png" }
    : { url: PROBE.url };

const firstValue = (row: Capability): string =>
  row.adapter.provider === "google" ? PROBE.bytes : PROBE.url;

/** The closing frame, in whichever form the provider's field takes. */
const last = (row: Capability): VideoParams["image"] =>
  row.adapter.provider === "google"
    ? { data: PROBE.lastBytes, mimeType: "image/png", role: "last" }
    : { url: PROBE.last, role: "last" };

const lastValue = (row: Capability): string =>
  row.adapter.provider === "google" ? PROBE.lastBytes : PROBE.last;

/** The compiled request, in the two places a video param can end up. */
interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<VideoParams>): Compiled | string[] {
  const result = video.safe({
    model: row.ref,
    prompt: "A probe.",
    ...row.base,
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
  };
}

/**
 * Does this exact value appear anywhere in the compiled request?
 *
 * Type-strict: a number probe matches only a number, which is what makes
 * `duration: 8` → `seconds: "8"` read as `derived` rather than `native`. The
 * URL is searched for string probes only, for the same reason — every request
 * URL contains a `1` and a `2`.
 */
function carries(compiled: Compiled, value: string | number): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (found) return;
    if (typeof node === typeof value) {
      if (node === value) found = true;
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
  return found || (typeof value === "string" && compiled.url.includes(value));
}

/**
 * The whole request as one string, for the "it changed something" check.
 *
 * A `derived` row only says the caller's value is not on the wire verbatim —
 * which a **silent drop** also satisfies. Comparing the request against the
 * same request without the field is what tells the two apart, and it is the
 * one property the loss contract cannot be allowed to lose.
 */
/** A dotted wire path into a compiled body — google nests everything one deep. */
function at(body: Record<string, unknown>, path: string): unknown {
  let node: unknown = body;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function serialize(compiled: Compiled): string {
  return JSON.stringify([compiled.body, compiled.url]);
}

const rows = Object.entries(TABLE);

test("the table covers exactly the providers in the pack", () => {
  expect(rows.map(([provider]) => provider).sort()).toEqual([...video.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  const duration = row.probe?.duration ?? PROBE.duration;
  const resolution = row.probe?.resolution ?? PROBE.resolution;
  const aspectRatio = row.probe?.aspectRatio ?? PROBE.aspectRatio;

  const cells = [
    ["duration", row.duration.support, duration, { duration }],
    ["resolution", row.resolution, resolution, { resolution }],
    ["aspectRatio", row.aspectRatio, aspectRatio, { aspectRatio }],
    ["imageFirst", row.imageFirst, firstValue(row), { image: first(row) }],
    ["imageLast", row.imageLast, lastValue(row), { image: [first(row), last(row)] }],
    [
      "imageReference",
      row.imageReference,
      firstValue(row),
      { image: [{ ...(first(row) as object), role: "reference" }] },
    ],
    ["video", row.video, PROBE.clip, { video: { url: PROBE.clip } }],
    ["negativePrompt", row.negativePrompt, PROBE.negativePrompt, { negativePrompt: PROBE.negativePrompt }],
    ["seed", row.seed, PROBE.seed, { seed: PROBE.seed }],
    ["n", row.n, PROBE.n, { n: PROBE.n }],
  ] as const;

  test.each(cells)("%s is %s", (field, support, probe, extra) => {
    // The three image cells are three probes of one canonical field.
    const canonical = field.startsWith("image") ? "image" : field;
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
      const compiled = compile(row, extra as Partial<VideoParams>);
      expect(Array.isArray(compiled), `${provider} accepted a ${field} it cannot express`).toBe(
        true,
      );
      if (!Array.isArray(compiled)) return;
      // Rejected at the CANONICAL path — the whole point of `ctx.from`.
      expect(
        compiled.some((issue) => issue.split(" @ ")[1]?.split(".")[0] === canonical),
        compiled.join("; "),
      ).toBe(true);
      return;
    }

    expect(declared, `${provider} must not declare ${canonical} unsupported`).toBeUndefined();

    const compiled = compile(row, extra as Partial<VideoParams>);
    expect(compiled, `${provider} could not compile a ${field} probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;

    const without = compile(row, {});
    const changed = Array.isArray(without) || serialize(compiled) !== serialize(without);

    if (support === "implicit") {
      expect(row.why?.[field], `${provider}.why.${field} is required for an implicit cell`)
        .toBeDefined();
      expect(changed, `${provider} ${field} claims implicit but changed the request`).toBe(false);
      return;
    }

    expect(changed, `${provider} silently dropped ${field}`).toBe(true);
    expect(carries(compiled, probe), `${provider} ${field} verbatim`).toBe(support === "native");

    // Approximate or exact — the third fact about a cell, and the one the loss
    // contract is actually about.
    const result = video.safe({
      model: row.ref,
      prompt: "A probe.",
      ...row.base,
      ...extra,
    } as never);
    const warnings = result.ok
      ? (result.params as unknown as { warnings: readonly unknown[] }).warnings
      : [];
    expect(warnings.length > 0, `${provider} ${field} approximates`).toBe(
      row.warns?.includes(field) === true,
    );
  });

  test(`duration lands as ${row.duration.class} at \`${row.duration.at}\``, () => {
    const compiled = compile(row, { duration: row.probe?.duration ?? PROBE.duration });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const value = at(compiled.body, row.duration.at);
    expect(value, `${provider} wrote nothing at ${row.duration.at}`).toBeDefined();

    switch (row.duration.class) {
      case "number":
        expect(typeof value).toBe("number");
        break;
      case "nested-number":
        expect(typeof (value as { duration?: unknown }).duration).toBe("number");
        break;
      case "string":
        expect(String(value)).toMatch(/^\d+$/);
        break;
      default:
        expect(String(value)).toMatch(/^\d+s$/);
    }
  });

  test(`size lands as ${row.size.class} at \`${row.size.at}\``, () => {
    const compiled = compile(row, {
      resolution: row.probe?.resolution ?? PROBE.resolution,
      ...(row.aspectRatio === "refused"
        ? {}
        : { aspectRatio: row.probe?.aspectRatio ?? PROBE.aspectRatio }),
    } as Partial<VideoParams>);
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const value = at(compiled.body, row.size.at);
    expect(value, `${provider} wrote nothing at ${row.size.at}`).toBeDefined();

    switch (row.size.class) {
      case "size-enum":
        expect(String(value)).toMatch(/^\d+x\d+$/);
        break;
      case "ratio-bucket":
        expect(String(value)).toMatch(/^\d+:\d+$/);
        break;
      default: {
        // A tier under this provider's own name, possibly one level down in
        // google's `parameters`.
        const rendered =
          typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
        expect(rendered).toMatch(/720|768|1080|std|pro|4k|2K/i);
      }
    }
  });
});

test("every duration encoding in the category is exercised by some provider", () => {
  const classes = new Set(rows.map(([, row]) => row.duration.class));
  // `nested-number` is Kling's path-addressed family, which is not the ref this
  // table probes — it is covered by the `duration-8s` golden case and by
  // `video-e2e`, and named here so the gap is deliberate rather than forgotten.
  expect([...classes].sort()).toEqual(["number", "string", "suffixed"]);
  const nested = video.safe({ model: "kling/kling-3.0", prompt: "probe", duration: 8 } as never);
  expect(nested.ok && (nested.params as unknown as { settings: { duration: number } }).settings)
    .toEqual({ duration: 8 });
});

test("every size class in the category is exercised by some provider", () => {
  const classes = new Set(rows.map(([, row]) => row.size.class));
  expect([...classes].sort()).toEqual(["ratio-bucket", "size-enum", "tier-field"]);
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

const ALL_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"] as const;
const ALL_TIERS = ["480p", "720p", "1080p", "1440p", "4k"] as const;
const ALL_DURATIONS = [3, 4, 5, 6, 8, 10, 12] as const;

describe("no silent drops, over the whole sizing and duration matrix", () => {
  /**
   * The one property the loss contract cannot survive losing: a canonical
   * field is either **refused** or **sent**. Never accepted and ignored.
   *
   * The probes above check one value per cell; this checks every ratio × tier ×
   * duration a caller can write, at every provider, which is what catches the
   * case a single probe cannot — a provider that honours `1080p` and quietly
   * ignores `4k`, or one whose enum happens to contain the probe and nothing
   * else.
   */
  test.each(rows)("%s", (provider, row) => {
    const bare = compile(row, {});
    const dropped: string[] = [];
    let accepted = 0;

    for (const aspectRatio of ALL_RATIOS) {
      if (aspectRatio === row.base?.aspectRatio) continue;
      for (const resolution of [undefined, ...ALL_TIERS]) {
        if (resolution === row.base?.resolution) continue;
        const compiled = compile(row, {
          ...(row.aspectRatio === "refused" ? {} : { aspectRatio }),
          ...(resolution !== undefined && { resolution }),
        } as Partial<VideoParams>);
        if (Array.isArray(compiled)) continue; // refused — the other half of the contract
        accepted += 1;
        const landed = Array.isArray(bare) || serialize(compiled) !== serialize(bare);
        if (!landed) dropped.push(`${aspectRatio}@${resolution ?? "-"}`);
      }
    }

    for (const duration of ALL_DURATIONS) {
      if (duration === row.base?.duration) continue;
      const compiled = compile(row, { duration } as Partial<VideoParams>);
      if (Array.isArray(compiled)) continue;
      accepted += 1;
      const landed = Array.isArray(bare) || serialize(compiled) !== serialize(bare);
      if (!landed) dropped.push(`duration=${duration}`);
    }

    expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
    expect(dropped, `${provider} accepted and ignored a value`).toEqual([]);
  });
});
