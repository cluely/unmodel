/**
 * The capability table for `unmodel/image-edit`, committed and then **probed**.
 *
 * The table below is the answer to "what does this provider do with each of the
 * seven canonical fields", written once, in one place, in four words:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed: reshaped, converted or re-spelled |
 * | `declared` | a provider-wide gap on the adapter's `unsupported` record; the kernel rejects it before compile |
 * | `refused` | a **model-dependent** gap: a sibling model has the field, so `compile` rejects it by hand |
 *
 * A table on its own is documentation that rots. Each row is therefore asserted
 * against behaviour, and two of the columns are asserted harder than the rest
 * because they are the two this category is actually about:
 *
 * - **`image`, in both directions.** Every kind an adapter declares must
 *   compile, and every kind it does not must be an `unsupported_param` at
 *   `image` whose message names the kinds it *does* take. This is the runtime
 *   half of the compile-time narrowing.
 * - **`strength`, including which way it points.** The cell carries the wire
 *   values at canonical 0 and 1, and the probe compiles two requests and checks
 *   the wire value moves the way the cell claims. Ideogram's scale runs
 *   *backwards*; a flipped map would still compile, still land in the right
 *   field, still warn about nothing — and quietly return a picture the caller
 *   did not ask for. Nothing but a direction assertion catches that.
 */
import { describe, expect, test } from "bun:test";
import type {
  ImageEditInputKind,
  ImageEditParams,
} from "../../src/core/unified/vocabulary/image-edit";
import { imageEdit } from "../../src/unified/image-edit";
import { imageEdit as blackForestLabs } from "../../src/providers/black-forest-labs/unified-image-edit";
import { imageEdit as ideogram } from "../../src/providers/ideogram/unified-image-edit";
import { imageEdit as openai } from "../../src/providers/openai/unified-image-edit";
import { imageEdit as recraft } from "../../src/providers/recraft/unified-image-edit";

type Support = "native" | "derived" | "declared" | "refused";

/** The size vocabularies this category reaches, named for their `derive.ts` function. */
type SizeClass =
  /** S1 `toRatioEnum` — a closed list of ratio spellings. */
  | "ratio-enum"
  /** S4 `toSizeFreeform` — an arbitrary `WxH` within bounds. */
  | "size-freeform"
  /** S5 `toRatioString` — any `W:H` inside a numeric range. */
  | "ratio-string";

/** Where a provider's strength dial lands, and what its two ends are. */
interface StrengthCell {
  at: string;
  /** The wire value at canonical `strength: 0` — "keep the source". */
  atZero: number;
  /** The wire value at canonical `strength: 1` — "ignore the source". */
  atOne: number;
}

interface Capability {
  ref: string;
  /** The adapter, so the `declared` and `image` columns check against data. */
  adapter: Readonly<{
    provider: string;
    imageInputs: readonly ImageEditInputKind[];
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  /**
   * Canonical params every probe for this provider must carry. Recraft is the
   * only entry that needs one: `strength` is REQUIRED on its wire and it
   * documents no default, so a request without one is (correctly) refused
   * before any other row could be observed.
   */
  base?: Partial<ImageEditParams>;
  /** Where the shape lands, or `null` when the route has no size field at all. */
  size: { class: SizeClass; at: string } | null;
  strength: StrengthCell | "declared";
  n: Support;
  seed: Support;
  outputFormat: Support;
  aspectRatio: Support;
  dimensions: Support;
  /** Cells whose probe compiles **and** emits a translation warning. */
  warns?: readonly string[];
}

/** One row per provider, ordered as `src/unified/image-edit.ts` registers them. */
const TABLE: Readonly<Record<string, Capability>> = {
  openai: {
    // The free-form family, so the size column is the interesting one. The
    // enum family (gpt-image-1.5) and dall-e-2's model-dependent refusals are
    // in `image-edit-e2e.test.ts`.
    ref: "openai/gpt-image-2",
    adapter: openai,
    size: { class: "size-freeform", at: "size" },
    strength: "declared",
    n: "native",
    seed: "declared",
    outputFormat: "native",
    aspectRatio: "derived",
    dimensions: "derived",
  },
  "black-forest-labs": {
    ref: "black-forest-labs/flux-kontext-pro",
    adapter: blackForestLabs,
    size: { class: "ratio-string", at: "aspect_ratio" },
    strength: "declared",
    n: "declared",
    seed: "native",
    outputFormat: "native",
    // S5 hands back the *reduced* spelling, and `9:16` is already reduced — so
    // the value the caller wrote is the value on the wire.
    aspectRatio: "native",
    dimensions: "declared",
  },
  ideogram: {
    ref: "ideogram/ideogram-3.0-quality",
    adapter: ideogram,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    // The inversion, as data: 0 → 100, 1 → 0.
    strength: { at: "image_weight", atZero: 100, atOne: 0 },
    n: "native",
    seed: "native",
    outputFormat: "declared",
    aspectRatio: "derived",
    dimensions: "derived",
  },
  recraft: {
    ref: "recraft/recraftv4_1",
    adapter: recraft,
    base: { strength: 0.5 },
    size: null,
    // The one route whose dial already means what the canonical one means.
    strength: { at: "strength", atZero: 0, atOne: 1 },
    n: "native",
    seed: "native",
    outputFormat: "declared",
    aspectRatio: "declared",
    dimensions: "declared",
  },
};

/**
 * The probes, chosen so the row under test is the mapping and not the bounds:
 * `9:16` is on every ratio vocabulary in the pack, and `1344×768` is on
 * Ideogram's 69-value `RESOLUTIONS` list *and* inside gpt-image-2's free-form
 * rules (both edges divisible by 16, ratio 1.75, 1.03 MP).
 *
 * `strength: 0.25` rather than `0.5`, because Recraft's base already carries a
 * half — and a probe equal to the base value would land on the same body as the
 * bare request, leaving the anti-silent-drop check nothing to see.
 */
const PROBE = {
  aspectRatio: "9:16",
  dimensions: { width: 1344, height: 768 },
  strength: 0.25,
  n: 2,
  seed: 7,
  outputFormat: "png",
} as const;

/** One `image` value of each kind, for the bidirectional `image` probe. */
const IMAGE_KINDS: readonly ImageEditInputKind[] = ["file", "url", "data"];

const IMAGE_FOR: Readonly<Record<ImageEditInputKind, () => Record<string, unknown>>> = {
  file: () => ({ file: new Blob([new Uint8Array(64)], { type: "image/png" }) }),
  url: () => ({ url: "https://example.com/street.png" }),
  data: () => ({ data: "aVZCT1J3MEtHZ28=" }),
};

/** The compiled request, in the two places an edit param can end up. */
interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<ImageEditParams>): Compiled | string[] {
  // `dimensions` and `aspectRatio` are the XOR pair, so a base shape has to
  // step aside for a dimensions probe rather than fight it.
  const base = "dimensions" in extra ? { ...row.base, aspectRatio: undefined } : row.base;
  const kind = row.adapter.imageInputs[0] as ImageEditInputKind;
  const result = imageEdit.safe({
    operation: "edit",
    model: row.ref,
    prompt: "A probe.",
    image: IMAGE_FOR[kind](),
    ...base,
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  // A Blob has no JSON form; replace it with a stable descriptor so the
  // "did the request change" comparison below still means something.
  const body = JSON.parse(
    JSON.stringify(result.params, (_key, value: unknown) =>
      value instanceof Blob ? `blob:${value.size}:${value.type}` : value,
    ),
  ) as Record<string, unknown>;
  return { body, url: request.request.url };
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
 * which a **silent drop** also satisfies. Comparing the request against the same
 * request without the field is what tells the two apart, and it is the one
 * property the loss contract cannot be allowed to lose.
 */
function serialize(compiled: Compiled): string {
  return JSON.stringify([compiled.body, compiled.url]);
}

/** The translation warnings a probe produced, or `[]` when it did not compile. */
function warningsOf(row: Capability, extra: Partial<ImageEditParams>): readonly unknown[] {
  const base = "dimensions" in extra ? { ...row.base, aspectRatio: undefined } : row.base;
  const kind = row.adapter.imageInputs[0] as ImageEditInputKind;
  const result = imageEdit.safe({
    operation: "edit",
    model: row.ref,
    prompt: "A probe.",
    image: IMAGE_FOR[kind](),
    ...base,
    ...extra,
  } as never);
  return result.ok ? (result.params as unknown as { warnings: readonly unknown[] }).warnings : [];
}

const rows = Object.entries(TABLE);

test("the table covers exactly the providers in the pack", () => {
  expect(rows.map(([provider]) => provider).sort()).toEqual([...imageEdit.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  // -------------------------------------------------------------------------
  // image — the flagship row, in both directions
  // -------------------------------------------------------------------------

  test("accepts exactly the image kinds it declares", () => {
    for (const kind of IMAGE_KINDS) {
      const result = imageEdit.safe({
        operation: "edit",
        model: row.ref,
        prompt: "A probe.",
        image: IMAGE_FOR[kind](),
        ...row.base,
      } as never);
      const declared = row.adapter.imageInputs.includes(kind);
      if (declared) {
        expect(result.ok, `${provider} refused a declared \`${kind}\``).toBe(true);
        continue;
      }
      expect(result.ok, `${provider} accepted an undeclared \`${kind}\``).toBe(false);
      if (result.ok) continue;
      const issue = result.errors[0];
      expect(issue?.code).toBe("unsupported_param");
      expect(issue?.path).toEqual(["image"]);
      // …and the message names what this route DOES take, which is the half a
      // caller can act on.
      for (const accepted of row.adapter.imageInputs) {
        expect(String(issue?.message)).toContain(`{ ${accepted} }`);
      }
    }
  });

  test("declares its image kinds as a non-empty set the runtime agrees with", () => {
    expect(row.adapter.imageInputs.length).toBeGreaterThan(0);
    expect(row.adapter.unsupported?.["image"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // operation — the discriminant, checked at run time as well as in the type
  // -------------------------------------------------------------------------

  test("an operation this route does not serve is refused, not compiled as an edit", () => {
    // The type already forbids it; this is the half that answers for JavaScript
    // callers. A discriminant that is only a type is a silent drop waiting to
    // happen — the field would compile to nothing and the request would quietly
    // be an edit.
    for (const operation of ["inpaint", "outpaint", "upscale", "", 7, undefined]) {
      const compiled = compile(row, { operation } as Partial<ImageEditParams>);
      expect(compiled, `${provider} accepted operation ${JSON.stringify(operation)}`).toEqual([
        "invalid_enum_value @ operation",
      ]);
    }
  });

  // -------------------------------------------------------------------------
  // The scalar rows
  // -------------------------------------------------------------------------

  const cells = [
    ["aspectRatio", row.aspectRatio, PROBE.aspectRatio, { aspectRatio: PROBE.aspectRatio }],
    ["dimensions", row.dimensions, PROBE.dimensions.width, { dimensions: PROBE.dimensions }],
    ["n", row.n, PROBE.n, { n: PROBE.n }],
    ["seed", row.seed, PROBE.seed, { seed: PROBE.seed }],
    ["outputFormat", row.outputFormat, PROBE.outputFormat, { outputFormat: PROBE.outputFormat }],
  ] as const;

  test.each(cells)("%s is %s", (field, support, probe, extra) => {
    const declared = row.adapter.unsupported?.[field];

    if (support === "declared" || support === "refused") {
      if (support === "declared") {
        expect(declared, `${provider}.unsupported.${field}`).toBeDefined();
      } else {
        expect(
          declared,
          `${provider} must NOT declare ${field} unsupported — it is model-dependent`,
        ).toBeUndefined();
      }
      const compiled = compile(row, extra as Partial<ImageEditParams>);
      expect(Array.isArray(compiled), `${provider} accepted a ${field} it cannot express`).toBe(
        true,
      );
      if (!Array.isArray(compiled)) return;
      // Rejected at the CANONICAL path — the whole point of `ctx.from`.
      expect(compiled.some((issue) => issue.endsWith(`@ ${field}`)), compiled.join("; ")).toBe(true);
      return;
    }

    expect(declared, `${provider} must not declare ${field} unsupported`).toBeUndefined();

    const compiled = compile(row, extra as Partial<ImageEditParams>);
    expect(compiled, `${provider} could not compile a ${field} probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;

    const without = compile(row, {});
    expect(
      Array.isArray(without) || serialize(compiled) !== serialize(without),
      `${provider} silently dropped ${field}`,
    ).toBe(true);
    expect(carries(compiled, probe), `${provider} ${field} verbatim`).toBe(support === "native");

    // Approximate or exact — the third fact about a cell, and the one the loss
    // contract is actually about.
    expect(
      warningsOf(row, extra as Partial<ImageEditParams>).length > 0,
      `${provider} ${field} approximates`,
    ).toBe(row.warns?.includes(field) === true);
  });

  // -------------------------------------------------------------------------
  // strength — and, above all, which way it points
  // -------------------------------------------------------------------------

  test(
    row.strength === "declared"
      ? "has no strength dial, and says so"
      : `strength runs ${(row.strength as StrengthCell).atZero} → ${(row.strength as StrengthCell).atOne} at \`${(row.strength as StrengthCell).at}\``,
    () => {
      if (row.strength === "declared") {
        expect(row.adapter.unsupported?.["strength"]).toBeDefined();
        const compiled = compile(row, { strength: PROBE.strength });
        expect(compiled).toEqual(["unsupported_param @ strength"]);
        return;
      }
      expect(row.adapter.unsupported?.["strength"]).toBeUndefined();

      // The two ends, exactly.
      for (const [strength, expected] of [
        [0, row.strength.atZero],
        [1, row.strength.atOne],
      ] as const) {
        const compiled = compile(row, { strength });
        expect(compiled, `${provider} refused strength ${strength}`).not.toBeInstanceOf(Array);
        if (Array.isArray(compiled)) continue;
        expect(compiled.body[row.strength.at], `${provider} at strength ${strength}`).toBe(expected);
      }

      // …and the direction between them, which is the assertion that catches a
      // flipped map: a sign error compiles, lands in the right field and warns
      // about nothing.
      const low = compile(row, { strength: 0.25 });
      const high = compile(row, { strength: 0.75 });
      expect(Array.isArray(low) || Array.isArray(high)).toBe(false);
      if (Array.isArray(low) || Array.isArray(high)) return;
      const lowValue = low.body[row.strength.at] as number;
      const highValue = high.body[row.strength.at] as number;
      const inverted = row.strength.atZero > row.strength.atOne;
      expect(
        inverted ? lowValue > highValue : lowValue < highValue,
        `${provider} strength points the wrong way: 0.25 → ${lowValue}, 0.75 → ${highValue}`,
      ).toBe(true);
    },
  );

  test("a strength outside [0, 1] is refused rather than clamped", () => {
    if (row.strength === "declared") return;
    for (const strength of [-0.5, 1.5]) {
      expect(compile(row, { strength }), `${provider} accepted strength ${strength}`).toEqual([
        "invalid_shape @ strength",
      ]);
    }
  });

  // -------------------------------------------------------------------------
  // size
  // -------------------------------------------------------------------------

  test(
    row.size === null
      ? "has no size field at all, and says so"
      : `size lands as ${(row.size as { class: SizeClass }).class} at \`${(row.size as { at: string }).at}\``,
    () => {
      if (row.size === null) {
        // Both spellings of a shape are refused, which is the honest answer for
        // a route whose output takes the input's shape.
        expect(row.aspectRatio).toBe("declared");
        expect(row.dimensions).toBe("declared");
        return;
      }
      const compiled = compile(row, { aspectRatio: PROBE.aspectRatio });
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      const value = String(compiled.body[row.size.at]);
      expect(compiled.body[row.size.at], `${provider} wrote nothing at ${row.size.at}`).toBeDefined();
      switch (row.size.class) {
        case "size-freeform":
          expect(value).toMatch(/^\d+x\d+$/);
          break;
        case "ratio-string":
          expect(value).toMatch(/^\d+:\d+$/);
          break;
        default:
          // A ratio enum in the provider's own spelling — Ideogram's `9x16`.
          expect(value).toMatch(/^\d+\s*[:x]\s*\d+$/);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Cross-cutting properties of the table itself
// ---------------------------------------------------------------------------

test("every image kind in the vocabulary is served by some provider", () => {
  const kinds = new Set(rows.flatMap(([, row]) => row.adapter.imageInputs));
  expect([...kinds].sort()).toEqual(["data", "file", "url"]);
});

test("every size class this category reaches is exercised", () => {
  const classes = new Set(
    rows.map(([, row]) => row.size?.class).filter((cell): cell is SizeClass => cell !== undefined),
  );
  expect([...classes].sort()).toEqual(["ratio-enum", "ratio-string", "size-freeform"]);
  // S3 (`toSizeEnum`) is the gpt-image-1 family, which is not the ref this
  // table probes — named here so the gap is deliberate rather than forgotten.
  const S3 = imageEdit.safe({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt: "probe",
    image: IMAGE_FOR.file(),
    aspectRatio: "3:2",
  } as never);
  expect(S3.ok && (S3.params as unknown as { size: string }).size).toBe("1536x1024");
});

test("both strength directions exist in the pack, and neither is a coincidence", () => {
  const scales = rows
    .map(([, row]) => row.strength)
    .filter((cell): cell is StrengthCell => cell !== "declared");
  expect(scales.some((cell) => cell.atZero < cell.atOne), "a native scale").toBe(true);
  expect(scales.some((cell) => cell.atZero > cell.atOne), "an inverted scale").toBe(true);
});

// ---------------------------------------------------------------------------
// The property that has to hold for every cell, not just the probed ones
// ---------------------------------------------------------------------------

const ALL_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:4"] as const;
const ALL_STRENGTHS = [0, 0.1, 0.25, 0.333, 0.5, 0.75, 0.9, 1] as const;
const ALL_FORMATS = ["png", "jpeg", "webp"] as const;
const ALL_DIMENSIONS = [
  { width: 1024, height: 1024 },
  { width: 1344, height: 768 },
  { width: 768, height: 1344 },
] as const;

describe("no silent drops, over every canonical field", () => {
  /**
   * The one property the loss contract cannot survive losing: a canonical param
   * is either **refused** or **sent**. Never accepted and ignored.
   *
   * The probes above check one value per cell; this checks every value in the
   * matrix at every provider — which is what catches the case a single probe
   * cannot: a provider that honours `9:16` and quietly ignores `21:9`, or one
   * whose strength map collapses a range of inputs onto one wire value.
   *
   * There is no exemption list here, unlike the image and transcribe sweeps.
   * This category has no `implicit` cell: every field either has a wire slot or
   * is a declared gap, which is a property worth having and worth noticing if it
   * ever stops being true.
   */
  test.each(rows)("%s", (provider, row) => {
    const bare = compile(row, {});
    const dropped: string[] = [];
    let accepted = 0;

    const probes: Array<[string, Partial<ImageEditParams>]> = [
      ...ALL_RATIOS.map((aspectRatio): [string, Partial<ImageEditParams>] => [
        `aspectRatio=${aspectRatio}`,
        { aspectRatio },
      ]),
      ...ALL_DIMENSIONS.map((dimensions): [string, Partial<ImageEditParams>] => [
        `dimensions=${dimensions.width}x${dimensions.height}`,
        { dimensions },
      ]),
      ...ALL_STRENGTHS.filter((strength) => strength !== row.base?.strength).map(
        (strength): [string, Partial<ImageEditParams>] => [`strength=${strength}`, { strength }],
      ),
      ...ALL_FORMATS.map((outputFormat): [string, Partial<ImageEditParams>] => [
        `outputFormat=${outputFormat}`,
        { outputFormat },
      ]),
      ["n=2", { n: 2 }],
      ["n=3", { n: 3 }],
      ["seed=7", { seed: 7 }],
      ["seed=99", { seed: 99 }],
    ];

    for (const [label, probe] of probes) {
      const compiled = compile(row, probe);
      if (Array.isArray(compiled)) continue; // refused — the other half of the contract
      accepted += 1;
      if (Array.isArray(bare) || serialize(compiled) !== serialize(bare)) continue;
      dropped.push(label);
    }

    expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
    expect(dropped, `${provider} accepted and ignored a param`).toEqual([]);
  });
});
