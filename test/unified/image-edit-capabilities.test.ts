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
 *
 * Two columns arrived with the per-model tables and are read *from* them:
 * `sizeString` (how the canonical `size` lands, probed with the model's own
 * first declared preset; `null` claims the model has no `sizes` row) and
 * `extra` (one extra the model declares, asserted to be declared *and* to
 * reach the wire verbatim — the no-silent-drop sweep, extended to the half of
 * the request the canonical vocabulary has no words for).
 *
 * `TABLE` is the `operation: "edit"` table — one row per provider that serves
 * an edit. `REMOVE_BACKGROUND`, at the end of the file, is the second
 * operation's: a removal carries two canonical words (`image`, `outputFormat`),
 * so its table has two columns, and its probes are mostly about what the arm
 * refuses.
 */
import { describe, expect, test } from "bun:test";
import type {
  ImageEditInputKind,
  ImageEditModelParamTable,
  ImageEditParams,
} from "../../src/core/unified/vocabulary/image-edit";
import { imageEdit } from "../../src/unified/image-edit";
import { imageEdit as blackForestLabs } from "../../src/providers/black-forest-labs/unified-image-edit";
import { imageEdit as fal } from "../../src/providers/fal/unified-image-edit";
import { imageEdit as higgsfield } from "../../src/providers/higgsfield/unified-image-edit";
import { imageEdit as ideogram } from "../../src/providers/ideogram/unified-image-edit";
import { imageEdit as openai } from "../../src/providers/openai/unified-image-edit";
import { imageEdit as photoroom } from "../../src/providers/photoroom/unified";
import { imageEdit as recraft } from "../../src/providers/recraft/unified-image-edit";
import { imageEdit as revana } from "../../src/providers/revana/unified-image-edit";
import { imageEdit as stability } from "../../src/providers/stability/unified-image-edit";

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
  /**
   * Where the shape lands, or `null` when the route has no size field at all.
   * `at` is a dotted path for a body that nests its params (`input.aspect_ratio`).
   */
  size: { class: SizeClass; at: string } | null;
  /**
   * How the canonical `size` string lands, or `null` when this ref's model has
   * no `size` spelling at all — read against the adapter's own per-model
   * table, so the two cannot disagree.
   */
  sizeString: Support | null;
  /**
   * One extra this ref's model declares, and a legal value — asserted to be
   * declared *and* to reach the wire verbatim. Identity is the whole contract.
   *
   * `null` claims the model declares NO extras, and the probe checks that
   * against the adapter's own row — so the cell cannot be used to skip a model
   * that has one.
   */
  extra: Readonly<Record<string, unknown>> | null;
  /** Where that extra lands, when the route nests its params. */
  extraAt?: string;
  strength: StrengthCell | "declared";
  n: Support;
  seed: Support;
  outputFormat: Support;
  aspectRatio: Support;
  dimensions: Support;
  /** Cells whose probe compiles **and** emits a translation warning. */
  warns?: readonly string[];
}

/**
 * One row per provider that serves `operation: "edit"`, ordered as
 * `src/unified/image-edit.ts` registers them.
 */
const TABLE: Readonly<Record<string, Capability>> = {
  openai: {
    // The free-form family, so the size column is the interesting one. The
    // enum family (gpt-image-1.5) and dall-e-2's model-dependent refusals are
    // in `image-edit-e2e.test.ts`.
    ref: "openai/gpt-image-2",
    adapter: openai,
    size: { class: "size-freeform", at: "size" },
    sizeString: "native",
    extra: { background: "auto" },
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
    // Kontext declares no width/height at all, so `size` is `never` here.
    sizeString: null,
    extra: { safety_tolerance: 3 },
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
    sizeString: "native",
    extra: { magic_prompt: "AUTO" },
    // The inversion, as data: 0 → 100, 1 → 0.
    strength: { at: "image_weight", atZero: 100, atOne: 0 },
    n: "native",
    seed: "native",
    outputFormat: "declared",
    aspectRatio: "derived",
    dimensions: "derived",
  },
  /**
   * fal, whose rows are GENERATED from its own published OpenAPI, so this entry
   * checks the generator as much as the adapter.
   *
   * `fal-ai/flux/dev/image-to-image` is the representative ref for one reason:
   * it is the ONE endpoint in fal's 17 that declares a `strength` field. The
   * other sixteen are instruction editing, which has no dial between keeping
   * and replacing the input, so `strength` there is refused by name rather than
   * declared unsupported adapter-wide — the same R7 rule the generation table
   * documents. Picking a ref that could not exercise `strength` at all would
   * have left the category's most-approximated word untested here.
   *
   * `size: null` and both shape columns `refused`, because this route has no
   * geometry field of ANY kind — its generated class is `fixedGeometry`, and an
   * image-to-image re-render comes back at the shape it was given. That is the
   * commonest and most sensible thing an editing route can do, and it is
   * `refused` rather than `declared` for the usual fal reason: sibling
   * endpoints in the same adapter (the kontext routes, the nano-banana edits)
   * do carry `aspect_ratio`.
   *
   * The `strength` scale starts at **0.01, not 0**. fal's schema floors it
   * there, so canonical 0 — "keep the source" — has no exact wire value and
   * the adapter clamps up to the floor and warns. Declaring the scale here is
   * what makes that visible rather than a surprise.
   */
  fal: {
    ref: "fal/fal-ai/flux/dev/image-to-image",
    adapter: fal,
    size: null,
    sizeString: null,
    extra: { num_inference_steps: 20 },
    strength: { at: "strength", atZero: 0.01, atOne: 1 },
    n: "native",
    seed: "native",
    outputFormat: "native",
    aspectRatio: "refused",
    dimensions: "refused",
  },
  recraft: {
    ref: "recraft/recraftv4_1",
    adapter: recraft,
    base: { strength: 0.5 },
    size: null,
    sizeString: null,
    // `style_id` is V3-only on imageToImage; `controls` is the V4.1 row's extra.
    extra: { controls: { colors: [{ rgb: [255, 102, 0] }] } },
    // The one route whose dial already means what the canonical one means.
    strength: { at: "strength", atZero: 0, atOne: 1 },
    n: "native",
    seed: "native",
    outputFormat: "native",
    aspectRatio: "declared",
    dimensions: "declared",
  },
  /**
   * A router whose body nests its params under `input`, and the one provider
   * here whose source is a URL with no inline alternative.
   *
   * `ideogram-v3` is profiled because it is a row that declares an extra
   * (`quality`, typed from the tiers the catalog lists for it). It lists no
   * shapes, so its `aspect_ratio` is free-form — any `W:H`, the S5 shape — and
   * pixels reach it as the exact ratio they reduce to, with the warning that
   * conversion always carries. The models that DO list shapes are swept in
   * `image-presets.test.ts`.
   */
  revana: {
    ref: "revana/ideogram-v3",
    adapter: revana,
    size: { class: "ratio-string", at: "input.aspect_ratio" },
    sizeString: null,
    extra: { quality: "turbo" },
    extraAt: "input",
    strength: "declared",
    n: "native",
    seed: "native",
    outputFormat: "declared",
    aspectRatio: "native",
    dimensions: "derived",
    warns: ["dimensions"],
  },
  /**
   * One mode of a forty-feature route, and the only row with no extras and no
   * shape word of any kind. Photoroom's second ref is a removal, and is a row
   * of `REMOVE_BACKGROUND` below.
   *
   * `extra: null` because what accompanies an Edit With AI call is a family of
   * reference pictures under names the CALLER picks
   * (`editWithAI.additionalImages.<name>.imageFile`), and an extra is one exact
   * key — so they ride in `providerOptions.photoroom`, which
   * `image-edit-e2e.test.ts` exercises.
   *
   * All three shape columns are `declared` rather than `refused`: neither of
   * this adapter's two models has the field, so there is no sibling that does.
   */
  photoroom: {
    ref: "photoroom/edit-with-ai",
    adapter: photoroom,
    size: null,
    sizeString: null,
    extra: null,
    strength: "declared",
    n: "declared",
    seed: "native",
    outputFormat: "native",
    aspectRatio: "declared",
    dimensions: "declared",
  },
  /**
   * A route for a ref, flat body, URL-only source. Qwen Image 3's edit route
   * takes the picture as a LIST (`image_urls`), sizes by a closed shape list,
   * and has a `seed`; it renders one image and has no encoding parameter, so
   * `n` and `outputFormat` are refused by its row. `resolution` is its extra:
   * the edit vocabulary has no tier word, and the route's own is `1k | 2k`.
   */
  higgsfield: {
    ref: "higgsfield/alibaba/qwen-image-3/edit",
    adapter: higgsfield,
    size: { class: "ratio-enum", at: "aspect_ratio" },
    sizeString: null,
    extra: { resolution: "2k" },
    strength: "declared",
    n: "refused",
    seed: "native",
    outputFormat: "refused",
    aspectRatio: "native",
    dimensions: "derived",
    warns: ["dimensions"],
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
  // `size`, `dimensions` and `aspectRatio` are the XOR group, so a base shape
  // has to step aside for either of the other two rather than fight it.
  const base =
    "dimensions" in extra || "size" in extra
      ? { ...row.base, aspectRatio: undefined }
      : row.base;
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

/** A dotted wire path into a compiled body — revana nests everything under `input`. */
function at(body: Record<string, unknown>, path: string): unknown {
  let node: unknown = body;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
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

test("the two tables cover exactly the providers in the pack", () => {
  const covered = new Set([...Object.keys(TABLE), ...Object.keys(REMOVE_BACKGROUND)]);
  expect([...covered].sort()).toEqual([...imageEdit.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  // -------------------------------------------------------------------------
  // image — the flagship row, in both directions
  // -------------------------------------------------------------------------

  test(`the \`size\` string is ${row.sizeString ?? "not a word this model has"}`, () => {
    const model = row.ref.slice(row.ref.indexOf("/") + 1);
    const presets = (
      row.adapter as { modelParams?: Readonly<Record<string, { sizes?: readonly string[] }>> }
    ).modelParams?.[model]?.sizes;

    if (row.sizeString === null) {
      expect(presets, `${provider} declares sizes but the table says it has none`).toBeUndefined();
      return;
    }
    expect(presets, `${provider} has no presets to probe`).toBeDefined();
    const preset = presets?.[0] as string;
    const compiled = compile(row, { size: preset } as Partial<ImageEditParams>);
    expect(compiled, `${provider} could not compile its own first preset`).not.toBeInstanceOf(
      Array,
    );
    if (Array.isArray(compiled)) return;
    expect(carries(compiled, preset), `${provider} size verbatim`).toBe(row.sizeString === "native");
  });

  const extraTitle =
    row.extra === null
      ? "declares no extras, and says so"
      : "the extra is declared and reaches the wire verbatim";
  test(extraTitle, () => {
    const model = row.ref.slice(row.ref.indexOf("/") + 1);
    const extras = (
      row.adapter as {
        modelParams?: Readonly<Record<string, { extras?: Readonly<Record<string, unknown>> }>>;
      }
    ).modelParams?.[model]?.extras;
    if (row.extra === null) {
      expect(extras, `${provider} ${model} declares extras but the table says it has none`)
        .toBeUndefined();
      return;
    }
    for (const key of Object.keys(row.extra)) {
      expect(Object.hasOwn(extras ?? {}, key), `${provider} ${model} does not declare ${key}`)
        .toBe(true);
    }
    const compiled = compile(row, row.extra as Partial<ImageEditParams>);
    expect(compiled, `${provider} could not compile its own extra`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const node = (row.extraAt === undefined ? compiled.body : at(compiled.body, row.extraAt)) as
      Record<string, unknown>;
    for (const [key, value] of Object.entries(row.extra)) {
      expect(node[key], `${provider} ${key} verbatim`).toEqual(value);
    }
  });

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
    for (const operation of ["inpaint", "outpaint", "upscale", "removeBackground", "", 7, undefined]) {
      const compiled = compile(row, { operation } as Partial<ImageEditParams>);
      expect(compiled, `${provider} accepted operation ${JSON.stringify(operation)}`).toEqual([
        "invalid_enum_value @ operation",
      ]);
    }
  });

  test("a removal written the way the removal arm is typed is refused the same way", () => {
    // No `prompt`: that is what a caller who means `removeBackground` writes,
    // and every edit adapter reads `input.prompt`. The refusal has to be the
    // operation, not a crash and not a complaint about the missing sentence.
    const compiled = compile(row, {
      operation: "removeBackground",
      prompt: undefined,
    } as unknown as Partial<ImageEditParams>);
    expect(compiled).toEqual(["invalid_enum_value @ operation"]);
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
        //
        // Refused EITHER WAY, and the table may say which. `declared` is an
        // adapter-wide gap (Recraft: no Recraft editing route has a shape
        // field); `refused` is model-dependent (fal: this endpoint has none,
        // and the kontext endpoints in the same adapter do). Both are a
        // rejection at the canonical path — which is the property this column
        // is about — and the row's own `aspectRatio` / `dimensions` tests have
        // already checked the distinction against the adapter's `unsupported`
        // record. Pinning `declared` here would say that a provider serving one
        // route with a shape field and one without has to lie about one of
        // them.
        expect(["declared", "refused"]).toContain(row.aspectRatio);
        expect(["declared", "refused"]).toContain(row.dimensions);
        return;
      }
      const compiled = compile(row, { aspectRatio: PROBE.aspectRatio });
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      const landed = at(compiled.body, row.size.at);
      const value = String(landed);
      expect(landed, `${provider} wrote nothing at ${row.size.at}`).toBeDefined();
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

// ---------------------------------------------------------------------------
// operation: "removeBackground" — the second table
// ---------------------------------------------------------------------------

/** How one canonical `outputFormat` lands: the wire value, or a refusal. */
type FormatCell = string | "refused";

interface RemovalCapability {
  ref: string;
  adapter: Readonly<{
    provider: string;
    imageInputs: readonly ImageEditInputKind[];
    unsupported?: Readonly<Partial<Record<string, string>>>;
    modelParams?: ImageEditModelParamTable;
  }>;
  /** The wire field the picture lands in. */
  at: string;
  /** The wire field the encoding lands in. */
  formatAt: string;
  /** Each canonical encoding → the wire value it becomes, or `"refused"`. */
  format: Readonly<Record<"png" | "jpeg" | "webp", FormatCell>>;
  /**
   * How each word of the edit arm is refused: `declared` on the adapter's
   * `unsupported` record (no model of this provider has it), `refused` by hand
   * in `compile` (a sibling model does).
   */
  editWords: Readonly<Record<(typeof EDIT_ONLY_WORDS)[number], "declared" | "refused">>;
  /** The extras this model declares, each with a legal value; `null` claims none. */
  extras: Readonly<Record<string, unknown>> | null;
  /** The route the request must be addressed to. */
  url: string;
}

/** The seven words `ImageEditRemoveBackgroundParams` types as `never`. */
const EDIT_ONLY_WORDS = [
  "prompt",
  "strength",
  "n",
  "seed",
  "size",
  "aspectRatio",
  "dimensions",
] as const;

const EDIT_ONLY_PROBE: Readonly<Record<(typeof EDIT_ONLY_WORDS)[number], unknown>> = {
  prompt: "A probe.",
  strength: 0.25,
  n: 2,
  seed: 7,
  size: "1024x1024",
  aspectRatio: "1:1",
  dimensions: { width: 1024, height: 1024 },
};

const ALL_DECLARED = {
  prompt: "declared",
  strength: "declared",
  n: "declared",
  seed: "declared",
  size: "declared",
  aspectRatio: "declared",
  dimensions: "declared",
} as const;

/** One row per provider that serves `operation: "removeBackground"`. */
const REMOVE_BACKGROUND: Readonly<Record<string, RemovalCapability>> = {
  /**
   * The whole adapter is this one operation, so every edit word is a declared
   * gap. `jpeg` is refused: the route returns an alpha channel and offers
   * `png` and `webp`.
   */
  stability: {
    ref: "stability/stable-image-remove-background",
    adapter: stability,
    at: "image",
    formatAt: "output_format",
    format: { png: "png", jpeg: "refused", webp: "webp" },
    editWords: ALL_DECLARED,
    extras: null,
    url: "https://api.stability.ai/v2beta/stable-image/edit/remove-background",
  },
  /**
   * The mixed adapter. `prompt` and `seed` are `refused`, not `declared`:
   * `photoroom/edit-with-ai` takes both. `jpeg` is re-spelled, not refused —
   * `/v1/segment` encodes JPEG and calls it `jpg`.
   */
  photoroom: {
    ref: "photoroom/remove-background",
    adapter: photoroom,
    at: "image_file",
    formatAt: "format",
    format: { png: "png", jpeg: "jpg", webp: "webp" },
    editWords: { ...ALL_DECLARED, prompt: "refused", seed: "refused" },
    extras: { bg_color: "#FF00FF", channels: "alpha", crop: "true", despill: "true" },
    url: "https://sdk.photoroom.com/v1/segment",
  },
};

function compileRemoval(
  row: RemovalCapability,
  extra: Readonly<Record<string, unknown>> = {},
): Compiled | string[] {
  const result = imageEdit.safe({
    operation: "removeBackground",
    model: row.ref,
    image: IMAGE_FOR.file(),
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  const body = JSON.parse(
    JSON.stringify(result.params, (_key, value: unknown) =>
      value instanceof Blob ? `blob:${value.size}:${value.type}` : value,
    ),
  ) as Record<string, unknown>;
  return { body, url: request.request.url };
}

describe.each(Object.entries(REMOVE_BACKGROUND))("removeBackground · %s", (provider, row) => {
  const model = row.ref.slice(row.ref.indexOf("/") + 1);

  test("the model's row is what says it removes", () => {
    expect(row.adapter.modelParams?.[model]?.operations).toEqual(["removeBackground"]);
  });

  test("a picture and nothing else compiles, to the removal route", () => {
    const compiled = compileRemoval(row);
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.url).toBe(row.url);
    expect(compiled.body).toEqual({ [row.at]: "blob:64:image/png" });
  });

  test("accepts exactly the image kinds it declares", () => {
    for (const kind of IMAGE_KINDS) {
      const compiled = compileRemoval(row, { image: IMAGE_FOR[kind]() });
      if (row.adapter.imageInputs.includes(kind)) {
        expect(compiled, `${provider} refused a declared \`${kind}\``).not.toBeInstanceOf(Array);
      } else {
        expect(compiled, `${provider} accepted an undeclared \`${kind}\``).toEqual([
          "unsupported_param @ image",
        ]);
      }
    }
  });

  test.each(Object.entries(row.format))("outputFormat %s → %s", (format, cell) => {
    const compiled = compileRemoval(row, { outputFormat: format });
    if (cell === "refused") {
      expect(compiled).toEqual(["invalid_enum_value @ outputFormat"]);
      return;
    }
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.formatAt]).toBe(cell);
  });

  test.each([...EDIT_ONLY_WORDS])("%s belongs to an edit, and is refused at its own name", (word) => {
    const declared = row.adapter.unsupported?.[word];
    if (row.editWords[word] === "declared") {
      expect(declared, `${provider}.unsupported.${word}`).toBeDefined();
    } else {
      expect(declared, `${provider} must NOT declare ${word}: a sibling model takes it`)
        .toBeUndefined();
    }
    expect(compileRemoval(row, { [word]: EDIT_ONLY_PROBE[word] })).toEqual([
      `unsupported_param @ ${word}`,
    ]);
  });

  test("`operation: \"edit\"` is refused at `operation`, and so is everything else", () => {
    for (const operation of ["edit", "inpaint", "", 7, undefined]) {
      expect(
        compileRemoval(row, { operation }),
        `${provider} accepted operation ${JSON.stringify(operation)}`,
      ).toEqual(["invalid_enum_value @ operation"]);
    }
    // Written the way the edit arm is typed, the sentence is refused as well:
    // the route has nowhere to put it, whatever the operation is called. Sorted,
    // because a declared gap is reported by the kernel before `compile` runs and
    // a model-dependent one from inside it.
    const both = compileRemoval(row, { operation: "edit", prompt: "A probe." });
    expect(Array.isArray(both) && [...both].sort()).toEqual([
      "invalid_enum_value @ operation",
      "unsupported_param @ prompt",
    ]);
  });

  test(
    row.extras === null
      ? "declares no extras, and says so"
      : "every extra is declared and reaches the wire verbatim",
    () => {
      const declared = row.adapter.modelParams?.[model]?.extras;
      if (row.extras === null) {
        expect(declared).toBeUndefined();
        return;
      }
      expect(Object.keys(declared ?? {}).sort()).toEqual(Object.keys(row.extras).sort());
      const compiled = compileRemoval(row, row.extras);
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      for (const [key, value] of Object.entries(row.extras)) {
        expect(compiled.body[key], `${provider} ${key} verbatim`).toEqual(value);
      }
    },
  );

  test("no silent drops: every accepted probe changes the request", () => {
    const bare = compileRemoval(row);
    expect(bare).not.toBeInstanceOf(Array);
    if (Array.isArray(bare)) return;
    const probes: Array<Readonly<Record<string, unknown>>> = [
      ...ALL_FORMATS.map((outputFormat) => ({ outputFormat })),
      ...EDIT_ONLY_WORDS.map((word) => ({ [word]: EDIT_ONLY_PROBE[word] })),
      ...Object.entries(row.extras ?? {}).map(([key, value]) => ({ [key]: value })),
    ];
    const dropped: string[] = [];
    let accepted = 0;
    for (const probe of probes) {
      const compiled = compileRemoval(row, probe);
      if (Array.isArray(compiled)) continue;
      accepted += 1;
      if (serialize(compiled) === serialize(bare)) dropped.push(JSON.stringify(probe));
    }
    expect(accepted).toBeGreaterThan(0);
    expect(dropped, `${provider} accepted and ignored a param`).toEqual([]);
  });
});

test("an extra of the removal model is refused at the edit model of the same adapter", () => {
  const result = imageEdit.safe({
    operation: "edit",
    model: "photoroom/edit-with-ai",
    prompt: "A probe.",
    image: IMAGE_FOR.file(),
    bg_color: "red",
  } as never);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`)).toEqual([
    "unsupported_param @ bg_color",
  ]);
  expect(result.errors[0]?.message).toContain("remove-background");
});

test("an id outside Photoroom's two handles is refused; overruled, it is served whichever operation the caller names", () => {
  // Photoroom's ids are unmodel's names for routes, so no newer model can
  // appear under one: an unlisted id is a typo, refused at `model`. A caller
  // who demotes that gets the operation they wrote, compiled by the adapter
  // that serves both.
  for (const [operation, url] of [
    ["edit", "https://image-api.photoroom.com/v2/edit"],
    ["removeBackground", "https://sdk.photoroom.com/v1/segment"],
  ] as const) {
    const params = {
      operation,
      model: "photoroom/not-in-this-snapshot",
      ...(operation === "edit" && { prompt: "A probe." }),
      image: IMAGE_FOR.file(),
    } as never;
    const refused = imageEdit.safe(params);
    expect(!refused.ok && refused.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`), operation).toEqual([
      "invalid_enum_value @ model",
    ]);
    const result = imageEdit.safe(params, { severity: { invalid_enum_value: "warning" } });
    expect(result.ok, operation).toBe(true);
    if (!result.ok) continue;
    expect((result.params as unknown as { request: { url: string } }).request.url).toBe(url);
    expect(result.warnings.map((issue) => issue.code)).toContain("unknown_model");
  }
});
