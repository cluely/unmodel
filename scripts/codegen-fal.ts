/**
 * Generates the fal.ai endpoint surface from fal's OWN published OpenAPI
 * documents, plus three hand-maintained inputs that the schema cannot supply.
 *
 *   bun run codegen:fal           regenerate src/providers/fal/gen/** from data/fal/
 *   bun run codegen:fal:refresh   fetch the curated endpoints' schemas first, then regenerate
 *   bun run codegen:fal:check     re-fetch and compare against the committed snapshots (network; no writes)
 *   bun run codegen:fal:audit     crawl fal's model listing and report roster drift (network; no writes)
 *
 * ## The thesis
 *
 * **The generator emits DATA and TYPES; hand code owns BEHAVIOUR.** No file
 * this script writes contains a check, a message, a reason, an estimate or a
 * `createValidator`. It emits, per category: the wire types, ONE
 * `z.looseObject` union schema, a compact per-endpoint IR (`FAL_<V>_SHAPES`)
 * that the hand check battery reads, the catalog rows, and the endpoint id
 * lists. Everything that decides what to *say* about a bad request lives in
 * `src/providers/fal/*.ts`, hand-written, once.
 *
 * ## Why fal gets a generator when no other provider does
 *
 * fal publishes a real OpenAPI 3.0 document per endpoint through a documented,
 * keyless Platform API — enums, defaults, bounds, `required`, field order and a
 * citable `documentationUrl`. It is the first provider where "types from docs,
 * never SDKs" has a machine-readable source, and at ~100 curated endpoints it
 * is also the first where hand transcription would be a rolling liability
 * rather than an afternoon.
 *
 * What the schema CANNOT tell us is curated by hand, in three separate files
 * because they change on three different clocks:
 *   • `data/fal/curation.json` — which endpoints, and under which verb (fal's
 *     own `category` is lossy: music hides in text-to-audio, edits and upscale
 *     are both "image-to-image"). `unified: false` keeps an exact provider-
 *     native row out of a canonical vocabulary that cannot represent it.
 *   • `data/fal/pricing.json` — the rates, transcribed from public model pages
 *     with quote + URL + date, because fal publishes no machine-readable price.
 *   • `data/fal/overlays.json` — every deviation from the published schema.
 *
 * ## Determinism
 *
 * Output is a pure function of the committed inputs: no clock, no network, no
 * `Date`, everything sorted, shared names derived from content rather than from
 * an index (so a new endpoint does not renumber — and therefore does not churn
 * — every constant below it). CI runs `bun run codegen:fal` and diffs.
 *
 * ## Loud failure
 *
 * Every construct the lowering table does not model is a HARD ERROR naming the
 * endpoint and the JSON pointer, never a silent `unknown`: `allOf`/`oneOf`/
 * `not`/`discriminator`, a boolean `exclusiveMinimum`, an `x-fal-order-properties`
 * that disagrees with the property set, an unclassifiable geometry shape, a
 * curated endpoint with no price, an overlay for a parameter that no longer
 * exists, a top-level `model` property that curation has not allow-listed, and
 * any property named `endpoint` (which would collide with unmodel's route
 * pseudo-param). A generator that guesses is worse than one that stops.
 */

import { z } from "zod";
import {
  num,
  pascalCase,
  quote,
  renderLimit,
  renderMediaCost,
  renderStringArray,
  sortKeysDeep,
  type MediaCostInput,
} from "./emit";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * The documented Platform API. **Never** the website route
 * `fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`: fal's robots.txt
 * disallows `/*?endpoint_id=`, and a generator that scrapes a disallowed route
 * is a generator that stops working the day someone notices.
 */
const PLATFORM_API_URL = "https://api.fal.ai/v1/models";

/** Submit host. Asserted against every snapshot's own `servers[0].url` + path. */
const QUEUE_BASE_URL = "https://queue.fal.run";

const DATA_DIR = new URL("../data/fal/", import.meta.url).pathname;
const OPENAPI_DIR = `${DATA_DIR}openapi/`;
const CURATION_PATH = `${DATA_DIR}curation.json`;
const PRICING_PATH = `${DATA_DIR}pricing.json`;
const OVERLAYS_PATH = `${DATA_DIR}overlays.json`;
const MANIFEST_PATH = `${DATA_DIR}manifest.json`;
const GEN_DIR = new URL("../src/providers/fal/gen/", import.meta.url).pathname;

/** ids per Platform API call. The response paginates independently of this. */
const BATCH_SIZE = 50;

/** How long a retired endpoint's row stays shippable before codegen fails. */
const RETIREMENT_ESCROW_DAYS = 90;

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

/**
 * The ten unmodel verbs fal serves. Sorted, and the sort IS the emission
 * order — `image` before `imageEdit` is plain string order, not a special case.
 *
 * `threeD` is the one verb here that is not its category's id: the category is
 * `"3d"`, which is not a TypeScript identifier and therefore cannot be an
 * export name, a generated constant stem or a file stem. So the verb is the
 * identifier spelling and everything derived from it follows —
 * `three-d-wire.gen.ts`, `FAL_THREE_D_SHAPES`, `FalThreeDBodyById` — while the
 * package subpath, the CLI's unified id and `endpointLabel` all stay `3d`.
 */
const VERBS = [
  "avatar",
  "image",
  "imageEdit",
  "lipsync",
  "music",
  "stt",
  "threeD",
  "tts",
  "upscale",
  "video",
] as const;

type Verb = (typeof VERBS)[number];

/** `"imageEdit"` → `"image-edit"`: the file-name spelling of a verb. */
function verbSlug(verb: Verb): string {
  return verb.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** `"imageEdit"` → `"IMAGE_EDIT"`: the constant-name spelling of a verb. */
function verbConst(verb: Verb): string {
  return verbSlug(verb).replace(/-/g, "_").toUpperCase();
}

/**
 * The modality a verb necessarily outputs, where the verb fixes one.
 *
 * `upscale` is deliberately absent: a super-resolution endpoint takes an image
 * OR a video and returns the same kind back, so its output modality is a fact
 * about the endpoint and is read off the response schema. Every other verb
 * fixes it, and a response schema that disagrees is a mis-curated verb — which
 * is exactly what the cross-check below turns into an error.
 */
const VERB_OUTPUT_MODALITY: Partial<Record<Verb, string>> = {
  avatar: "video",
  image: "image",
  imageEdit: "image",
  lipsync: "video",
  music: "audio",
  stt: "text",
  // `Modality` grew a `"3d"` member for this: a mesh is not a picture of one,
  // and every route here also returns a preview render, so reading the modality
  // off the response schema without a word for the mesh would file the whole
  // category under `"image"`.
  threeD: "3d",
  tts: "audio",
  video: "video",
};

// ---------------------------------------------------------------------------
// Hand inputs. Loose everywhere a future field might land; strict on the
// fields that decide what gets emitted.
// ---------------------------------------------------------------------------

const curationEntrySchema = z.looseObject({
  verb: z.enum(VERBS),
  unified: z.literal(false).optional(),
  textParam: z.string().optional(),
  allowsModelProperty: z.boolean().optional(),
  note: z.string().optional(),
  retiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * The `excluded` block — reasons, not rows, and now shipped as data.
 *
 * `$comment` keys are prose for the reader of the JSON and are dropped here;
 * everything else is `id → reason` (or `fal category → reason`) and is emitted
 * verbatim into `endpoints.gen.ts`, where `runFalChecks` can hand a caller who
 * names an excluded id the recorded reason instead of a bare `unknown_model`
 * that implies catalog lag.
 */
const curationExcludedSchema = z.looseObject({
  categories: z.record(z.string(), z.string()).optional(),
  endpoints: z.record(z.string(), z.string()).optional(),
});

const curationSchema = z.looseObject({
  endpoints: z.record(z.string(), curationEntrySchema),
  excluded: curationExcludedSchema.optional(),
});

const pricingRowSchema = z.looseObject({
  unit: z.string().optional(),
  usd: z.number().optional(),
  rounding: z.string().optional(),
  tierKey: z.string().optional(),
  tiers: z.array(z.looseObject({ when: z.string(), usd: z.number() })).optional(),
  unpriced: z.string().optional(),
  source: z.string(),
  verified: z.string(),
  quote: z.string().optional(),
});

const pricingSchema = z.looseObject({
  endpoints: z.record(z.string(), pricingRowSchema),
});

const overlaySchema = z.looseObject({
  kind: z.enum([
    "enumAdd",
    "enumRemove",
    "rangeOverride",
    "rangeSoft",
    "denyParam",
    "typeOverride",
    "shapeClass",
    "durationsAreSeconds",
    /**
     * The media kind a parameter carries, stated by hand.
     *
     * The escape hatch for `mediaFromName`, which classifies a parameter only
     * when its name both ends in `_url`/`_urls` and names a medium. A fal
     * endpoint that spells a file input any other way — or one the rule
     * classifies WRONGLY — is corrected here. `value` is the kind (`"image"`,
     * `"video"`, `"audio"`, `"file"`); omitting it SUPPRESSES a classification
     * the rule made.
     */
    "media",
    "note",
  ]),
  param: z.string().optional(),
  /** The value the overlay asserts, for the kinds that carry one (`media`). */
  value: z.string().optional(),
  reason: z.string(),
  source: z.string(),
  verified: z.string(),
});

const overlaysSchema = z.looseObject({
  endpoints: z.record(z.string(), z.array(overlaySchema)),
});

type CurationEntry = z.output<typeof curationEntrySchema>;
type PricingRow = z.output<typeof pricingRowSchema>;

/** One committed snapshot file: fal's document, plus fal's own listing row. */
const snapshotSchema = z.looseObject({
  openapi: z.looseObject({
    openapi: z.string().optional(),
    info: z.looseObject({}).optional(),
    paths: z.record(z.string(), z.unknown()),
    servers: z.array(z.looseObject({ url: z.string() })),
    components: z.looseObject({ schemas: z.record(z.string(), z.unknown()) }),
  }),
  metadata: z.looseObject({}).optional(),
});

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Canonical JSON — key order removed, so two schemas compare on content. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * FNV-1a, 32-bit, as six hex digits.
 *
 * Hand-rolled rather than `Bun.hash` or `node:crypto` on purpose: these six
 * characters end up in EXPORTED identifier names, so the function that
 * produces them has to be stable across runtimes and across versions of both.
 * A hash whose algorithm can change under you is a rename waiting to happen in
 * every generated file at once.
 */
function hash6(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(2);
}

function sorted<T>(values: Iterable<T>): T[] {
  return [...values].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}

/** `"fal-ai/flux/dev"` → `"fal-ai__flux__dev.json"`. */
export function snapshotFileName(endpointId: string): string {
  return `${endpointId.replace(/\//g, "__")}.json`;
}

/**
 * A `description` fit for a JSDoc block: one line, no comment terminator, no
 * runaway prose. fal's descriptions are Python docstrings — leading newlines,
 * eight-space indents — so the whitespace collapse is not cosmetic: without it
 * a generated doc comment inherits an indentation the file does not have.
 */
function jsdocText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\*\//g, "*⁄").trim();
}

/**
 * Renders a JSDoc block, re-flowed to `width`.
 *
 * Consecutive entries are ONE paragraph and are joined before wrapping, so the
 * emitters can write prose in whatever line lengths read well in this file
 * without that choice showing up in the output. An empty entry is a paragraph
 * break; an entry that starts with whitespace or a bullet is emitted verbatim
 * (that is how a pricing tier table keeps one rate per line).
 */
function renderDoc(lines: readonly string[], indent: string, width = 88): string {
  const blocks: Array<{ verbatim: boolean; text: string }> = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ verbatim: false, text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      blocks.push({ verbatim: true, text: "" });
    } else if (/^[\s•\-|]/.test(line)) {
      flush();
      blocks.push({ verbatim: true, text: line.replace(/\s+$/, "") });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  while (blocks.length > 0 && (blocks[blocks.length - 1] as { text: string }).text === "") blocks.pop();

  const out: string[] = [];
  for (const block of blocks) {
    if (block.verbatim) {
      out.push(block.text);
      continue;
    }
    let current = "";
    for (const word of block.text.split(" ").filter(Boolean)) {
      if (current.length > 0 && `${current} ${word}`.length > width) {
        out.push(current);
        current = word;
      } else {
        current = current.length > 0 ? `${current} ${word}` : word;
      }
    }
    if (current.length > 0) out.push(current);
  }
  if (out.length === 0) return "";
  if (out.length === 1) return `${indent}/** ${out[0]} */\n`;
  return `${indent}/**\n${out
    .map((line) => (line === "" ? `${indent} *` : `${indent} * ${line}`))
    .join("\n")}\n${indent} */\n`;
}

/** Renders a JS value literal (used for `default:` in docs, never for types). */
function literal(value: unknown): string {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// The lowering IR
//
// One node kind per construct the table models. Anything else is a hard error
// at the point it is met, so `unknown` in this union always means "fal itself
// declared nothing", never "the generator gave up".
// ---------------------------------------------------------------------------

type PrimType = "string" | "number" | "integer" | "boolean";

type Node =
  | {
      k: "prim";
      t: PrimType;
      enum?: readonly (string | number)[];
      /**
       * The enum is a SUGGESTION, not a closed set — fal spells this
       * `anyOf: [{enum: [...]}, {type: "string"}]`, i.e. "these values, or any
       * other string". An unlisted value is a warning, never a refusal.
       */
      open?: true;
      min?: number;
      max?: number;
      xmin?: number;
      xmax?: number;
      minLen?: number;
      maxLen?: number;
    }
  | { k: "array"; items: Node; minItems?: number; maxItems?: number }
  /**
   * `anyOf[T, null]` in a position that has no `Prop` to carry the flag —
   * inside an array's `items`, most often. At property level nullability lives
   * on {@link Prop} instead, because that is where the emitters need it.
   */
  | { k: "nullable"; inner: Node }
  | { k: "ref"; hash: string }
  | { k: "record"; values: Node }
  | { k: "object"; props: Record<string, Prop>; order: string[] }
  | { k: "union"; arms: Node[] }
  | { k: "unknown" };

interface Prop {
  node: Node;
  /** In the schema's own `required` list. */
  required: boolean;
  /** `anyOf[T, null]` — an explicit `null` is accepted on the wire. */
  nullable: boolean;
  /** fal fills this in, so omitting it is always safe. */
  hasDefault: boolean;
  default?: unknown;
  description?: string;
  /** `ui.field` — fal's own hint that this string carries a media reference. */
  media?: string;
}

interface ObjectModel {
  props: Record<string, Prop>;
  /** `x-fal-order-properties`, asserted to be exactly the property key set. */
  order: string[];
}

interface ComponentModel {
  title: string;
  hash: string;
  model: ObjectModel;
  /** Hashes of the components this one references, for ordered emission. */
  deps: string[];
}

/** Every distinct `$ref` component across every snapshot, deduped by content. */
class ComponentRegistry {
  readonly byHash = new Map<string, ComponentModel>();
  private names = new Map<string, string>();

  add(component: ComponentModel): void {
    if (!this.byHash.has(component.hash)) this.byHash.set(component.hash, component);
  }

  /**
   * Assigns each component its exported type name.
   *
   * A title that names exactly ONE distinct schema keeps the clean name
   * (`FalFile`). A title that names several — fal has two different `Image`
   * components in the wave-1a set alone, one with required `width`/`height`
   * and one with them nullable — gets the content hash appended to *every*
   * variant, including any that was previously alone. Deriving the
   * disambiguator from content rather than from discovery order is what stops
   * a new endpoint from renaming an existing type.
   */
  finalize(): void {
    const byTitle = new Map<string, ComponentModel[]>();
    for (const component of sorted([...this.byHash.keys()])) {
      const entry = this.byHash.get(component) as ComponentModel;
      const list = byTitle.get(entry.title) ?? [];
      list.push(entry);
      byTitle.set(entry.title, list);
    }
    for (const [title, list] of byTitle) {
      const base = `Fal${pascalCase(title)}`;
      for (const entry of list) {
        this.names.set(entry.hash, list.length === 1 ? base : `${base}_${entry.hash}`);
      }
    }
  }

  name(hash: string): string {
    const name = this.names.get(hash);
    if (name === undefined) throw new Error(`Internal: no name assigned for component ${hash}`);
    return name;
  }

  /** Components in dependency order, then by name — a valid emission order. */
  ordered(): ComponentModel[] {
    const out: ComponentModel[] = [];
    const seen = new Set<string>();
    const visit = (hash: string): void => {
      if (seen.has(hash)) return;
      seen.add(hash);
      const entry = this.byHash.get(hash) as ComponentModel;
      for (const dep of sorted(entry.deps)) visit(dep);
      out.push(entry);
    };
    for (const hash of sorted([...this.byHash.keys()].map((h) => `${this.name(h)} ${h}`))) {
      visit(hash.split(" ")[1] as string);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Lowering: fal's OpenAPI → the IR above
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

interface LowerCtx {
  endpointId: string;
  schemas: Record<string, Schema>;
  registry: ComponentRegistry;
  /** component name → hash, memoized per document. */
  resolved: Map<string, string>;
  /** cycle detection. */
  visiting: Set<string>;
}

function fail(ctx: LowerCtx, pointer: string, message: string): never {
  throw new Error(`${ctx.endpointId} at ${pointer}: ${message}`);
}

/**
 * The constructs unmodel refuses to guess at.
 *
 * `allOf` would need a merge algebra whose result nobody reviewed; `oneOf` and
 * `discriminator` describe a body union that a single `z.looseObject` cannot
 * express; `not` has no faithful lowering at all. Each is a signal that the
 * endpoint wants either a curation decision or an overlay, and the error says
 * which endpoint and which pointer so that decision is one grep away.
 */
const REFUSED_KEYWORDS = ["allOf", "oneOf", "not", "discriminator"] as const;

function assertModellable(node: unknown, pointer: string, ctx: LowerCtx): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertModellable(item, `${pointer}/${index}`, ctx));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const schema = node as Schema;
  for (const keyword of REFUSED_KEYWORDS) {
    if (keyword in schema) {
      fail(
        ctx,
        `${pointer}/${keyword}`,
        `\`${keyword}\` has no faithful lowering — curate the endpoint out, or add an overlay in data/fal/overlays.json`,
      );
    }
  }
  for (const bound of ["exclusiveMinimum", "exclusiveMaximum"] as const) {
    if (bound in schema && typeof schema[bound] !== "number") {
      fail(
        ctx,
        `${pointer}/${bound}`,
        `\`${bound}\` must be a NUMBER (JSON Schema 2020-12 semantics, which is what fal emits under its "openapi: 3.0.4" label); got ${literal(schema[bound])}`,
      );
    }
  }
  for (const [key, value] of Object.entries(schema)) {
    assertModellable(value, `${pointer}/${key}`, ctx);
  }
}

function refName(ref: string, ctx: LowerCtx, pointer: string): string {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) fail(ctx, pointer, `unsupported $ref target ${quote(ref)}`);
  return ref.slice(prefix.length);
}

function registerComponent(name: string, ctx: LowerCtx, pointer: string): string {
  const memo = ctx.resolved.get(name);
  if (memo !== undefined) return memo;
  if (ctx.visiting.has(name)) {
    fail(ctx, pointer, `component ${quote(name)} is recursive, which the IR cannot express`);
  }
  const raw = ctx.schemas[name];
  if (raw === undefined) fail(ctx, pointer, `$ref names unknown component ${quote(name)}`);
  ctx.visiting.add(name);
  const deps = new Set<string>();
  const model = lowerObject(raw, `${pointer}→${name}`, ctx, deps);
  ctx.visiting.delete(name);

  // The hash covers the raw schema AND its resolved dependencies: two
  // documents can spell the same component text while its nested `$ref`
  // resolves to different content, and those are not the same type.
  const hash = hash6(`${canonical(raw)}|${sorted(deps).join(",")}`);
  const title = typeof raw["title"] === "string" ? (raw["title"] as string) : name;
  ctx.registry.add({ title, hash, model, deps: sorted(deps) });
  ctx.resolved.set(name, hash);
  return hash;
}

/** Lowers an object schema — the shape every fal input and output has. */
function lowerObject(raw: Schema, pointer: string, ctx: LowerCtx, deps: Set<string>): ObjectModel {
  const properties = (raw["properties"] ?? {}) as Record<string, Schema>;
  const required = new Set((raw["required"] ?? []) as string[]);
  const declared = Object.keys(properties);

  const order = raw["x-fal-order-properties"];
  if (!Array.isArray(order)) {
    fail(
      ctx,
      `${pointer}/x-fal-order-properties`,
      "missing — fal's own field order is the emission order, and inventing one would make every future " +
        "reordering look like a diff in this repo's output",
    );
  }
  const orderList = order as string[];
  const inOrder = sorted(orderList).join(",");
  const inProps = sorted(declared).join(",");
  if (inOrder !== inProps) {
    fail(
      ctx,
      `${pointer}/x-fal-order-properties`,
      `disagrees with the property set — order names [${inOrder}], properties are [${inProps}]`,
    );
  }

  const props: Record<string, Prop> = {};
  for (const name of orderList) {
    const schema = properties[name] as Schema;
    const lowered = lowerNode(schema, `${pointer}/properties/${name}`, ctx, deps);
    const description = typeof schema["description"] === "string" ? schema["description"] : undefined;
    props[name] = {
      node: lowered.node,
      required: required.has(name),
      nullable: lowered.nullable,
      hasDefault: "default" in schema,
      default: schema["default"],
      description,
      // fal's own `ui.field` wins where it exists; the parameter's name is the
      // fallback, and in practice the rule that fires. See mediaFromName.
      media: lowered.media ?? mediaFromName(name),
    };
  }
  return { props, order: orderList };
}

interface Lowered {
  node: Node;
  nullable: boolean;
  media?: string;
}

function mediaOf(schema: Schema): string | undefined {
  const ui = schema["ui"];
  if (typeof ui !== "object" || ui === null) return undefined;
  const field = (ui as Record<string, unknown>)["field"];
  return typeof field === "string" ? field : undefined;
}

/**
 * The media word a parameter's own NAME carries — the fallback for
 * {@link mediaOf}, and in practice the rule that does the work.
 *
 * fal documents a `ui.field` hint and almost never emits one: across the
 * wave-1a snapshots it appears exactly ONCE, on `tail_image_url`, and even
 * there it is buried in `anyOf[0]` rather than on the property. A media
 * detector built on it alone would classify one parameter in twelve endpoints
 * and miss every `image_url` fal serves, so the name is the primary source and
 * `ui.field` is the override that wins when fal bothers to state it.
 *
 * ## Why the rule is narrow
 *
 * Only a name ending in `_url` / `_urls` (or the bare `url`) is considered at
 * all, and only when what precedes it NAMES a medium. Two failure modes are
 * being avoided, and they pull in opposite directions:
 *
 * - Classifying every `*_url` as media would sweep in `webhook_url`,
 *   `response_url`, `status_url` and `cancel_url` — plumbing that carries an
 *   address, not a file. `checkMediaRefs` would then tell a caller their
 *   webhook was not a valid image reference.
 * - Classifying every parameter containing "image" would sweep in
 *   `image_size`, `num_images` and `enable_safety_checker` — a number and a
 *   boolean asked to be a URL.
 *
 * Requiring BOTH halves — a medium word and a URL suffix — is what makes the
 * rule safe enough to apply without review. A parameter this misses is simply
 * an unclassified string, which is the status quo; a parameter it gets wrong
 * would be a false error at run time. When fal names something in a way this
 * cannot see, a `media` overlay states it by hand.
 */
const MEDIA_NAME_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|_)(image|img|photo|picture|mask|frame|thumbnail|logo|garment|face)$/, "image"],
  [/(^|_)(video|clip|footage)$/, "video"],
  [/(^|_)(audio|voice|speech|music|sound)$/, "audio"],
];

/** Names that end in `_url` and are addresses rather than media. */
const MEDIA_NAME_DENY = /^(webhook|callback|redirect|response|status|cancel|queue|docs?|documentation)(_urls?)?$/;

/**
 * Collapses fal's OPEN-ENUM idiom into one primitive.
 *
 * fal spells "these values, or any other string" as
 * `anyOf: [{ type: "string", enum: [...] }, { type: "string" }]` — a suggested
 * vocabulary beside the bare type. `flux-pro/v1.1-ultra`'s `aspect_ratio` is
 * the canonical case: nine ratios listed, and a free `"1234:567"` accepted.
 *
 * Left as a two-arm union it would be wrong three ways over: the TypeScript
 * type would be `"21:9" | … | string`, which collapses to `string` and offers
 * no completions; the zod schema would be a pointless `union([enum, string])`;
 * and the shape classifier would refuse to classify it at all, because a
 * `union` is not one of the geometry shapes an adapter can branch on.
 *
 * Collapsed, all three come out right: `"21:9" | … | (string & {})` keeps the
 * completions while accepting any string, the schema is a bare `z.string()`,
 * and the classifier sees the string-with-enum it knows how to file. The
 * `open` flag is what carries "unlisted is a warning, not an error" through to
 * the check battery.
 *
 * Only fires when every arm is the same primitive type, at least one arm lists
 * values, and at least one does not — a genuinely closed union of two enums is
 * a different thing and stays a union.
 */
function openEnumOf(arms: readonly Lowered[]): Node | undefined {
  const nodes = arms.map((arm) => arm.node);
  if (!nodes.every((node): node is Extract<Node, { k: "prim" }> => node.k === "prim")) return undefined;
  const first = nodes[0] as Extract<Node, { k: "prim" }>;
  if (!nodes.every((node) => node.t === first.t)) return undefined;
  const listed = nodes.filter((node) => node.enum !== undefined);
  const bare = nodes.filter((node) => node.enum === undefined);
  if (listed.length === 0 || bare.length === 0) return undefined;
  const values: (string | number)[] = [];
  for (const node of listed) for (const value of node.enum ?? []) if (!values.includes(value)) values.push(value);
  return { k: "prim", t: first.t, enum: values, open: true };
}

function mediaFromName(name: string): string | undefined {
  if (MEDIA_NAME_DENY.test(name)) return undefined;
  const stem = name === "url" ? "" : /_urls?$/.test(name) ? name.replace(/_urls?$/, "") : undefined;
  if (stem === undefined) return undefined;
  // A bare `url` inside a component (fal's `File`, `Image`, `Audio`) is that
  // component's own payload; the component's title names the medium, not the
  // property, so a bare `url` stays unclassified here and is classified by the
  // property that REFERENCES the component.
  if (stem === "") return undefined;
  for (const [pattern, kind] of MEDIA_NAME_WORDS) if (pattern.test(stem)) return kind;
  return undefined;
}

function numberOf(schema: Schema, key: string): number | undefined {
  const value = schema[key];
  return typeof value === "number" ? value : undefined;
}

function lowerNode(schema: Schema, pointer: string, ctx: LowerCtx, deps: Set<string>): Lowered {
  const media = mediaOf(schema);

  if (typeof schema["$ref"] === "string") {
    const name = refName(schema["$ref"] as string, ctx, pointer);
    const hash = registerComponent(name, ctx, pointer);
    deps.add(hash);
    return { node: { k: "ref", hash }, nullable: false, media };
  }

  if (Array.isArray(schema["anyOf"])) {
    const arms = schema["anyOf"] as Schema[];
    const nullable = arms.some((arm) => arm["type"] === "null");
    const rest = arms.filter((arm) => arm["type"] !== "null");
    const lowered = rest.map((arm, index) =>
      lowerNode(arm, `${pointer}/anyOf/${index}`, ctx, deps),
    );
    const armMedia = media ?? lowered.find((entry) => entry.media !== undefined)?.media;
    if (lowered.length === 0) return { node: { k: "unknown" }, nullable: true, media: armMedia };
    if (lowered.length === 1) {
      const only = lowered[0] as Lowered;
      return { node: only.node, nullable: nullable || only.nullable, media: armMedia };
    }
    const openEnum = openEnumOf(lowered);
    if (openEnum !== undefined) return { node: openEnum, nullable, media: armMedia };
    return {
      node: { k: "union", arms: lowered.map((entry) => entry.node) },
      nullable,
      media: armMedia,
    };
  }

  // `const` is a one-value enum. Lowering it as such rather than as a
  // dedicated node kind means every consumer — types, zod, IR, the values
  // surface — handles it without a special case.
  const values: (string | number)[] | undefined = (() => {
    if ("const" in schema) return [schema["const"] as string | number];
    if (Array.isArray(schema["enum"])) return schema["enum"] as (string | number)[];
    return undefined;
  })();

  const declaredType = typeof schema["type"] === "string" ? (schema["type"] as string) : undefined;
  const inferredType =
    declaredType ?? (values !== undefined ? (typeof values[0] === "number" ? "number" : "string") : undefined);

  switch (inferredType) {
    case "string":
      return {
        node: {
          k: "prim",
          t: "string",
          ...(values === undefined ? {} : { enum: values }),
          ...(numberOf(schema, "minLength") === undefined ? {} : { minLen: numberOf(schema, "minLength") }),
          ...(numberOf(schema, "maxLength") === undefined ? {} : { maxLen: numberOf(schema, "maxLength") }),
        },
        nullable: false,
        media,
      };
    case "integer":
    case "number":
      return {
        node: {
          k: "prim",
          t: inferredType === "integer" ? "integer" : "number",
          ...(values === undefined ? {} : { enum: values }),
          ...(numberOf(schema, "minimum") === undefined ? {} : { min: numberOf(schema, "minimum") }),
          ...(numberOf(schema, "maximum") === undefined ? {} : { max: numberOf(schema, "maximum") }),
          ...(numberOf(schema, "exclusiveMinimum") === undefined
            ? {}
            : { xmin: numberOf(schema, "exclusiveMinimum") }),
          ...(numberOf(schema, "exclusiveMaximum") === undefined
            ? {}
            : { xmax: numberOf(schema, "exclusiveMaximum") }),
        },
        nullable: false,
        media,
      };
    case "boolean":
      return { node: { k: "prim", t: "boolean" }, nullable: false, media };
    case "array": {
      const items = (schema["items"] ?? {}) as Schema;
      const lowered = lowerNode(items, `${pointer}/items`, ctx, deps);
      const itemNode: Node = lowered.nullable ? { k: "nullable", inner: lowered.node } : lowered.node;
      return {
        node: {
          k: "array",
          items: itemNode,
          ...(numberOf(schema, "minItems") === undefined ? {} : { minItems: numberOf(schema, "minItems") }),
          ...(numberOf(schema, "maxItems") === undefined ? {} : { maxItems: numberOf(schema, "maxItems") }),
        },
        nullable: false,
        media,
      };
    }
    case "object": {
      if (schema["properties"] !== undefined) {
        return { node: { k: "object", ...lowerObject(schema, pointer, ctx, deps) }, nullable: false, media };
      }
      const additional = schema["additionalProperties"];
      if (typeof additional === "object" && additional !== null) {
        const lowered = lowerNode(additional as Schema, `${pointer}/additionalProperties`, ctx, deps);
        return { node: { k: "record", values: lowered.node }, nullable: false, media };
      }
      return { node: { k: "record", values: { k: "unknown" } }, nullable: false, media };
    }
    case "null":
      return { node: { k: "unknown" }, nullable: true, media };
    default:
      return { node: { k: "unknown" }, nullable: false, media };
  }
}

// ---------------------------------------------------------------------------
// Rendering the IR: TypeScript types, zod expressions, the compact runtime IR
// ---------------------------------------------------------------------------

function tsType(node: Node, registry: ComponentRegistry): string {
  switch (node.k) {
    case "prim": {
      if (node.enum !== undefined) {
        const listed = node.enum.map((value) => literal(value)).join(" | ");
        // The open-enum tail keeps completions (the listed values are what an
        // editor offers) without closing a set fal left open.
        if (node.open !== true) return listed;
        return `${listed} | (${node.t === "string" ? "string" : "number"} & {})`;
      }
      return node.t === "boolean" ? "boolean" : node.t === "string" ? "string" : "number";
    }
    case "array": {
      const inner = tsType(node.items, registry);
      return /[ |]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
    }
    case "nullable": {
      const inner = tsType(node.inner, registry);
      return /[ |]/.test(inner) ? `(${inner}) | null` : `${inner} | null`;
    }
    case "ref":
      return registry.name(node.hash);
    case "record":
      return `Record<string, ${tsType(node.values, registry)}>`;
    case "object":
      return `{ ${node.order
        .map((name) => {
          const prop = node.props[name] as Prop;
          const type = tsType(prop.node, registry) + (prop.nullable ? " | null" : "");
          return `${propKey(name)}${prop.required ? "" : "?"}: ${type}`;
        })
        .join("; ")} }`;
    case "union":
      return node.arms.map((arm) => tsType(arm, registry)).join(" | ");
    case "unknown":
      return "unknown";
  }
}

/** A property key, quoted only when it is not a bare identifier. */
function propKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name);
}

/**
 * The zod expression for a node.
 *
 * **Enums yes, bounds no.** The generated schema is a SHAPE gate — one
 * `z.looseObject` per category — and a value outside an enum is a wrong type,
 * so enums belong here. A number outside `[1, 50]` is the right type with the
 * wrong value: that is a per-endpoint fact, it lives in `FAL_<V>_SHAPES`, and
 * the hand check battery is what turns it into a message naming the endpoint's
 * own documented ceiling. Putting bounds in both places would give one
 * violation two voices.
 */
function zodExpr(node: Node, componentSchemaName: (hash: string) => string): string {
  switch (node.k) {
    case "prim": {
      if (node.enum !== undefined) {
        // An OPEN enum is a bare type here: fal accepts any string, so a
        // `z.enum` would refuse values the endpoint takes. The listed values
        // survive in the IR, where the check battery downgrades an unlisted
        // one to a warning instead of an error.
        if (node.open === true) return node.t === "string" ? "z.string()" : "z.number()";
        return node.t === "string"
          ? `z.enum([${node.enum.map((value) => quote(String(value))).join(", ")}])`
          : `z.literal([${node.enum.map((value) => num(Number(value))).join(", ")}])`;
      }
      if (node.t === "boolean") return "z.boolean()";
      return node.t === "string" ? "z.string()" : "z.number()";
    }
    case "array":
      return `z.array(${zodExpr(node.items, componentSchemaName)})`;
    case "nullable":
      return `${zodExpr(node.inner, componentSchemaName)}.nullable()`;
    case "ref":
      return componentSchemaName(node.hash);
    case "record":
      return `z.record(z.string(), ${zodExpr(node.values, componentSchemaName)})`;
    case "object":
      return `z.looseObject({ ${node.order
        .map((name) => {
          const prop = node.props[name] as Prop;
          let expr = zodExpr(prop.node, componentSchemaName);
          if (prop.nullable) expr += ".nullable()";
          if (!prop.required) expr += ".optional()";
          return `${propKey(name)}: ${expr}`;
        })
        .join(", ")} })`;
    case "union":
      return `z.union([${node.arms.map((arm) => zodExpr(arm, componentSchemaName)).join(", ")}])`;
    case "unknown":
      return "z.unknown()";
  }
}

/** The `t` field of a `FalPropSpec` — the IR's coarse type tag. */
function irType(node: Node): string {
  switch (node.k) {
    case "prim":
      return node.t;
    case "array":
      return "array";
    case "nullable":
      return irType(node.inner);
    case "ref":
    case "object":
    case "record":
      return "object";
    case "union":
      return "union";
    case "unknown":
      return "unknown";
  }
}

/** The type tag two endpoints must agree on for a category-wide zod type. */
function mergeType(node: Node): string {
  const tag = irType(node);
  return tag === "integer" ? "number" : tag;
}

// ---------------------------------------------------------------------------
// Shape classes — how an endpoint lets the caller state output geometry and
// duration. One adapter branch per class; NEVER a per-endpoint switch.
// ---------------------------------------------------------------------------

const SHAPE_CLASSES = [
  "imageSizeUnion",
  "imageSizePresets",
  "dimensionPair",
  "aspectRatioEnum",
  "resolutionEnum",
  "scaleFactor",
  "durationStringEnum",
  "durationNumber",
  "fixedGeometry",
] as const;

type ShapeClass = (typeof SHAPE_CLASSES)[number];

/** Is this the `anyOf[$ref ImageSize, string enum]` union flux made famous? */
function imageSizeParts(
  node: Node,
  registry: ComponentRegistry,
): { presets: readonly string[]; size: ComponentModel } | undefined {
  if (node.k !== "union" || node.arms.length !== 2) return undefined;
  const ref = node.arms.find((arm) => arm.k === "ref");
  const presets = node.arms.find((arm) => arm.k === "prim" && arm.t === "string" && arm.enum !== undefined);
  if (ref === undefined || presets === undefined) return undefined;
  const component = registry.byHash.get((ref as { hash: string }).hash) as ComponentModel;
  const width = component.model.props["width"];
  const height = component.model.props["height"];
  if (width === undefined || height === undefined) return undefined;
  return {
    presets: ((presets as { enum: readonly (string | number)[] }).enum).map(String),
    size: component,
  };
}

/**
 * The one verb whose wire `resolution` does NOT mean the size of a frame.
 *
 * Everywhere else in this provider `resolution` measures a picture — including
 * at `imageEdit` and `avatar`, which file it as a per-model extra and still
 * mean pixels by it. At `threeD` it measures a VOXEL GRID: an integer 512 /
 * 1024 / 1536 at `fal-ai/trellis-2`, a string at Hi3D, describing how finely
 * the geometry was sampled. Demanding a frame-tier shape class of it would be
 * the classifier asserting something about the wire that is not true.
 */
const RESOLUTION_IS_A_VOXEL_GRID: ReadonlySet<Verb> = new Set<Verb>(["threeD"]);

function classifyShapes(
  endpointId: string,
  verb: Verb,
  input: ObjectModel,
  registry: ComponentRegistry,
): ShapeClass[] {
  const classes = new Set<ShapeClass>();
  const props = input.props;
  const bad = (param: string, saw: string): never => {
    throw new Error(
      `${endpointId}: cannot classify \`${param}\` (${saw}). Every geometry and duration parameter must fall ` +
        `into one of [${SHAPE_CLASSES.join(", ")}] so the unified adapter can have one branch per class rather ` +
        "than one per endpoint. Curate the endpoint out, or add a `shapeClass` overlay in data/fal/overlays.json.",
    );
  };

  const imageSize = props["image_size"];
  if (imageSize !== undefined) {
    if (imageSizeParts(imageSize.node, registry) !== undefined) classes.add("imageSizeUnion");
    else if (imageSize.node.k === "prim" && imageSize.node.t === "string" && imageSize.node.enum !== undefined) {
      classes.add("imageSizePresets");
    } else bad("image_size", irType(imageSize.node));
  }

  const width = props["width"];
  const height = props["height"];
  if (width !== undefined || height !== undefined) {
    const numeric = (prop: Prop | undefined): boolean =>
      prop === undefined || (prop.node.k === "prim" && (prop.node.t === "number" || prop.node.t === "integer"));
    if (!numeric(width) || !numeric(height)) bad("width/height", "not numeric");
    classes.add("dimensionPair");
  }

  const aspect = props["aspect_ratio"];
  if (aspect !== undefined) {
    if (aspect.node.k === "prim" && aspect.node.t === "string" && aspect.node.enum !== undefined) {
      classes.add("aspectRatioEnum");
    } else if (aspect.node.k === "prim" && aspect.node.t === "string") {
      // A free-form ratio string is a real shape (some endpoints accept
      // "1234:567"); it is just not an enum, so it gets no vocabulary.
      classes.add("aspectRatioEnum");
    } else bad("aspect_ratio", irType(aspect.node));
  }

  // See RESOLUTION_IS_A_VOXEL_GRID: at `threeD` this field is not a frame size
  // at all, so it gets no shape class and rides as a per-model extra instead.
  const resolution = RESOLUTION_IS_A_VOXEL_GRID.has(verb) ? undefined : props["resolution"];
  if (resolution !== undefined) {
    if (resolution.node.k === "prim" && resolution.node.t === "string" && resolution.node.enum !== undefined) {
      classes.add("resolutionEnum");
    } else bad("resolution", irType(resolution.node));
  }

  for (const name of ["upscale_factor", "scale_factor", "scale"]) {
    const factor = props[name];
    if (factor === undefined) continue;
    if (factor.node.k === "prim" && (factor.node.t === "number" || factor.node.t === "integer")) {
      classes.add("scaleFactor");
    } else bad(name, irType(factor.node));
  }

  const duration = props["duration"];
  if (duration !== undefined) {
    if (duration.node.k === "prim" && duration.node.t === "string" && duration.node.enum !== undefined) {
      classes.add("durationStringEnum");
    } else if (duration.node.k === "prim" && (duration.node.t === "number" || duration.node.t === "integer")) {
      classes.add("durationNumber");
    } else bad("duration", irType(duration.node));
  }

  if (classes.size === 0) classes.add("fixedGeometry");
  return sorted([...classes]) as ShapeClass[];
}

// ---------------------------------------------------------------------------
// The endpoint model — one per curated id, everything the emitters need
// ---------------------------------------------------------------------------

interface EndpointModel {
  id: string;
  verb: Verb;
  curation: CurationEntry;
  pricing: PricingRow;
  snapshotFile: string;
  docUrl: string;
  displayName: string;
  falCategory: string;
  status: string;
  updatedAt?: string;
  input: ObjectModel;
  output: ObjectModel;
  inputTypeName: string;
  /**
   * fal's internal route for this endpoint, when it differs from the published
   * id (vendor-namespaced ids only). Provenance, never the URL.
   */
  routeAlias?: string;
  outputTypeName: string;
  requiredProbes: string[];
  shapes: ShapeClass[];
  modalities: { input: string[]; output: string[] };
  characterLimit?: number;
}

function metadataString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** Input modalities, read off the endpoint's own parameter names. */
function inputModalities(input: ObjectModel, curation: CurationEntry): string[] {
  const found = new Set<string>();
  if (curation.textParam !== undefined) found.add("text");
  for (const [name, prop] of Object.entries(input.props)) {
    if (prop.media === "image" || /(^|_)image(_urls?|s)?$/.test(name)) found.add("image");
    if (prop.media === "video" || /(^|_)video_urls?$/.test(name)) found.add("video");
    if (prop.media === "audio" || /(^|_)audio_urls?$/.test(name)) found.add("audio");
    if (/(^|_)pdf_urls?$/.test(name)) found.add("pdf");
    if (name === "prompt" || name === "text") found.add("text");
  }
  if (found.size === 0) found.add("text");
  return sorted([...found]);
}

/**
 * Output modalities, read off the endpoint's own RESPONSE schema, then
 * cross-checked against what the curated verb promises.
 *
 * The cross-check is the point. `fal.upscale` legitimately returns an image
 * from one endpoint and a video from another, so its modality has to be
 * derived — but every other verb fixes one, and a verb that disagrees with the
 * response schema is a mis-curation (an image upscaler filed as `image`, a
 * video model filed as `lipsync`) that would otherwise ship as a quietly wrong
 * catalog row.
 */
function outputModalities(endpointId: string, verb: Verb, output: ObjectModel): string[] {
  const found = new Set<string>();
  for (const name of Object.keys(output.props)) {
    if (/^images?$/.test(name)) found.add("image");
    if (/^videos?$/.test(name)) found.add("video");
    if (/^audios?$/.test(name)) found.add("audio");
    if (name === "text" || name === "chunks") found.add("text");
    // The mesh, under the four names this roster spells it: `model_mesh`,
    // `model_glb`, `model_urls` and `model_meshes`. Detected rather than taken
    // on faith from the verb so a mis-curated endpoint still trips the
    // cross-check below.
    if (/^model_(mesh|meshes|glb|urls)$/.test(name)) found.add("3d");
  }
  const promised = VERB_OUTPUT_MODALITY[verb];
  if (promised === undefined) {
    if (found.size === 0) {
      throw new Error(
        `${endpointId}: verb "${verb}" fixes no output modality and the response schema names none either ` +
          `(properties: ${sorted(Object.keys(output.props)).join(", ")}). Add the response field to ` +
          "`outputModalities` in scripts/codegen-fal.ts, or curate the endpoint out.",
      );
    }
    return sorted([...found]);
  }
  if (found.size > 0 && !found.has(promised)) {
    throw new Error(
      `${endpointId}: curated as "${verb}" (which outputs ${promised}) but its response schema returns ` +
        `${sorted([...found]).join("/")}. One of the two is wrong — check the verb in data/fal/curation.json.`,
    );
  }
  return [promised];
}

// ---------------------------------------------------------------------------
// Pricing → `ModelCost`
// ---------------------------------------------------------------------------

/**
 * The four units `ModelCost` can express exactly, and nothing else.
 *
 * `per_megapixel` is the one that most invites a shortcut: writing $0.025/MP
 * into `perImage` produces a number that is right for a 1 MP image and wrong
 * for every other size, and a wrong number is worse than no number because it
 * silently survives every test that only checks the field exists. Tiered and
 * conditional rates are excluded by the same rule and land in the hand pricing
 * table instead (the kling precedent). `ModelCost` is NOT widened in wave 1.
 */
function costFor(row: PricingRow): MediaCostInput | undefined {
  if (row.usd === undefined) return undefined;
  switch (row.unit) {
    case "per_image":
      return { perImage: row.usd };
    case "per_second":
      return { perVideoSecond: row.usd };
    case "per_1000_characters":
      return { perMillionCharacters: row.usd * 1000 };
    case "per_audio_minute":
      return { perAudioMinute: row.usd };
    // x60, and exact for the same reason x1000 above is: `perAudioMinute` means
    // a minute of audio PROCESSED, and a per-second stt rate is the same
    // quantity in a smaller unit. Its music-side twin,
    // `per_generated_audio_second`, deliberately has no case here — that one
    // meters audio fal produced, which is not what the field means.
    case "per_input_audio_second":
      return { perAudioMinute: row.usd * 60 };
    default:
      return undefined;
  }
}

/** The provenance block above a generated catalog row. Never a guess. */
function pricingComment(row: PricingRow, indent: string): string {
  const lines: string[] = [];
  if (row.unpriced !== undefined) {
    lines.push(`UNPRICED. ${row.unpriced}`);
  } else if (row.tiers !== undefined) {
    lines.push(
      `${row.unit === "tiered" ? "Tiered" : "Conditional"} pricing on ${row.tierKey ?? "the request body"}:`,
    );
    for (const tier of row.tiers) lines.push(`  $${tier.usd} — ${tier.when}`);
    lines.push(
      "Not on `cost`: a rate that depends on the request cannot be a scalar. It belongs in the hand pricing " +
        "table, where the estimate can read the body or honestly return undefined.",
    );
  } else {
    lines.push(`$${row.usd} ${(row.unit ?? "per request").replace(/_/g, " ")}.`);
    if (row.rounding !== undefined) lines.push(`Rounding: ${row.rounding}.`);
    if (costFor(row) === undefined) {
      lines.push(
        `Not on \`cost\`: ModelCost has no \`${row.unit}\` unit and forcing this into one of the four it does ` +
          "have would ship a number that is wrong for most requests.",
      );
    }
  }
  lines.push("");
  lines.push(`Source: ${row.source} — verified ${row.verified}.`);
  if (row.quote !== undefined) lines.push(`Quote: “${jsdocText(row.quote)}”`);
  return renderDoc(lines, indent);
}

// ---------------------------------------------------------------------------
// File headers
// ---------------------------------------------------------------------------

function header(sources: readonly string[]): string {
  const lines = [
    "// Generated by scripts/codegen-fal.ts — DO NOT EDIT.",
    `// Source: ${PLATFORM_API_URL}?endpoint_id=<id>&expand=openapi-3.0`,
    "// Committed snapshots:",
    ...sources.map((file) => `//   data/fal/${file}`),
    "// Regenerate with `bun run codegen:fal` (or `bun run codegen:fal:refresh` to re-fetch the snapshots).",
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

/** `{ id: reason }` as a typed object literal, `$comment` keys dropped. */
function renderReasonTable(name: string, reasons: Readonly<Record<string, string>>): string {
  const keys = sorted(Object.keys(reasons)).filter((key) => !key.startsWith("$"));
  const rows = keys.map((key) => `  ${quote(key)}: ${quote(reasons[key] as string)},`).join("\n");
  // Annotated rather than `as const`: the reasons are prose a caller READS, not
  // a vocabulary a caller picks from, and a hundred string literals in the
  // declaration would cost every consumer of this file for nothing.
  return `export const ${name}: Readonly<Record<string, string>> = {\n${rows}\n};`;
}

function renderEndpointsFile(
  models: readonly EndpointModel[],
  excluded: { categories?: Readonly<Record<string, string>>; endpoints?: Readonly<Record<string, string>> },
): string {
  const byVerb = new Map<Verb, EndpointModel[]>();
  for (const model of models) {
    byVerb.set(model.verb, [...(byVerb.get(model.verb) ?? []), model]);
  }

  const idLists = VERBS.filter((verb) => (byVerb.get(verb) ?? []).length > 0)
    .map((verb) => {
      const ids = (byVerb.get(verb) ?? []).map((model) => model.id);
      return `${renderDoc(
        [
          ids.length === 1
            ? `The one fal endpoint unmodel serves as \`fal.${verb}\`.`
            : `Every fal endpoint unmodel serves as \`fal.${verb}\` — ${ids.length} of them.`,
        ],
        "",
      )}export const FAL_${verbConst(verb)}_ENDPOINTS = [
${ids.map((id) => `  ${quote(id)},`).join("\n")}
] as const;

export type Fal${pascalCase(verb)}EndpointId = (typeof FAL_${verbConst(verb)}_ENDPOINTS)[number];`;
    })
    .join("\n\n");

  const docRows = models.map((model) => `  ${quote(model.id)}: ${quote(model.docUrl)},`).join("\n");
  const verbRows = models.map((model) => `  ${quote(model.id)}: ${quote(model.verb)},`).join("\n");
  const probeRows = models
    .map((model) => `  ${quote(model.id)}: ${renderStringArray(model.requiredProbes)},`)
    .join("\n");

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    "The curated fal endpoint roster, per verb.",
    "",
    "An endpoint id is not a model name — it IS the queue URL path (`https://queue.fal.run/<id>`), at",
    "arbitrary depth. That is why unmodel routes fal with an `endpoint` pseudo-param instead of the usual",
    "`model` field: `model` is a REAL wire field on several fal endpoints (sync-lipsync/v2 sends",
    '`model: "lipsync-2"`), so it cannot also be the router.',
  ],
  "",
)}
${idLists}

${renderDoc(
  [
    "Every curated endpoint id, across all verbs, sorted.",
  ],
  "",
)}export const FAL_ENDPOINTS = [
${models.map((model) => `  ${quote(model.id)},`).join("\n")}
] as const;

export type FalEndpointId = (typeof FAL_ENDPOINTS)[number];

${renderDoc(
  [
    "Which verb serves each endpoint — the inverse of the lists above.",
  ],
  "",
)}export const FAL_ENDPOINT_VERBS = {
${verbRows}
} as const;

${renderDoc(
  [
    "The documentation URL fal itself publishes for each endpoint, from",
    "`info.x-fal-metadata.documentationUrl`.",
    "",
    "The hand check battery cites this as the `source` of every message it composes, so an unknown-parameter",
    "error points at the page that lists the parameters rather than at a generic provider doc.",
  ],
  "",
)}export const FAL_DOC_URLS = {
${docRows}
} as const;

${renderDoc(
  [
    "Parameters an endpoint genuinely REQUIRES: its OpenAPI `required` list minus everything fal supplies a",
    "default for.",
    "",
    "The subtraction is what makes this list usable as a test probe. `required` alone would demand fields the",
    "server happily fills in, so a preset sweep built on it would refuse bodies fal accepts.",
  ],
  "",
)}export const FAL_REQUIRED_PROBES = {
${probeRows}
} as const;

${renderDoc(
  [
    "Endpoint ids unmodel deliberately does NOT serve, each with the recorded reason.",
    "",
    "Transcribed from `data/fal/curation.json`'s `excluded.endpoints` block, which existed since wave 1 and",
    "reached no caller: an adopter who named one of these got a bare `unknown_model`, which reads as \"the",
    "catalog is a week behind\" — the opposite of the truth. `runFalChecks` looks an unknown id up here and",
    "hands back the reason, so a deliberate refusal says so at the API surface.",
    "",
    "This is NOT a census of what fal serves. fal lists ~1,500 endpoints and unmodel curates a slice of them;",
    "an id in neither map was never considered, which is the honest state and needs no defence. An id HERE was",
    "considered and turned down, and the reason is what keeps a future roster widening from quietly re-adding",
    "it. The wire path is unaffected either way — `fal.<verb>({ endpoint })` routes any id fal serves.",
  ],
  "",
)}${renderReasonTable("FAL_EXCLUDED", excluded.endpoints ?? {})}

${renderDoc(
  [
    "Whole fal CATEGORIES unmodel does not serve, each with the recorded reason.",
    "",
    "Prose, and prose only: fal's own `category` values are lossy (music hides in `text-to-audio`, upscale and",
    "background-removal are both `image-to-image`), so nothing enforces a category — enforcement is per id, in",
    "{@link FAL_EXCLUDED}. Shipped because the argument for not serving a whole family is the part a caller",
    "asking \"why is there no fal fine-tuning surface?\" actually wants.",
  ],
  "",
)}${renderReasonTable("FAL_EXCLUDED_CATEGORIES", excluded.categories ?? {})}
`;
}

function renderSharedFile(registry: ComponentRegistry, sources: readonly string[]): string {
  const components = registry.ordered();
  const blocks = components.map((component) => {
    const name = registry.name(component.hash);
    const fields = component.model.order
      .map((propName) => {
        const prop = component.model.props[propName] as Prop;
        const doc = propDoc(prop, "  ");
        const type = tsType(prop.node, registry) + (prop.nullable ? " | null" : "");
        return `${doc}  ${propKey(propName)}${prop.required ? "" : "?"}: ${type};`;
      })
      .join("\n");
    return `${renderDoc(
      [
        `fal's \`${component.title}\` component.`,
        ...(component.title === name.slice(3)
          ? []
          : [
              "",
              "The name carries a content hash because fal publishes more than one distinct component under this",
              "title; the hash keeps each variant addressable without the names depending on discovery order.",
            ]),
      ],
      "",
    )}export interface ${name} {
${fields}
}`;
  });

  return `${header(sources)}
${renderDoc(
  [
    "The `$ref` components fal's endpoint schemas share, deduplicated by content across every committed",
    "snapshot.",
    "",
    "Type-only, and one declaration per distinct schema rather than one per endpoint: `File` is byte-identical",
    "across a dozen endpoints and would otherwise be a dozen structurally identical interfaces for tsc to",
    "compare on every hover.",
  ],
  "",
)}
${blocks.join("\n\n")}
`;
}

/** The JSDoc above one property: fal's own description, then its default. */
function propDoc(prop: Prop, indent: string): string {
  const lines: string[] = [];
  if (prop.description !== undefined) {
    const text = jsdocText(prop.description);
    // fal's descriptions are inconsistently punctuated; the sentence that
    // follows would otherwise run into them.
    lines.push(/[.!?:)\]]$/.test(text) ? text : `${text}.`);
  }
  if (prop.hasDefault) lines.push(`Default: \`${literal(prop.default)}\`.`);
  if (prop.media !== undefined) lines.push(`Carries a ${prop.media} reference — an https URL or a \`data:\` URI.`);
  if (lines.length === 0) return "";
  return renderDoc(lines, indent);
}

function renderWireFile(verb: Verb, models: readonly EndpointModel[], registry: ComponentRegistry): string {
  const used = new Set<string>();
  const collect = (node: Node): void => {
    switch (node.k) {
      case "ref":
        used.add(registry.name(node.hash));
        break;
      case "array":
        collect(node.items);
        break;
      case "nullable":
        collect(node.inner);
        break;
      case "record":
        collect(node.values);
        break;
      case "object":
        for (const prop of Object.values(node.props)) collect(prop.node);
        break;
      case "union":
        for (const arm of node.arms) collect(arm);
        break;
      default:
        break;
    }
  };
  for (const model of models) {
    for (const prop of Object.values(model.input.props)) collect(prop.node);
    for (const prop of Object.values(model.output.props)) collect(prop.node);
  }

  const imports =
    used.size === 0
      ? ""
      : `import type {\n${sorted([...used])
          .map((name) => `  ${name},`)
          .join("\n")}\n} from "./shared.gen";\n`;

  const iface = (name: string, model: ObjectModel, doc: readonly string[]): string => {
    const fields = model.order
      .map((propName) => {
        const prop = model.props[propName] as Prop;
        const type = tsType(prop.node, registry) + (prop.nullable ? " | null" : "");
        return `${propDoc(prop, "  ")}  ${propKey(propName)}${prop.required ? "" : "?"}: ${type};`;
      })
      .join("\n");
    return `${renderDoc(doc, "")}export interface ${name} {
${fields}
}`;
  };

  const blocks = models.flatMap((model) => [
    iface(model.inputTypeName, model.input, [
      `The request body \`${model.id}\` accepts.`,
      ...(model.curation.note === undefined ? [] : ["", model.curation.note]),
      ...(model.routeAlias === undefined
        ? []
        : [
            "",
            `fal serves this endpoint at two live routes: the published id above, and the internal alias`,
            `\`${model.routeAlias}\` its OpenAPI document is written against. unmodel submits to the published`,
            "id — that is the one fal documents and the one this catalog is keyed on.",
          ]),
      "",
      `Docs: ${model.docUrl}`,
    ]),
    iface(model.outputTypeName, model.output, [
      `The result document \`${model.id}\` produces.`,
      "",
      "This is the body of the queue RESULT, fetched from the `response_url` a submit returns — not the body of",
      "the submit response itself, which is the queue envelope.",
    ]),
  ]);

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    `Wire types for every \`fal.${verb}\` endpoint — TYPE ONLY.`,
    "",
    "One interface per endpoint, straight off that endpoint's published schema, in fal's own field order",
    "(`x-fal-order-properties`). Nothing here is a runtime value, so importing a body type costs nothing.",
  ],
  "",
)}
${imports}
${blocks.join("\n\n")}

${renderDoc(
  [
    "Endpoint id → its request body type.",
    "",
    `A map rather than a union: a union of ${models.length} object types re-instantiates at every comparison`,
    "site, while a keyed lookup resolves in one. The per-endpoint narrowing a validator exposes indexes into",
    "this, so adding an endpoint costs one line here and nothing at any call site.",
  ],
  "",
)}export interface Fal${pascalCase(verb)}BodyById {
${models.map((model) => `  ${quote(model.id)}: ${model.inputTypeName};`).join("\n")}
}

${renderDoc([`Endpoint id → its result document type.`], "")}export interface Fal${pascalCase(verb)}ResultById {
${models.map((model) => `  ${quote(model.id)}: ${model.outputTypeName};`).join("\n")}
}
`;
}

function renderSchemaFile(verb: Verb, models: readonly EndpointModel[], registry: ComponentRegistry): string {
  // Component schemas this category actually reaches, in dependency order.
  const needed = new Set<string>();
  const collect = (node: Node): void => {
    switch (node.k) {
      case "ref": {
        if (needed.has(node.hash)) return;
        needed.add(node.hash);
        const component = registry.byHash.get(node.hash) as ComponentModel;
        for (const prop of Object.values(component.model.props)) collect(prop.node);
        break;
      }
      case "array":
        collect(node.items);
        break;
      case "nullable":
        collect(node.inner);
        break;
      case "record":
        collect(node.values);
        break;
      case "object":
        for (const prop of Object.values(node.props)) collect(prop.node);
        break;
      case "union":
        for (const arm of node.arms) collect(arm);
        break;
      default:
        break;
    }
  };
  for (const model of models) for (const prop of Object.values(model.input.props)) collect(prop.node);

  const schemaName = (hash: string): string => {
    const name = registry.name(hash);
    return `${name[0]?.toLowerCase() ?? ""}${name.slice(1)}Schema`;
  };

  const componentBlocks = registry
    .ordered()
    .filter((component) => needed.has(component.hash))
    .map(
      (component) =>
        `const ${schemaName(component.hash)} = ${zodExpr(
          { k: "object", ...component.model },
          schemaName,
        )};`,
    );

  // Merge every endpoint's spelling of each property into one field.
  const names = sorted(new Set(models.flatMap((model) => Object.keys(model.input.props))));
  const fields = names.map((name) => {
    const holders = models.filter((model) => model.input.props[name] !== undefined);
    const specs = holders.map((model) => model.input.props[name] as Prop);
    const nullable = specs.some((spec) => spec.nullable);
    const shapes = new Set(specs.map((spec) => canonical(spec.node)));
    const types = new Set(specs.map((spec) => mergeType(spec.node)));

    let expr: string;
    let comment = "";
    if (shapes.size === 1) {
      expr = zodExpr((specs[0] as Prop).node, schemaName);
    } else if (types.size === 1) {
      const type = [...types][0] as string;
      expr =
        type === "string"
          ? "z.string()"
          : type === "number"
            ? "z.number()"
            : type === "boolean"
              ? "z.boolean()"
              : type === "array"
                ? "z.array(z.unknown())"
                : type === "object"
                  ? "z.looseObject({})"
                  : "z.unknown()";
      comment = renderDoc(
        [
          `Every \`fal.${verb}\` endpoint types \`${name}\` as ${type}, but they disagree on the details`,
          `(${holders.map((model) => model.id).join(", ")}), so the union takes the bare type and the exact`,
          `vocabulary is enforced per endpoint from FAL_${verbConst(verb)}_SHAPES.`,
        ],
        "  ",
      );
    } else {
      expr = "z.unknown()";
      comment = renderDoc(
        [
          `\`${name}\` means different things at different endpoints —`,
          `${holders
            .map((model) => `${mergeType((model.input.props[name] as Prop).node)} at ${model.id}`)
            .join(", ")}.`,
          "",
          "Typed `unknown` here deliberately: a union that accepted both would let an endpoint's wrong-typed",
          `value through the shape gate. FAL_${verbConst(verb)}_SHAPES carries the real type per endpoint and`,
          "the hand check battery enforces it. This is also why no “common fal params” fragment is ever hoisted.",
        ],
        "  ",
      );
    }
    if (nullable) expr += ".nullable()";
    return `${comment}  ${propKey(name)}: ${expr}.optional(),`;
  });

  // The route selector. It is NOT a wire parameter — `finalize` strips it into
  // the URL and fal never sees it — but it has to be declared here anyway,
  // because the pipeline reports any key the schema does not know as
  // `unknown_param`. Without this line every single fal request would carry a
  // warning about the one parameter unmodel itself requires. (Krea's `model`
  // is the same trick for the same reason.) Declaring it does not widen the
  // wire body: nothing reads the schema to build the request.
  const routeField = `${renderDoc(
    [
      "The endpoint to submit to — unmodel's route selector, not a fal body field.",
      "",
      "Stripped in `finalize` and interpolated into `.request.url`; fal never receives it. It is declared here",
      "only so the pipeline does not report the one required parameter as an unknown one. The selector is",
      "`endpoint` rather than `model` because `model` is a REAL wire field on several fal endpoints.",
    ],
    "  ",
  )}  endpoint: z.string(),`;

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    `The ONE request schema for every \`fal.${verb}\` endpoint.`,
    "",
    `One \`z.looseObject\` for the whole category, not ${models.length} per-endpoint schemas: zod objects are built`,
    "eagerly, and a hundred of them would be constructed on import for the one the caller actually used.",
    "",
    "Every field is optional here and every bound is absent. That is not laxity, it is the division of labour —",
    "this schema is the SHAPE gate (is `prompt` a string?), and what each endpoint requires, ranges and",
    `enumerates lives in \`FAL_${verbConst(verb)}_SHAPES\`, where the hand check battery can turn a violation into a`,
    "message that names the endpoint and cites its own documentation.",
    "",
    "`looseObject` because fal ships new parameters between refreshes and a caller who reads the release notes",
    "before we do should not be blocked; unknown keys are reported as warnings by the hand battery instead.",
  ],
  "",
)}
import { z } from "zod";
${componentBlocks.length === 0 ? "" : `\n${componentBlocks.join("\n")}\n`}
export const fal${pascalCase(verb)}InputSchema = z.looseObject({
${routeField}
${fields.join("\n")}
});
`;
}

function renderCheckFile(verb: Verb, models: readonly EndpointModel[]): string {
  // A field is checkable when its wire type can extend the gate's input
  // without an implicit-index-signature mismatch: primitives, enums, and
  // arrays/unions built only from them. Object-shaped fields (ref, object,
  // record, unknown) are interfaces on the wire side, and an interface never
  // extends a `looseObject` input — their per-endpoint truth is enforced at
  // run time from the SHAPES rows instead.
  const checkable = (node: Node): boolean => {
    switch (node.k) {
      case "prim":
        return true;
      case "nullable":
        return checkable(node.inner);
      case "array":
        return checkable(node.items);
      case "union":
        return node.arms.every(checkable);
      default:
        return false;
    }
  };

  const slug = verbSlug(verb);
  const gateName = `fal${pascalCase(verb)}InputSchema`;
  const lines: string[] = [];
  for (const model of models) {
    const names = model.input.order.filter((name) =>
      checkable((model.input.props[name] as Prop).node),
    );
    if (names.length === 0) continue;
    lines.push(`  // ${model.id}`);
    for (const name of names) {
      lines.push(
        `  AssertExtends<wire.${model.inputTypeName}[${JSON.stringify(name)}], Gate[${JSON.stringify(name)}]>,`,
      );
    }
  }
  if (lines.length === 0) return "";

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    `Schema/wire agreement checks for every \`fal.${verb}\` endpoint — TYPE ONLY, imported by nothing.`,
    "",
    `\`${slug}-wire.gen.ts\` and \`${slug}-schema.gen.ts\` render from the same IR through two emitters. This`,
    "file is the proof they still agree: for every primitive-shaped input field, the wire type must be",
    "assignable to the category gate's input — a field the schema emits as `z.string()` while the wire",
    "interface says `number` fails `tsc` right here instead of shipping a gate that rejects legal bodies.",
    "",
    "Nothing imports this file. It exists for `tsc --noEmit`, costs zero runtime bytes, and joins no",
    "entry's graph.",
  ],
  "",
)}
import type { z } from "zod";

import type { AssertExtends } from "../shape-types";
import type { ${gateName} } from "./${slug}-schema.gen";
import type * as wire from "./${slug}-wire.gen";

type Gate = z.input<typeof ${gateName}>;

export type Fal${pascalCase(verb)}SchemaChecks = [
${lines.join("\n")}
];
`;
}

function renderNarrowFile(verb: Verb, models: readonly EndpointModel[], registry: ComponentRegistry): string {
  // Enum vocabularies are hoisted and shared: wizper's `language` alone is 99
  // entries, and it would otherwise be written twice (shapes + constraints)
  // per endpoint that carries it.
  const enums = new Map<string, readonly (string | number)[]>();
  const enumName = (values: readonly (string | number)[]): string => {
    const key = `E_${hash6(canonical(values))}`;
    enums.set(key, values);
    return key;
  };

  const specLiteral = (prop: Prop, node: Node): string => {
    const fields: string[] = [`t: ${quote(irType(node))}`];
    if (prop.required) fields.push("req: true");
    if (prop.nullable) fields.push("nul: true");
    if (prop.hasDefault) fields.push("def: true");
    switch (node.k) {
      case "prim":
        if (node.enum !== undefined) fields.push(`enum: ${enumName(node.enum)}`);
        if (node.open === true) fields.push("open: true");
        if (node.min !== undefined) fields.push(`min: ${num(node.min)}`);
        if (node.max !== undefined) fields.push(`max: ${num(node.max)}`);
        if (node.xmin !== undefined) fields.push(`xmin: ${num(node.xmin)}`);
        if (node.xmax !== undefined) fields.push(`xmax: ${num(node.xmax)}`);
        if (node.minLen !== undefined) fields.push(`minLen: ${num(node.minLen)}`);
        if (node.maxLen !== undefined) fields.push(`maxLen: ${num(node.maxLen)}`);
        break;
      case "array":
        if (node.minItems !== undefined) fields.push(`minItems: ${num(node.minItems)}`);
        if (node.maxItems !== undefined) fields.push(`maxItems: ${num(node.maxItems)}`);
        fields.push(
          `items: ${specLiteral(
            {
              ...prop,
              required: false,
              nullable: node.items.k === "nullable",
              hasDefault: false,
            },
            node.items.k === "nullable" ? node.items.inner : node.items,
          )}`,
        );
        break;
      case "union": {
        const size = imageSizeParts(node, registry);
        if (size !== undefined) fields.push(`size: ${sizeLiteral(size)}`);
        break;
      }
      default:
        break;
    }
    if (prop.media !== undefined) fields.push(`media: ${quote(prop.media)}`);
    return `{ ${fields.join(", ")} }`;
  };

  const sizeLiteral = (parts: { presets: readonly string[]; size: ComponentModel }): string => {
    const dimension = (name: string): string => {
      const prop = parts.size.model.props[name];
      if (prop === undefined || prop.node.k !== "prim") return "{}";
      const bits: string[] = [];
      if (prop.node.min !== undefined) bits.push(`min: ${num(prop.node.min)}`);
      if (prop.node.xmin !== undefined) bits.push(`xmin: ${num(prop.node.xmin)}`);
      if (prop.node.max !== undefined) bits.push(`max: ${num(prop.node.max)}`);
      if (typeof prop.default === "number") bits.push(`default: ${num(prop.default)}`);
      return `{ ${bits.join(", ")} }`;
    };
    return `{ presets: ${enumName(parts.presets)}, width: ${dimension("width")}, height: ${dimension("height")} }`;
  };

  const shapeRows = models
    .map((model) => {
      const props = model.input.order
        .map((name) => {
          const prop = model.input.props[name] as Prop;
          return `      ${propKey(name)}: ${specLiteral(prop, prop.node)},`;
        })
        .join("\n");
      return `  ${quote(model.id)}: {
    order: ${renderStringArray(model.input.order)},
    props: {
${props}
    },
  },`;
    })
    .join("\n");

  const constraintRows = models
    .map((model) => {
      const entries = model.input.order
        .filter((name) => {
          const node = (model.input.props[name] as Prop).node;
          return node.k === "prim" && node.enum !== undefined;
        })
        .map((name) => {
          const node = (model.input.props[name] as Prop).node as { enum: readonly (string | number)[] };
          return `    ${propKey(name)}: ${enumName(node.enum)},`;
        });
      if (entries.length === 0) return `  ${quote(model.id)}: {},`;
      return `  ${quote(model.id)}: {\n${entries.join("\n")}\n  },`;
    })
    .join("\n");

  const enumBlock = sorted([...enums.keys()])
    .map((name) => {
      const values = enums.get(name) as readonly (string | number)[];
      const rendered = values
        .map((value) => (typeof value === "number" ? num(value) : quote(value)))
        .join(", ");
      return `const ${name} = [${rendered}] as const;`;
    })
    .join("\n");

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    `The per-endpoint intermediate representation every \`fal.${verb}\` check reads.`,
    "",
    "This is the file that makes one union schema enough. The schema next door asks “is this the right shape?”;",
    "these rows carry what each endpoint actually requires, ranges, enumerates and treats as media, so the ONE",
    "hand-written check battery can narrow to the endpoint at run time and compose a message that cites that",
    "endpoint's own documentation.",
    "",
    "Note what is NOT here: no per-endpoint deny table. The `props` keys ARE the allow-list — an O(N×M) table of",
    "everything each endpoint refuses would be hundreds of kilobytes saying what the keys already say.",
  ],
  "",
)}
import type { FalEndpointShape } from "../shape-types";

// Enum vocabularies, hoisted and deduplicated by content: the same list is
// named by both tables below, and often by several endpoints.
${enumBlock}

export const FAL_${verbConst(verb)}_SHAPES = {
${shapeRows}
} as const satisfies Record<string, FalEndpointShape>;

${renderDoc(
  [
    "Each endpoint's closed vocabularies, keyed by parameter.",
    "",
    "The same arrays the shapes above point at, addressed the way a picker wants them: `unmodel/fal/values`",
    "publishes these so a UI can offer exactly what the endpoint accepts.",
  ],
  "",
)}export const FAL_${verbConst(verb)}_CONSTRAINTS = {
${constraintRows}
} as const;
`;
}

/** One dimension of the explicit-`image_size` arm, through a `$ref` or inline. */
function imageSizeDimension(
  node: Node,
  axis: "width" | "height",
): { min?: number; xmin?: number; max?: number } | undefined {
  const object =
    node.k === "object"
      ? node
      : node.k === "ref"
        ? IMAGE_SIZE_COMPONENTS.get(node.hash)
        : undefined;
  const prop = object?.props[axis];
  if (prop === undefined || prop.node.k !== "prim") return undefined;
  const spec: { min?: number; xmin?: number; max?: number } = {};
  if (prop.node.min !== undefined) spec.min = prop.node.min;
  if (prop.node.xmin !== undefined) spec.xmin = prop.node.xmin;
  if (prop.node.max !== undefined) spec.max = prop.node.max;
  return spec;
}

/**
 * Component models by hash, populated by `generate()` before the params files
 * are rendered.
 *
 * A module-level map rather than another parameter threaded through four
 * emitters: the registry is finalized by the time anything renders, and this
 * lookup is the only place a params row has to resolve a `$ref`.
 */
const IMAGE_SIZE_COMPONENTS = new Map<string, ObjectModel>();

/**
 * The wire parameters each verb's unified adapter maps from a canonical word,
 * and which therefore are NOT per-model extras.
 *
 * Everything an endpoint declares that is not on this list becomes an `extras`
 * entry on its row — typed from that endpoint's own wire interface, so the
 * completion a caller sees and the value the provider validates are one
 * declaration. The list is per verb because the same wire name is canonical in
 * one category and an extra in another: `image_url` IS the subject of an edit
 * and is merely a style reference on a text-to-image route.
 */
/**
 * The wire names a `VideoImageRole` arm can land on, per role, in preference
 * order.
 *
 * fal's video endpoints spell the same three jobs six different ways —
 * `image_url` at seedance and hailuo, `start_image_url` at kling v3,
 * `first_frame_url` at veo3.1's interpolation route; `end_image_url`,
 * `last_frame_url` and `tail_image_url` for the closing frame — and the role
 * is the thing they have in common. So the adapter asks the row "which wire
 * name is your `first`?" rather than trying six names.
 *
 * Preference order matters where an endpoint declares two of a role's
 * spellings, which none does today; stating it is what makes the answer stable
 * if one ever does.
 */
const VIDEO_ROLE_WIRE: ReadonlyArray<readonly [role: string, names: readonly string[]]> = [
  ["first", ["image_url", "start_image_url", "first_frame_url"]],
  ["last", ["end_image_url", "last_frame_url", "tail_image_url"]],
  ["reference", ["image_urls", "reference_image_urls"]],
];

const VIDEO_ROLE_WIRE_NAMES: readonly string[] = VIDEO_ROLE_WIRE.flatMap(([, names]) => names);

/** The wire names a source CLIP lands on — `video` in the canonical vocabulary. */
const VIDEO_SOURCE_WIRE_NAMES: readonly string[] = ["video_url", "video_urls"];

const CANONICAL_WIRE_PARAMS: Readonly<Partial<Record<Verb, readonly string[]>>> = {
  // `ImageParams` has words for shape, tier, count, seed, a negative prompt,
  // an output format and a delivery mode.
  image: ["prompt", "image_size", "aspect_ratio", "resolution", "num_images", "seed", "negative_prompt", "output_format", "sync_mode", "width", "height"],
  // `ImageEditParams` has FEWER: no `resolution`, no `negativePrompt`, no
  // `outputDelivery`. Those three wire fields are therefore per-model EXTRAS
  // here, not canonical words — which is the correct answer rather than a gap
  // to paper over. An edit's size normally follows its input, so the category
  // never grew a tier word; inventing one on fal's witness alone would put a
  // vocabulary decision in a provider directory.
  imageEdit: ["prompt", "image_size", "aspect_ratio", "num_images", "seed", "output_format", "width", "height", "image_url", "image_urls", "strength"],
  // `VideoParams` has words for the prompt, the shape, the tier, the length, a
  // negative prompt, a seed — and for the two media inputs, which is the half
  // that needs listing rather than deriving. Every wire name a `VideoImageRole`
  // arm can land on is canonical here, because otherwise `start_image_url`
  // would be BOTH the target of `image: { role: "first" }` and a per-model
  // extra a caller could set independently, and the two would race.
  video: [
    "prompt",
    "aspect_ratio",
    "resolution",
    "duration",
    "negative_prompt",
    "seed",
    ...VIDEO_ROLE_WIRE_NAMES,
    ...VIDEO_SOURCE_WIRE_NAMES,
  ],
  // `LipsyncParams` is five words and two of them are media. `sync_mode` and
  // `loop_mode` are deliberately NOT here: one provider's word for "what to do
  // when the audio outlasts the clip" is not vocabulary, so they stay extras
  // until a second provider spells the same idea.
  lipsync: ["video_url", "audio_url", "seed"],
  // `AvatarParams`, the still-driven twin. Note `prompt` is absent: three of the
  // eight avatar rows have no prompt at all and one REQUIRES it, so it is a
  // per-model extra rather than a canonical word the category has to answer for.
  avatar: ["image_url", "audio_url", "seed"],
  // `UpscaleParams` is five words: the ref, the source, the multiplier, an
  // optional prompt and providerOptions. The source and the multiplier each
  // have TWO wire spellings across this roster (`image_url` / `video_url`,
  // `upscale_factor` / `scale`) and both are canonical, because a caller who
  // set `scale` as an extra beside `factor` would be racing the adapter for the
  // same field. `creativity`, `resemblance`, `denoise` and the rest stay
  // extras: they are one vendor's dial, not a category's word.
  upscale: ["image_url", "video_url", "upscale_factor", "scale"],
  // `ThreeDParams` is five words and two of them are alternatives. Both the
  // image and the seed have several wire spellings across nineteen endpoints
  // from seven vendors — `image_url` at Tripo, `input_image_url` at Hunyuan3D,
  // `image_urls` (a LIST) at Rodin, `front_image_url` at Tripo's multiview
  // route; `seed` at eight and `model_seed` at four — and every one of them is
  // canonical, because a caller who set `input_image_url` as an extra beside
  // `image` would be racing the adapter for the same field.
  //
  // Note which words are NOT here. `texture`, `pbr`, `quad`, `face_limit`,
  // `geometry_file_format` and the sampler dials are all extras: each is one
  // vendor's spelling of an idea the other six spell differently, and a
  // vocabulary decision made in a provider directory is not a vocabulary
  // decision. `prompt` IS here, because both witnesses spell it that way and
  // it is already the same word at `image`, `video` and `music`.
  threeD: [
    "prompt",
    "image_url",
    "input_image_url",
    "image_urls",
    "front_image_url",
    "seed",
    "model_seed",
  ],
  // `TtsParams`: the text, the voice, the language, the codec and the speed.
  // Each of the middle three has several wire spellings here — fal's speech
  // roster is fifteen vendors deep — and the row states which one THIS endpoint
  // uses rather than the adapter trying all of them.
  tts: [
    "voice",
    "speed",
    "language",
    "language_code",
    "language_boost",
    "custom_audio_language",
    "output_format",
  ],
  // `SttParams`: the audio, the language and the two switches unmodel has words
  // for. `task`, `use_pnc`, `keyterms` and `max_new_tokens` stay extras.
  stt: ["audio_url", "language", "language_code", "chunk_level", "diarize"],
  // `MusicParams`: the prompt, the length, the instrumental switch, the seed
  // and the codec. The length alone has FOUR spellings across ten endpoints —
  // `duration`, `seconds_total`, `music_length_ms` and `music_duration` — one
  // of them in milliseconds and one a two-member string enum, which is exactly
  // why the canonical word is `durationSeconds` and the row states the wire.
  music: [
    "seed",
    "duration",
    "seconds_total",
    "music_length_ms",
    "music_duration",
    "is_instrumental",
    "force_instrumental",
    "output_format",
  ],
};

/**
 * The verbs whose curated `textParam` is a CANONICAL word rather than an extra.
 *
 * Three of the nine, and the exclusions are the interesting half. `image`,
 * `imageEdit` and `video` are absent because they already list `prompt`
 * explicitly above — every one of their endpoints spells it that way, so there
 * is nothing to look up. `lipsync` and `avatar` are absent on purpose: fal
 * declares a `text` at `fal-ai/pixverse/lipsync` and a `prompt` at five avatar
 * routes, and neither category has a canonical word for it (see the avatar
 * vocabulary — one route REQUIRES a prompt and three have no field at all).
 *
 * The three here need the lookup because they genuinely disagree: speech is
 * `text` at ElevenLabs and `prompt` at Kokoro, and music is `prompt` at Lyria,
 * `tags` at ACE-Step and `lyrics` at DiffRhythm — where the lyrics ARE the
 * request.
 */
const TEXT_PARAM_IS_CANONICAL: ReadonlySet<Verb> = new Set<Verb>(["upscale", "tts", "music"]);

/** fal's `resolution` vocabulary onto the canonical tiers. `0.5K` has none. */
function canonicalTier(value: string): string | undefined {
  const match = /^([0-9.]+)k$/i.exec(value.trim());
  if (match === null) return undefined;
  const scale = Number(match[1]);
  return scale === 1 ? "1k" : scale === 2 ? "2k" : scale === 4 ? "4k" : undefined;
}

/**
 * Canonical `W:H` spellings, from an enum that may hold other things too.
 *
 * The pattern MIRRORS the core's own definition of a ratio spelling —
 * `RATIO_SPELLING` at src/core/unified/derive.ts:118 — minus the separator
 * alternatives (`x`, `*`, `×`) fal never emits. Decimals are the half that
 * matters: `krea/v2/{large,medium}/text-to-image` publish `"2.35:1"` and
 * `xai/grok-imagine-image` publishes `"19.5:9"` and `"9:19.5"`, and an
 * integers-only pattern deleted all three — refusing, at both type and run
 * time, a shape the endpoint declares. `parseRatio`/`toRatioEnum` already
 * reduce decimals (the hand-written krea adapter says so in prose at
 * src/providers/krea/unified.ts:63), so the values only have to survive to
 * reach them.
 *
 * ## The one refusal, and why it stays
 *
 * `"auto"` is not a shape. `AspectRatio` (src/core/unified/vocabulary/common.ts:44)
 * is `AspectRatioPreset | (\`${number}:${number}\` & {})` — there is no
 * canonical word for "you decide", exactly as `durationSeconds` below refuses
 * `"auto"` because it is not a length. Admitting it would also let
 * `pixelsToRatio` snap a pixel pair onto a value that names no geometry.
 *
 * It costs a caller almost nothing: `"auto"` is the schema DEFAULT on 17 of
 * the 20 rows whose `aspect_ratio` enum offers it (the nano-banana family and
 * its edit routes, mai-image-2.5, reve, seedance 2.0/2.5, veo3.1, wan), so omitting
 * `aspectRatio` already sends it. On the three text-to-image nano-banana rows
 * where the default is `"1:1"` and `"auto"` is a genuinely distinct choice,
 * `providerOptions.fal.aspect_ratio` reaches the wire as written, and the raw
 * `fal.image` surface takes it directly. A vocabulary with a gap beats one
 * that lies. The rule is listed with the other general lowering rules in
 * data/fal/overlays.json's `$comment`, which is where a rule true of fal
 * generally rather than of one endpoint belongs.
 *
 * {@link assertRatiosComplete} is what keeps this filter honest: anything it
 * drops that is not on the recorded refusal list fails codegen.
 */
function canonicalRatios(values: readonly (string | number)[]): string[] {
  return values.filter(
    (value): value is string => typeof value === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value),
  );
}

/**
 * The `aspect_ratio` enum members that are deliberately NOT canonical ratios.
 *
 * One member, one reason, argued in {@link canonicalRatios}. Everything else a
 * closed `aspect_ratio` enum publishes must reach the row.
 */
const RATIOS_THAT_ARE_NOT_SHAPES: ReadonlySet<string> = new Set(["auto"]);

/**
 * Wire enum → row completeness, in the direction no preset sweep can run.
 *
 * `test/unified/image-presets.test.ts` iterates `row.ratios` and asserts every
 * member compiles, which cannot see a member the row FAILED to declare — it
 * reads the artifact under suspicion. This runs the other way: every value in
 * a closed `aspect_ratio` enum is either in the row or on the recorded refusal
 * list, and anything else stops codegen naming the endpoint, the member and
 * both lists. Same posture as `classifyShapes`'s `bad()`: a value the
 * generator cannot classify fails loudly rather than vanishing.
 *
 * An OPEN enum is exempt on purpose — there the list is a set of presets
 * rather than a limit, and `ratioFreeform` already says so.
 *
 * {@link assertCodecsComplete} is the same guard at `output_format`, written
 * from this template.
 *
 * BACKLOG, deliberately not widened here: the same one-directional narrowing
 * exists at `tiers` (`canonicalTier`), `resolutions` (`canonicalVideoTier`),
 * `durations` (`durationSeconds`) and `languages` (the language-name table) —
 * each recognises a wire enum through a hand-rolled matcher and can lose a
 * member the same way. `"auto"` at `duration` and `768P`/`2K` at `resolution`
 * are already-argued refusals that such a guard would have to carry.
 */
function assertRatiosComplete(endpointId: string, members: readonly (string | number)[], ratios: readonly string[]): void {
  for (const member of members) {
    const value = String(member);
    if (ratios.includes(value) || RATIOS_THAT_ARE_NOT_SHAPES.has(value)) continue;
    throw new Error(
      `${endpointId}: \`aspect_ratio\` enum member ${quote(value)} reached neither the row's canonical ratios ` +
        `(${ratios.map(quote).join(", ") || "none"}) nor the recorded refusals ` +
        `(${[...RATIOS_THAT_ARE_NOT_SHAPES].map(quote).join(", ")}). A shape fal publishes and unmodel drops is ` +
        "a compile error and a runtime refusal for a request fal accepts — widen `canonicalRatios`, or record " +
        "the refusal in RATIOS_THAT_ARE_NOT_SHAPES with the reason.",
    );
  }
}

/**
 * fal's `resolution` vocabulary onto the canonical VIDEO tiers.
 *
 * Exact spellings only, case-insensitively — `"480P"` is `480p` and `"4K"` is
 * `4k`, and that is the whole of the mapping. The refusals are the interesting
 * half: `minimax/h3` offers `"768P"` and `"2K"`, `wan/v2.2-a14b` offers
 * `"580p"`, `pixverse/v6` offers `"360p"` and `"540p"`, and none of those is a
 * canonical `VideoResolution`. Rounding `"768P"` to `720p` would send a caller
 * who asked for 720p a taller frame and say nothing about it, and rounding
 * `"2K"` to either neighbour is a coin toss — so those spellings simply do not
 * appear in the canonical list, the adapter refuses the tiers this endpoint
 * cannot express by name, and a caller who wants 768P writes it through
 * `providerOptions`. A vocabulary that lies is worse than one with gaps.
 */
function canonicalVideoTier(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return normalized === "480p" ||
    normalized === "720p" ||
    normalized === "1080p" ||
    normalized === "1440p" ||
    normalized === "4k"
    ? normalized
    : undefined;
}

/**
 * The seconds a `duration` enum member means, or `undefined` when it means
 * something else.
 *
 * Three spellings across this roster and one non-answer: kling writes `"5"`,
 * veo3.1 writes `"8s"`, wan writes the integer `5`, and seedance and ltx-2.5
 * both offer `"auto"` — "you decide" — which is not a length and must not
 * become one. `lightricks/ltx-2.5/text-to-video/pro` is the sharpest case: its
 * enum is `[6, 8, 10, "auto"]` with no declared `type` at all, so the members
 * arrive as a mixed array and the filter is what keeps `"auto"` out of a
 * `readonly number[]`.
 */
function durationSeconds(value: string | number): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const match = /^(\d+(?:\.\d+)?)s?$/i.exec(value.trim());
  if (match === null) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : undefined;
}

interface UnifiedRow {
  classes: readonly string[];
  keys: readonly string[];
  sizes?: readonly string[];
  ratios?: readonly string[];
  ratioFreeform?: true;
  tiers?: readonly string[];
  /** canonical tier → the spelling THIS endpoint's `resolution` enum uses. */
  tierWire?: Readonly<Record<string, string>>;
  /** The per-dimension bounds on an explicit `image_size: { width, height }`. */
  pixels?: { min?: number; max?: number };
  /** Numeric bounds on the CANONICAL params, so an adapter can respect a floor. */
  bounds?: Readonly<Record<string, { min?: number; max?: number }>>;
  /** video: the clip lengths this endpoint offers, in seconds. */
  durations?: readonly number[];
  /** video: canonical seconds → the literal this endpoint's `duration` takes. */
  durationWire?: Readonly<Record<string, string | number>>;
  /** video: the canonical `VideoResolution` tiers this endpoint can express. */
  resolutions?: readonly string[];
  /** video: canonical tier → the spelling this endpoint's `resolution` uses. */
  resolutionWire?: Readonly<Record<string, string>>;
  /** video: the `VideoImageRole` arms this endpoint serves, sorted. */
  roles?: readonly string[];
  /** video: role → the wire parameter that carries it. */
  roleWire?: Readonly<Record<string, string>>;
  /** video: the wire parameter a source CLIP goes in, where the route takes one. */
  videoWire?: string;
  /** lipsync / avatar: the source shapes this endpoint accepts. */
  sources?: readonly string[];
  /** lipsync / avatar: the wire parameter the source goes in. */
  sourceWire?: string;
  /** lipsync / avatar: the wire parameter the audio goes in. */
  audioWire?: string;
  /** upscale: the wire parameter the multiplier goes in — `upscale_factor` or `scale`. */
  factorWire?: string;
  /** upscale: the multipliers this endpoint offers as a closed set; `[]` = no field. */
  factors?: readonly number[];
  /** 3d: the input moods this endpoint reads — `["text"]`, `["image"]` or both. */
  inputs?: readonly string[];
  /** 3d: the wire parameter the reference image goes in. */
  imageWire?: string;
  /** 3d: that wire parameter is an ARRAY of URLs rather than one — Rodin, Trellis 2. */
  imageWireList?: true;
  /** 3d: the wire parameter the geometry seed goes in — `seed` or `model_seed`. */
  seedWire?: string;
  /** tts / music: the wire parameter the words go in — fal's own `textParam`. */
  textWire?: string;
  /** tts: the wire parameter the voice goes in, where the endpoint has a flat one. */
  voiceWire?: string;
  /** tts: the voices this endpoint publishes, where it publishes a closed list. */
  voices?: readonly string[];
  /** tts: the wire parameter the speed multiplier goes in. */
  speedWire?: string;
  /** tts / stt: the wire parameter the language goes in. */
  languageWire?: string;
  /** tts / stt: the language field takes any string — no enum to map through. */
  languageOpen?: true;
  /** tts / stt: the languages this endpoint offers, as canonical primary subtags. */
  languages?: readonly string[];
  /** tts / stt: canonical primary subtag → this endpoint's own spelling of it. */
  languageValues?: Readonly<Record<string, string>>;
  /** tts / music: the wire parameter the output codec goes in. */
  formatWire?: string;
  /** tts / music: the canonical codecs this endpoint can emit; `[]` = no flat field. */
  codecs?: readonly string[];
  /** tts / music: canonical codec → this endpoint's own spelling of it. */
  codecValues?: Readonly<Record<string, string>>;
  /** stt: the timing granularities this route can be ASKED for; `[]` = no switch. */
  timestamps?: readonly string[];
  /** stt: canonical granularity → this endpoint's own spelling of it. */
  timestampValues?: Readonly<Record<string, string>>;
  /** stt: the wire parameter the diarization switch goes in. */
  diarizeWire?: string;
  /** music: the wire parameter the length goes in. */
  lengthWire?: string;
  /** music: `"ms"` where that parameter counts milliseconds rather than seconds. */
  lengthUnit?: "ms";
  /** music: the lengths this endpoint offers as a closed set, in SECONDS. */
  lengths?: readonly number[];
  /** music: canonical seconds → the literal this endpoint's length parameter takes. */
  lengthValues?: Readonly<Record<string, string | number>>;
  /** music: the wire parameter the instrumental switch goes in. */
  instrumentalWire?: string;
  /** wire param name → the endpoint whose interface types it. */
  extras: readonly string[];
}

/**
 * The three things a video row narrows beyond shape: the lengths, the tiers,
 * and which image ROLES this endpoint's route serves.
 *
 * The roles are what make one `fal.video` address honest across thirty
 * endpoints. text-to-video, image-to-video, first-and-last-frame and
 * reference-to-video are four different fal ids and ONE route shape, so the
 * adapter cannot branch on the endpoint id — it reads `roles` and answers
 * "this endpoint has no `last` frame" by name. An endpoint that serves no role
 * at all gets an empty list, which is the compile-time `never` for `image`.
 */
function applyVideoRow(model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;

  const duration = props["duration"];
  if (duration?.node.k === "prim" && duration.node.enum !== undefined) {
    const seconds: number[] = [];
    const wire: Record<string, string | number> = {};
    for (const value of duration.node.enum) {
      const parsed = durationSeconds(value);
      // `"auto"` is not a length. See `durationSeconds`.
      if (parsed === undefined || seconds.includes(parsed)) continue;
      seconds.push(parsed);
      wire[String(parsed)] = value;
    }
    if (seconds.length > 0) {
      (row as { durations?: readonly number[] }).durations = seconds.sort((a, b) => a - b);
      (row as { durationWire?: Readonly<Record<string, string | number>> }).durationWire = wire;
    }
  }

  const resolution = props["resolution"];
  if (resolution?.node.k === "prim" && resolution.node.enum !== undefined) {
    const tiers: string[] = [];
    const wire: Record<string, string> = {};
    for (const value of resolution.node.enum) {
      const tier = canonicalVideoTier(String(value));
      if (tier === undefined || tiers.includes(tier)) continue;
      tiers.push(tier);
      wire[tier] = String(value);
    }
    // An EMPTY list is meaningful and is emitted: it says "this endpoint has a
    // resolution field and not one canonical tier in it", which is a different
    // fact from "no resolution field", and the adapter's message differs.
    (row as { resolutions?: readonly string[] }).resolutions = tiers;
    if (tiers.length > 0) {
      (row as { resolutionWire?: Readonly<Record<string, string>> }).resolutionWire = wire;
    }
  } else if (resolution === undefined) {
    (row as { resolutions?: readonly string[] }).resolutions = [];
  }

  const roles: string[] = [];
  const roleWire: Record<string, string> = {};
  for (const [role, names] of VIDEO_ROLE_WIRE) {
    const found = names.find((name) => props[name] !== undefined);
    if (found === undefined) continue;
    roles.push(role);
    roleWire[role] = found;
  }
  (row as { roles?: readonly string[] }).roles = roles;
  if (roles.length > 0) {
    (row as { roleWire?: Readonly<Record<string, string>> }).roleWire = roleWire;
  }

  const videoWire = VIDEO_SOURCE_WIRE_NAMES.find((name) => props[name] !== undefined);
  if (videoWire !== undefined) (row as { videoWire?: string }).videoWire = videoWire;
}

/**
 * The lipsync / avatar row: which SHAPE the performance comes in.
 *
 * The categories split on exactly this — a clip in is lipsync, a still in is
 * avatar — so a row states the shape it takes rather than the adapter
 * inferring it from a wire name. Two avatar endpoints (`veed/avatars`,
 * `argil/avatars`) take NEITHER: their performer is a catalogued id, and their
 * empty `sources` is what types `image` as `never` at the call site instead of
 * letting a caller send a still to a route that has nowhere to put it.
 */
function applySourceRow(verb: Verb, model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;
  const wireName = verb === "lipsync" ? "video_url" : "image_url";
  const kind = verb === "lipsync" ? "video" : "image";
  if (props[wireName] !== undefined) {
    (row as { sources?: readonly string[] }).sources = [kind];
    (row as { sourceWire?: string }).sourceWire = wireName;
  } else {
    (row as { sources?: readonly string[] }).sources = [];
  }
  if (props["audio_url"] !== undefined) (row as { audioWire?: string }).audioWire = "audio_url";
}

// ---------------------------------------------------------------------------
// upscale / tts / stt / music: the wave-1d rows
// ---------------------------------------------------------------------------

/** Where a multiplier lands, in preference order. Two spellings, ten endpoints. */
const FACTOR_WIRE_NAMES: readonly string[] = ["upscale_factor", "scale", "scale_factor"];

/**
 * The upscale row: what goes IN, and by how much.
 *
 * `sources` is the same mechanism the two performance categories use, pointed
 * at a different question: there it separates a clip from a still across two
 * CATEGORIES, here it separates them inside one — `fal-ai/seedvr/upscale/image`
 * and `fal-ai/seedvr/upscale/video` are one vendor's one product on two routes,
 * and an image handed to the second is a compile error rather than a 422.
 *
 * `factors` has three states and they are all load-bearing. Absent means the
 * multiplier is a RANGE (clarity takes any number in 1..4, and {@link
 * UnifiedRow.bounds} carries the ends); a list means it is a closed set
 * (`fal-ai/aura-sr` publishes a `const 4` — it upscales by four or not at all);
 * and an EMPTY list means the endpoint has no multiplier at all, which is
 * `fal-ai/recraft/upscale/crisp` and which types `factor` as `never` rather
 * than letting a caller ask for something the route cannot do.
 */
function applyUpscaleRow(model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;

  if (props["image_url"] !== undefined) {
    (row as { sources?: readonly string[] }).sources = ["image"];
    (row as { sourceWire?: string }).sourceWire = "image_url";
  } else if (props["video_url"] !== undefined) {
    (row as { sources?: readonly string[] }).sources = ["video"];
    (row as { sourceWire?: string }).sourceWire = "video_url";
  } else {
    (row as { sources?: readonly string[] }).sources = [];
  }

  const factorWire = FACTOR_WIRE_NAMES.find((name) => props[name] !== undefined);
  if (factorWire === undefined) {
    (row as { factors?: readonly number[] }).factors = [];
    return;
  }
  (row as { factorWire?: string }).factorWire = factorWire;
  const node = (props[factorWire] as Prop).node;
  if (node.k === "prim" && node.enum !== undefined) {
    const values = node.enum
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((value) => Number.isFinite(value));
    if (values.length > 0) (row as { factors?: readonly number[] }).factors = sorted(values);
  }
}

/**
 * Where a reference image lands, in preference order, and whether that wire
 * parameter is a list.
 *
 * Four spellings across seven vendors, and the fourth is the interesting one:
 * `tripo3d/tripo/v2.5/multiview-to-3d` calls its required view
 * `front_image_url` and files the other three angles as optional siblings, so
 * the canonical `image` is that route's FRONT view and the rest are extras.
 * `image_urls` is a list at Rodin and Trellis 2, which is why the flag exists
 * at all — the adapter writes `[uri]` there and a bare string everywhere else.
 */
const THREE_D_IMAGE_WIRE: ReadonlyArray<readonly [name: string, list: boolean]> = [
  ["image_url", false],
  ["input_image_url", false],
  ["front_image_url", false],
  ["image_urls", true],
];

/** Where the GEOMETRY seed lands. Tripo publishes three seeds; this is the one that pins the mesh. */
const THREE_D_SEED_WIRE: readonly string[] = ["seed", "model_seed"];

/**
 * The 3d row: by which of two moods this route is told what to build.
 *
 * The only row in the generator that decides TWO canonical fields at once, and
 * the reason it can is that `prompt` and `image` are alternatives here rather
 * than companions. `["text"]` makes `prompt` required and `image` a compile
 * error; `["image"]` does the reverse; and a route that publishes both — which
 * is `fal-ai/hyper3d/rodin/v2.5`, where the prompt steers an image-driven
 * generation and also stands alone — leaves both optional, because requiring
 * either would make the other unusable.
 *
 * An endpoint that declares NEITHER is a curation error rather than a third
 * state: a 3D route that is told nothing about what to build does not exist,
 * and `inputs: []` would type both fields `never` and make the row uncallable.
 */
function applyThreeDRow(model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;
  const inputs: string[] = [];
  if (props["prompt"] !== undefined) inputs.push("text");

  const image = THREE_D_IMAGE_WIRE.find(([name]) => props[name] !== undefined);
  if (image !== undefined) {
    inputs.push("image");
    (row as { imageWire?: string }).imageWire = image[0];
    if (image[1]) (row as { imageWireList?: true }).imageWireList = true;
  }

  if (inputs.length === 0) {
    throw new Error(
      `${model.id}: curated as "threeD" but its input schema declares neither a \`prompt\` nor any of ` +
        `${THREE_D_IMAGE_WIRE.map(([name]) => name).join(", ")}. A 3D route that is told nothing about what ` +
        "to build cannot be served by `unmodel/3d` — teach THREE_D_IMAGE_WIRE its spelling, or curate it out.",
    );
  }
  // Sorted so `["image", "text"]` is the one spelling of the both-arm and the
  // shared-row hash cannot split on field order.
  (row as { inputs?: readonly string[] }).inputs = sorted(inputs);

  const seedWire = THREE_D_SEED_WIRE.find((name) => props[name] !== undefined);
  if (seedWire !== undefined) (row as { seedWire?: string }).seedWire = seedWire;
}

/**
 * English language NAMES onto BCP-47 primary subtags.
 *
 * fal's speech endpoints spell a language four different ways — a bare subtag
 * (`"en"`, wizper), a subtag with a region (`"pt-BR"`, xAI), a capitalised name
 * (`"Portuguese"`, MiniMax) and a name with a country (`"Portuguese (Brazil)"`,
 * Gemini) — and the canonical vocabulary spells it one way. This table is the
 * third and fourth cases; the first two are parsed.
 *
 * A name that is NOT here simply does not reach the row's `languages`, and that
 * is the deliberate failure mode: the list drives completion and the adapter's
 * wire mapping, so a guess would send a spelling the endpoint refuses. Gaps are
 * visible (a language an editor does not offer); guesses are not.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  afrikaans: "af", albanian: "sq", amharic: "am", arabic: "ar", armenian: "hy",
  azerbaijani: "az", bangla: "bn", basque: "eu", belarusian: "be", bengali: "bn",
  bulgarian: "bg", burmese: "my", catalan: "ca", cebuano: "ceb", chinese: "zh",
  "chinese mandarin": "zh", croatian: "hr", czech: "cs", danish: "da", dutch: "nl",
  english: "en", estonian: "et", filipino: "fil", finnish: "fi", french: "fr",
  galician: "gl", georgian: "ka", german: "de", greek: "el", gujarati: "gu",
  "haitian creole": "ht", hebrew: "he", hindi: "hi", hungarian: "hu", icelandic: "is",
  indonesian: "id", italian: "it", japanese: "ja", javanese: "jv", kannada: "kn",
  konkani: "kok", korean: "ko", lao: "lo", latin: "la", latvian: "lv",
  lithuanian: "lt", luxembourgish: "lb", macedonian: "mk", maithili: "mai",
  malagasy: "mg", malay: "ms", malayalam: "ml", marathi: "mr", mongolian: "mn",
  nepali: "ne", norwegian: "no", "norwegian bokmal": "nb", "norwegian nynorsk": "nn",
  nynorsk: "nn", odia: "or", pashto: "ps", persian: "fa", polish: "pl",
  portuguese: "pt", punjabi: "pa", romanian: "ro", russian: "ru", serbian: "sr",
  sindhi: "sd", sinhala: "si", slovak: "sk", slovenian: "sl", spanish: "es",
  swahili: "sw", swedish: "sv", tamil: "ta", telugu: "te", thai: "th",
  turkish: "tr", ukrainian: "uk", urdu: "ur", vietnamese: "vi", welsh: "cy",
};

/**
 * One enum member of a language field → the canonical primary subtag it means,
 * or `undefined` where it means something else.
 *
 * `"auto"` is the important `undefined`: "you decide" is not a language, in
 * exactly the way `"auto"` is not a duration at `durationSeconds`.
 */
function canonicalLanguage(value: string): string | undefined {
  const raw = value.trim();
  if (raw === "" || /^auto$/i.test(raw)) return undefined;
  // `"pt-BR"`, `"es_MX"`, `"Chinese,Yue"` — take the primary subtag only where
  // the head is already one.
  const head = raw.split(/[-_,]/)[0] as string;
  if (/^[a-z]{2,3}$/.test(head) && head === head.toLowerCase() && !/\s/.test(raw)) return head;
  // `"Portuguese (Brazil)"` → `"portuguese"`; `"english"` → `"english"`.
  const name = raw.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  return LANGUAGE_NAMES[name];
}

/**
 * fal's codec spellings onto the canonical {@link AudioFormatCodec} vocabulary.
 *
 * `wav` and `pcm` and `linear16` all mean signed 16-bit little-endian PCM —
 * the first two name a container and a family rather than an encoding, which is
 * the conflation every speech API makes and the reason the canonical word is
 * the exact one. What is deliberately absent is listed — with its reason — in
 * {@link FORMATS_THAT_ARE_NOT_CODECS}, where {@link assertCodecsComplete} can
 * read it.
 */
const CODEC_NAMES: Readonly<Record<string, string>> = {
  mp3: "mp3",
  aac: "aac",
  flac: "flac",
  opus: "opus",
  ogg_opus: "opus",
  vorbis: "vorbis",
  wav: "pcm_s16le",
  pcm: "pcm_s16le",
  linear16: "pcm_s16le",
  mulaw: "pcm_mulaw",
  ulaw: "pcm_mulaw",
  alaw: "pcm_alaw",
};

/**
 * One enum member of an `output_format` field → the canonical codec it means.
 *
 * The whole spelling first, then its head — which is what reads ElevenLabs
 * Music's composite `mp3_44100_128` / `pcm_16000` / `ulaw_8000` enum, where the
 * member states a codec AND a sample rate AND sometimes a bitrate. Only the
 * codec half is narrowed here: the legal (codec, rate, bitrate) triples are not
 * a cross product, which is the argument `TtsModelParams` makes for leaving
 * `sampleRate` to run time.
 */
function canonicalCodec(value: string): string | undefined {
  const raw = value.trim().toLowerCase();
  const whole = CODEC_NAMES[raw];
  if (whole !== undefined) return whole;
  return CODEC_NAMES[raw.split("_")[0] as string];
}

/**
 * `output_format` enum members that are NOT an encoding — the recorded
 * refusals, with the argument for each, in the one place
 * {@link assertCodecsComplete} reads.
 *
 * A reason that lives only in a comment is not recorded: the next fal spelling
 * lands beside these, the guard has nothing to compare it against, and the
 * member vanishes into a row nobody notices is short.
 */
const FORMATS_THAT_ARE_NOT_CODECS: Readonly<Record<string, string>> = {
  ogg: "a container, not an encoding — it carries Vorbis or Opus, and `fal-ai/stable-audio-3/medium/text-to-audio` spells `opus` on the same enum, so mapping `ogg` to Vorbis would be a guess about which arm the file takes",
  m4a: "a container, not an encoding — it carries AAC or ALAC, and the same enum already spells `aac`",
  url: "a DELIVERY switch wearing a codec's name: MiniMax's `output_format` picks how the audio comes back (a link) rather than how it is encoded",
  hex: "the other arm of MiniMax's delivery switch — hex-encoded bytes in the response body, still not an encoding",
};

/**
 * Wire enum → row completeness at `output_format`, the direction no preset
 * sweep can run.
 *
 * The codec twin of {@link assertRatiosComplete}, and the same argument:
 * `test/unified/tts-presets.test.ts` iterates `row.codecs` and asserts each
 * member compiles, which reads the artifact under suspicion and cannot see a
 * member the row FAILED to declare. Here every member of a CLOSED
 * `output_format` enum either canonicalises into the row's `codecs` or is named
 * in {@link FORMATS_THAT_ARE_NOT_CODECS} with its reason; anything else stops
 * codegen naming the endpoint, the member and both lists. A codec fal publishes
 * and unmodel drops is `outputFormat` typed `never` for an encoding fal would
 * have produced.
 *
 * An OPEN enum is exempt for the reason it is exempt at ratios: there the list
 * is a set of presets rather than a limit.
 */
function assertCodecsComplete(endpointId: string, members: readonly string[], codecs: readonly string[]): void {
  for (const member of members) {
    const canonical = canonicalCodec(member);
    if (canonical !== undefined && codecs.includes(canonical)) continue;
    if (FORMATS_THAT_ARE_NOT_CODECS[member.trim().toLowerCase()] !== undefined) continue;
    throw new Error(
      `${endpointId}: \`output_format\` enum member ${quote(member)} reached neither the row's canonical codecs ` +
        `(${codecs.map(quote).join(", ") || "none"}) nor the recorded refusals ` +
        `(${Object.keys(FORMATS_THAT_ARE_NOT_CODECS).map(quote).join(", ")}). An encoding fal publishes and ` +
        "unmodel drops types `outputFormat` as `never` for a request fal accepts — widen `CODEC_NAMES`, or " +
        "record the refusal in FORMATS_THAT_ARE_NOT_CODECS with the reason.",
    );
  }
}

/** The enum a property declares, as strings, or `undefined` if it declares none. */
function enumValues(prop: Prop | undefined): readonly string[] | undefined {
  if (prop === undefined || prop.node.k !== "prim" || prop.node.enum === undefined) return undefined;
  return prop.node.enum.map(String);
}

/**
 * The canonical→wire map for one enumerated field.
 *
 * `preferred` is the endpoint's own default, and it wins where it maps to the
 * same canonical value as an earlier member: at ElevenLabs Music both
 * `mp3_22050_32` and `mp3_44100_128` are `mp3`, and sending the 22 kHz one
 * because it happens to be listed first would quietly downgrade every request
 * that asked for `"mp3"`. Otherwise the FIRST member wins, which is fal's own
 * order and therefore reviewable against the model page.
 */
function valueMap(
  members: readonly string[],
  canonicalize: (value: string) => string | undefined,
  preferred?: string,
): { values: string[]; wire: Record<string, string> } {
  const values: string[] = [];
  const wire: Record<string, string> = {};
  for (const member of members) {
    const key = canonicalize(member);
    if (key === undefined) continue;
    if (wire[key] === undefined) {
      values.push(key);
      wire[key] = member;
    } else if (preferred !== undefined && member === preferred) {
      wire[key] = member;
    }
  }
  return { values, wire };
}

/** The literal a property declares as its default, as a string. */
function defaultString(prop: Prop | undefined): string | undefined {
  const value = prop?.default;
  return typeof value === "string" ? value : undefined;
}

/**
 * The codec half of a tts / music row.
 *
 * An EMPTY `codecs` is emitted deliberately and means "this endpoint has no
 * flat codec field", which is a different fact from "it has one with no
 * canonical member in it" and a different fact again from "it has none and the
 * caller may say anything". Three endpoints exercise all three: `xai/tts/v1`
 * spells its format as an OBJECT (`{ codec, sample_rate, bit_rate }`),
 * `fal-ai/minimax/speech-02-hd` spells `output_format` as `url | hex` — a
 * DELIVERY switch wearing a codec's name — and Kokoro has no format field at
 * all. All three type `outputFormat` as `never`, and the adapter's message
 * names which of the three it is.
 */
function applyFormatRow(model: EndpointModel, row: UnifiedRow): void {
  const prop = model.input.props["output_format"];
  if (prop === undefined) {
    // No field at all — Kokoro. Distinct from the two cases below, and the
    // adapter's message says which.
    (row as { codecs?: readonly string[] }).codecs = [];
    return;
  }
  // A field with no canonical member in it is still a field: naming it lets the
  // adapter say "this one is a delivery switch / an object, not a codec" rather
  // than "there is nothing here".
  (row as { formatWire?: string }).formatWire = "output_format";
  const members = enumValues(prop);
  if (members === undefined) {
    // `xai/tts/v1` spells its format as an OBJECT with `codec`, `sample_rate`
    // and `bit_rate` inside it — a shape the canonical `outputFormat` cannot
    // reach without flattening, which this library does not do.
    (row as { codecs?: readonly string[] }).codecs = [];
    return;
  }
  const { values, wire } = valueMap(members, canonicalCodec, defaultString(prop));
  (row as { codecs?: readonly string[] }).codecs = sorted(values);
  if (values.length > 0) {
    (row as { codecValues?: Readonly<Record<string, string>> }).codecValues = wire;
  }
  // A CLOSED enum is a limit, so every member of it has to be accounted for.
  // See assertCodecsComplete.
  if (prop.node.k === "prim" && prop.node.open !== true) {
    assertCodecsComplete(model.id, members, values);
  }
}

/** The language half of a tts / stt row — the same shape at both categories. */
function applyLanguageRow(model: EndpointModel, row: UnifiedRow, names: readonly string[]): void {
  const props = model.input.props;
  const wire = names.find((name) => props[name] !== undefined);
  if (wire === undefined) return;
  (row as { languageWire?: string }).languageWire = wire;
  const members = enumValues(props[wire]);
  if (members === undefined) {
    // `anyOf[string, null]` with no enum — ElevenLabs takes any BCP-47 code, so
    // there is nothing to complete and nothing to map.
    (row as { languageOpen?: true }).languageOpen = true;
    return;
  }
  const mapped = valueMap(members, canonicalLanguage);
  (row as { languages?: readonly string[] }).languages = sorted(mapped.values);
  (row as { languageValues?: Readonly<Record<string, string>> }).languageValues = mapped.wire;
}

/** The wire names a language can land on, per category, in preference order. */
const TTS_LANGUAGE_WIRE: readonly string[] = [
  "language",
  "language_code",
  "language_boost",
  "custom_audio_language",
];
const STT_LANGUAGE_WIRE: readonly string[] = ["language", "language_code"];

/**
 * The tts row: which words, which voice, which language, which codec, how fast.
 *
 * `voices` is the field this category is built around and the one the plan's
 * "shared row shape" guess got wrong: the nine Kokoro endpoints DO share a
 * shape — three parameters, same names, same bounds — and they emphatically do
 * not share a row, because each publishes its own voices (twenty for American
 * English, one for French) and that list is the whole reason a caller picks one
 * endpoint over another. Nine languages, nine rows, one shape.
 *
 * A missing `voiceWire` is a fact rather than a gap: MiniMax puts the voice in
 * `voice_setting.voice_id`, one level down, and unmodel does not flatten
 * objects into canonical words. The adapter refuses `voice` there by name and
 * points at `providerOptions`.
 */
function applyTtsRow(model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;
  if (props["voice"] !== undefined) {
    (row as { voiceWire?: string }).voiceWire = "voice";
    const members = enumValues(props["voice"]);
    if (members !== undefined) (row as { voices?: readonly string[] }).voices = members;
  }
  if (props["speed"] !== undefined) (row as { speedWire?: string }).speedWire = "speed";
  applyLanguageRow(model, row, TTS_LANGUAGE_WIRE);
  applyFormatRow(model, row);
}

/** fal's `chunk_level` vocabulary onto the canonical timing granularities. */
const TIMESTAMP_NAMES: Readonly<Record<string, string>> = {
  segment: "segment",
  word: "word",
  character: "character",
};

/**
 * The stt row: the language, the granularity, the diarization switch.
 *
 * `timestamps: []` is the answer for five of the six endpoints and it is the
 * honest one. ElevenLabs Scribe always returns word timings and offers no
 * switch to turn them off; fal's own `speech-to-text` returns whatever it
 * returns. An empty list types `timestamps` as `never`, which says "this route
 * does not take the question" — as opposed to a list containing `"none"`, which
 * would say "you may ask for plain text" and is true nowhere here.
 */
function applySttRow(model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;
  if (props["audio_url"] !== undefined) (row as { audioWire?: string }).audioWire = "audio_url";
  applyLanguageRow(model, row, STT_LANGUAGE_WIRE);

  const members = enumValues(props["chunk_level"]);
  const mapped =
    members === undefined
      ? { values: [] as string[], wire: {} as Record<string, string> }
      : valueMap(members, (value) => TIMESTAMP_NAMES[value.trim().toLowerCase()]);
  (row as { timestamps?: readonly string[] }).timestamps = sorted(mapped.values);
  if (mapped.values.length > 0) {
    (row as { timestampValues?: Readonly<Record<string, string>> }).timestampValues = mapped.wire;
  }

  if (props["diarize"] !== undefined) (row as { diarizeWire?: string }).diarizeWire = "diarize";
}

/**
 * Where a clip length lands, in preference order, and in what unit.
 *
 * Four spellings across ten endpoints, and `music_length_ms` is why the
 * canonical word is `durationSeconds` rather than `duration`: a bare number
 * here means milliseconds at ElevenLabs and seconds everywhere else, and a
 * caller who guessed wrong would get a track a thousand times too long or too
 * short with nothing in the request to say so.
 */
const MUSIC_LENGTH_WIRE: ReadonlyArray<readonly [name: string, ms: boolean]> = [
  ["duration", false],
  ["seconds_total", false],
  ["music_duration", false],
  ["music_length_ms", true],
];

/** Where an instrumental switch lands. Two spellings, two endpoints. */
const MUSIC_INSTRUMENTAL_WIRE: readonly string[] = ["is_instrumental", "force_instrumental"];

/** The music row: the length, the instrumental switch, the codec. */
function applyMusicRow(model: EndpointModel, row: UnifiedRow): void {
  const props = model.input.props;

  const length = MUSIC_LENGTH_WIRE.find(([name]) => props[name] !== undefined);
  if (length !== undefined) {
    const [name, ms] = length;
    (row as { lengthWire?: string }).lengthWire = name;
    if (ms) (row as { lengthUnit?: "ms" }).lengthUnit = "ms";
    const node = (props[name] as Prop).node;
    if (node.k === "prim" && node.enum !== undefined) {
      // DiffRhythm's `"95s" | "285s"` — a closed set of lengths spelled as
      // strings, read through the same parser video's `duration` uses.
      const seconds: number[] = [];
      const wire: Record<string, string | number> = {};
      for (const value of node.enum) {
        const parsed = durationSeconds(value);
        if (parsed === undefined || seconds.includes(parsed)) continue;
        seconds.push(parsed);
        wire[String(parsed)] = value;
      }
      if (seconds.length > 0) {
        (row as { lengths?: readonly number[] }).lengths = seconds.sort((a, b) => a - b);
        (row as { lengthValues?: Readonly<Record<string, string | number>> }).lengthValues = wire;
      }
    }
  }

  const instrumental = MUSIC_INSTRUMENTAL_WIRE.find((name) => props[name] !== undefined);
  if (instrumental !== undefined) {
    (row as { instrumentalWire?: string }).instrumentalWire = instrumental;
  }

  applyFormatRow(model, row);
}

/**
 * Wire parameters that may never become a unified `extras` entry, whatever the
 * verb.
 *
 * `model` is the whole list, and it is not a style rule — it is a name
 * collision that reduces a call to `never`. Every unified category declares
 * `model` as the `"provider/model"` REF, and an extras key of the same name
 * lands in the same intersection: `("fal/fal-ai/sync-lipsync/v2" | (string & {}))
 * & ("lipsync-2" | "lipsync-2-pro" | undefined)` is `never`, and TypeScript
 * reduces the whole params object with it. Every field in the call then reports
 * "Type 'string' is not assignable to type 'never'", none of them naming the
 * cause. Measured on `fal-ai/sync-lipsync/v2`, the one curated endpoint with a
 * real `model` body field.
 *
 * It stays a real wire parameter at the HAND surface — `fal.lipsync({ endpoint:
 * "fal-ai/sync-lipsync/v2", model: "lipsync-2-pro", … })` is typed from the
 * endpoint's own enum and goes out as written — and unified callers reach it
 * through `providerOptions.fal.model`, which is merged before validation and
 * checked by the same IR. What is refused is only the ONE spelling that would
 * silently break the surface it collided with.
 *
 * This is the same collision that made the route selector `endpoint` rather
 * than `model` (risk R6), one layer up.
 */
const NEVER_AN_EXTRA: ReadonlySet<string> = new Set(["model"]);

function unifiedRow(verb: Verb, model: EndpointModel): UnifiedRow {
  const props = model.input.props;
  const canonical = new Set(CANONICAL_WIRE_PARAMS[verb] ?? []);
  // The curated text parameter, where the category treats it as a canonical
  // word rather than an extra. See TEXT_PARAM_IS_CANONICAL for why only three
  // of the nine verbs look it up.
  const textWire = TEXT_PARAM_IS_CANONICAL.has(verb) ? model.curation.textParam : undefined;
  if (textWire !== undefined) canonical.add(textWire);
  const row: UnifiedRow = {
    classes: model.shapes,
    keys: model.input.order,
    extras: model.input.order.filter((name) => !canonical.has(name) && !NEVER_AN_EXTRA.has(name)),
  };
  if (textWire !== undefined) (row as { textWire?: string }).textWire = textWire;

  const imageSize = props["image_size"];
  if (imageSize !== undefined) {
    // fal's presets are literal `size` values — `"landscape_4_3"` is what the
    // endpoint takes, not a translation of one. Explicit pixels reach the same
    // endpoint through `dimensions`, so `size` gets no free-form tail: here the
    // list genuinely IS the limit for this spelling.
    //
    // The presets sit on the string arm of the `anyOf[$ref ImageSize, enum]`
    // union, so a union has to be searched rather than read.
    const arms = imageSize.node.k === "union" ? imageSize.node.arms : [imageSize.node];
    const presets = arms
      .flatMap((arm) => (arm.k === "prim" && arm.t === "string" && arm.enum !== undefined ? [arm.enum] : []))
      .flat();
    if (presets.length > 0) (row as { sizes?: readonly string[] }).sizes = presets.map(String);
    // The explicit-dimensions arm's bounds, so the adapter can solve a ratio
    // into pixels this endpoint actually accepts rather than into a guess.
    const object = arms.find((arm) => arm.k === "ref" || arm.k === "object");
    if (object !== undefined) {
      const width = imageSizeDimension(object, "width");
      const bounds: { min?: number; max?: number } = {};
      if (width?.min !== undefined) bounds.min = width.min;
      else if (width?.xmin !== undefined) bounds.min = width.xmin + 1;
      if (width?.max !== undefined) bounds.max = width.max;
      if (bounds.min !== undefined || bounds.max !== undefined) {
        (row as { pixels?: { min?: number; max?: number } }).pixels = bounds;
      }
    }
  }

  const aspect = props["aspect_ratio"];
  if (aspect?.node.k === "prim" && aspect.node.enum !== undefined) {
    const ratios = canonicalRatios(aspect.node.enum);
    if (ratios.length > 0) (row as { ratios?: readonly string[] }).ratios = ratios;
    // An OPEN enum accepts any string, so the list is a set of presets rather
    // than a limit — which is exactly what `ratioFreeform` means.
    if (aspect.node.open === true) (row as { ratioFreeform?: true }).ratioFreeform = true;
    // …and a CLOSED enum is a limit, so every member of it has to be accounted
    // for. See assertRatiosComplete.
    else assertRatiosComplete(model.id, aspect.node.enum, ratios);
  }

  // `tiers` types the canonical `resolution` field, so it is only meaningful
  // for a category that HAS one. On `imageEdit` the wire `resolution` is an
  // extra, and a row claiming tiers there would narrow a word that category
  // does not have.
  const resolution = canonical.has("resolution") ? props["resolution"] : undefined;
  if (resolution?.node.k === "prim" && resolution.node.enum !== undefined) {
    const tiers: string[] = [];
    for (const value of resolution.node.enum) {
      const tier = canonicalTier(String(value));
      if (tier !== undefined && !tiers.includes(tier)) tiers.push(tier);
    }
    if (tiers.length > 0) {
      (row as { tiers?: readonly string[] }).tiers = tiers;
      // fal spells the tiers `"1K"` / `"2K"`; the canonical vocabulary spells
      // them `"1k"` / `"2k"`. The adapter needs the way back, and the
      // generator is the only place that has seen both.
      const wire: Record<string, string> = {};
      for (const value of resolution.node.enum) {
        const tier = canonicalTier(String(value));
        if (tier !== undefined && wire[tier] === undefined) wire[tier] = String(value);
      }
      (row as { tierWire?: Readonly<Record<string, string>> }).tierWire = wire;
    }
  }

  if (verb === "video") applyVideoRow(model, row);
  if (verb === "lipsync" || verb === "avatar") applySourceRow(verb, model, row);
  if (verb === "upscale") applyUpscaleRow(model, row);
  if (verb === "threeD") applyThreeDRow(model, row);
  if (verb === "tts") applyTtsRow(model, row);
  if (verb === "stt") applySttRow(model, row);
  if (verb === "music") applyMusicRow(model, row);

  // Numeric bounds on the canonical params. `strength` is the one that earns
  // this today: `fal-ai/flux/dev/image-to-image` floors it at 0.01, and the
  // canonical scale starts at 0 — so an adapter that did not know the floor
  // would send a value fal refuses for the commonest thing a caller can ask
  // ("keep the source").
  const bounds: Record<string, { min?: number; max?: number }> = {};
  for (const name of canonical) {
    const prop = props[name];
    if (prop?.node.k !== "prim") continue;
    if (prop.node.t !== "number" && prop.node.t !== "integer") continue;
    const entry: { min?: number; max?: number } = {};
    if (prop.node.min !== undefined) entry.min = prop.node.min;
    if (prop.node.max !== undefined) entry.max = prop.node.max;
    if (entry.min !== undefined || entry.max !== undefined) bounds[name] = entry;
  }
  if (Object.keys(bounds).length > 0) {
    (row as { bounds?: Readonly<Record<string, { min?: number; max?: number }>> }).bounds = bounds;
  }

  return row;
}

/**
 * One canonical→wire value map, as a row field.
 *
 * Broken across lines past six entries, which is not cosmetic: Gemini's
 * `language_code` maps 87 subtags onto 87 spellings, and a single 4 KB line is
 * a diff nobody can review after a refresh.
 */
function renderWireMap(name: string, map: Readonly<Record<string, string>>): string {
  const keys = sorted(Object.keys(map));
  const pairs = keys.map((key) => `${propKey(key)}: ${quote(map[key] as string)}`);
  if (pairs.length <= 6) return `  ${name}: { ${pairs.join(", ")} },`;
  return `  ${name}: {\n${pairs.map((pair) => `    ${pair},`).join("\n")}\n  },`;
}

function renderParamsFile(verb: Verb, models: readonly EndpointModel[]): string {
  // Endpoints with the same geometry classes and the same parameter surface
  // share one frozen row. The d.ts cost of a per-endpoint literal is real at a
  // hundred endpoints, and identical rows would also imply a distinction fal
  // does not make.
  const rows = new Map<string, UnifiedRow>();
  const rowName = new Map<string, string>();
  const rowOwner = new Map<string, EndpointModel>();
  for (const model of models) {
    const row = unifiedRow(verb, model);
    const key = hash6(canonical(row));
    if (!rows.has(key)) {
      rows.set(key, row);
      rowOwner.set(key, model);
    }
    rowName.set(model.id, `ROW_${key}`);
  }

  const wireTypes = new Set<string>();
  for (const key of rows.keys()) {
    const row = rows.get(key) as UnifiedRow;
    if (row.extras.length > 0) wireTypes.add((rowOwner.get(key) as EndpointModel).inputTypeName);
  }

  const rowBlock = sorted([...rows.keys()])
    .map((key) => {
      const row = rows.get(key) as UnifiedRow;
      const owner = rowOwner.get(key) as EndpointModel;
      const shared = models.filter((model) => rowName.get(model.id) === `ROW_${key}`);
      const fields: string[] = [
        `  classes: ${renderStringArray(row.classes)},`,
        `  keys: ${renderStringArray(row.keys)},`,
      ];
      if (row.sizes !== undefined) fields.push(`  sizes: ${renderStringArray(row.sizes)},`);
      if (row.ratios !== undefined) fields.push(`  ratios: ${renderStringArray(row.ratios)},`);
      if (row.ratioFreeform === true) fields.push("  ratioFreeform: true,");
      if (row.tiers !== undefined) fields.push(`  tiers: ${renderStringArray(row.tiers)},`);
      if (row.tierWire !== undefined) {
        const pairs = sorted(Object.keys(row.tierWire))
          .map((tier) => `${propKey(tier)}: ${quote((row.tierWire as Record<string, string>)[tier] as string)}`)
          .join(", ");
        fields.push(`  tierWire: { ${pairs} },`);
      }
      if (row.pixels !== undefined) {
        const parts: string[] = [];
        if (row.pixels.min !== undefined) parts.push(`min: ${num(row.pixels.min)}`);
        if (row.pixels.max !== undefined) parts.push(`max: ${num(row.pixels.max)}`);
        fields.push(`  pixels: { ${parts.join(", ")} },`);
      }
      if (row.durations !== undefined) {
        fields.push(`  durations: [${row.durations.map((value) => num(value)).join(", ")}],`);
      }
      if (row.durationWire !== undefined) {
        const wire = row.durationWire;
        const pairs = sorted(Object.keys(wire))
          .map((seconds) => {
            const value = wire[seconds] as string | number;
            return `${propKey(seconds)}: ${typeof value === "number" ? num(value) : quote(value)}`;
          })
          .join(", ");
        fields.push(`  durationWire: { ${pairs} },`);
      }
      if (row.resolutions !== undefined) {
        fields.push(`  resolutions: ${renderStringArray(row.resolutions)},`);
      }
      if (row.resolutionWire !== undefined) {
        const wire = row.resolutionWire;
        const pairs = sorted(Object.keys(wire))
          .map((tier) => `${propKey(tier)}: ${quote(wire[tier] as string)}`)
          .join(", ");
        fields.push(`  resolutionWire: { ${pairs} },`);
      }
      if (row.roles !== undefined) fields.push(`  roles: ${renderStringArray(row.roles)},`);
      if (row.roleWire !== undefined) {
        const wire = row.roleWire;
        const pairs = sorted(Object.keys(wire))
          .map((role) => `${propKey(role)}: ${quote(wire[role] as string)}`)
          .join(", ");
        fields.push(`  roleWire: { ${pairs} },`);
      }
      if (row.videoWire !== undefined) fields.push(`  videoWire: ${quote(row.videoWire)},`);
      if (row.sources !== undefined) fields.push(`  sources: ${renderStringArray(row.sources)},`);
      if (row.sourceWire !== undefined) fields.push(`  sourceWire: ${quote(row.sourceWire)},`);
      if (row.audioWire !== undefined) fields.push(`  audioWire: ${quote(row.audioWire)},`);
      if (row.factorWire !== undefined) fields.push(`  factorWire: ${quote(row.factorWire)},`);
      if (row.factors !== undefined) {
        fields.push(`  factors: [${row.factors.map((value) => num(value)).join(", ")}],`);
      }
      if (row.inputs !== undefined) fields.push(`  inputs: ${renderStringArray(row.inputs)},`);
      if (row.imageWire !== undefined) fields.push(`  imageWire: ${quote(row.imageWire)},`);
      if (row.imageWireList === true) fields.push("  imageWireList: true,");
      if (row.seedWire !== undefined) fields.push(`  seedWire: ${quote(row.seedWire)},`);
      if (row.textWire !== undefined) fields.push(`  textWire: ${quote(row.textWire)},`);
      if (row.voiceWire !== undefined) fields.push(`  voiceWire: ${quote(row.voiceWire)},`);
      if (row.voices !== undefined) fields.push(`  voices: ${renderStringArray(row.voices)},`);
      if (row.speedWire !== undefined) fields.push(`  speedWire: ${quote(row.speedWire)},`);
      if (row.languageWire !== undefined) fields.push(`  languageWire: ${quote(row.languageWire)},`);
      if (row.languageOpen === true) fields.push("  languageOpen: true,");
      if (row.languages !== undefined) fields.push(`  languages: ${renderStringArray(row.languages)},`);
      if (row.languageValues !== undefined) fields.push(renderWireMap("languageValues", row.languageValues));
      if (row.formatWire !== undefined) fields.push(`  formatWire: ${quote(row.formatWire)},`);
      if (row.codecs !== undefined) fields.push(`  codecs: ${renderStringArray(row.codecs)},`);
      if (row.codecValues !== undefined) fields.push(renderWireMap("codecValues", row.codecValues));
      if (row.timestamps !== undefined) fields.push(`  timestamps: ${renderStringArray(row.timestamps)},`);
      if (row.timestampValues !== undefined) {
        fields.push(renderWireMap("timestampValues", row.timestampValues));
      }
      if (row.diarizeWire !== undefined) fields.push(`  diarizeWire: ${quote(row.diarizeWire)},`);
      if (row.lengthWire !== undefined) fields.push(`  lengthWire: ${quote(row.lengthWire)},`);
      if (row.lengthUnit !== undefined) fields.push(`  lengthUnit: ${quote(row.lengthUnit)},`);
      if (row.lengths !== undefined) {
        fields.push(`  lengths: [${row.lengths.map((value) => num(value)).join(", ")}],`);
      }
      if (row.lengthValues !== undefined) {
        const wire = row.lengthValues;
        const pairs = sorted(Object.keys(wire))
          .map((seconds) => {
            const value = wire[seconds] as string | number;
            return `${propKey(seconds)}: ${typeof value === "number" ? num(value) : quote(value)}`;
          })
          .join(", ");
        fields.push(`  lengthValues: { ${pairs} },`);
      }
      if (row.instrumentalWire !== undefined) {
        fields.push(`  instrumentalWire: ${quote(row.instrumentalWire)},`);
      }
      if (row.bounds !== undefined) {
        const entries = sorted(Object.keys(row.bounds)).map((name) => {
          const bound = (row.bounds as Record<string, { min?: number; max?: number }>)[name] as {
            min?: number;
            max?: number;
          };
          const parts: string[] = [];
          if (bound.min !== undefined) parts.push(`min: ${num(bound.min)}`);
          if (bound.max !== undefined) parts.push(`max: ${num(bound.max)}`);
          return `${propKey(name)}: { ${parts.join(", ")} }`;
        });
        fields.push(`  bounds: { ${entries.join(", ")} },`);
      }
      const extras =
        row.extras.length === 0
          ? "  extras: {},"
          : `  extras: {\n${row.extras
              .map(
                (name) =>
                  `    ${propKey(name)}: EXTRA as ${owner.inputTypeName}[${quote(name)}],`,
              )
              .join("\n")}\n  },`;
      fields.push(extras);
      return `${renderDoc(
        [
          shared.length === 1
            ? `${shared[0]?.id}.`
            : `Shared by ${shared.length} endpoints with an identical surface: ${shared
                .map((model) => model.id)
                .join(", ")}.`,
          ...(row.extras.length === 0
            ? []
            : [
                "",
                `The extras are typed from \`${owner.inputTypeName}\`, so the value an editor offers here and the`,
                "value `fal." + verb + "` validates are one declaration.",
              ]),
        ],
        "",
      )}const ROW_${key} = {
${fields.join("\n")}
} as const;`;
    })
    .join("\n\n");

  const importLine =
    wireTypes.size === 0
      ? ""
      : `import type {\n${sorted([...wireTypes])
          .map((name) => `  ${name},`)
          .join("\n")}\n} from "./${verbSlug(verb)}-wire.gen";\n`;

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    `How each unified-eligible \`fal.${verb}\` endpoint lets a caller state geometry, and which wire keys it takes.`,
    "",
    "`classes` is what the unified adapter branches on. One branch per shape class, never one per endpoint: at a",
    "hundred endpoints a per-endpoint switch is both unreadable and a d.ts liability, and the classes are",
    "exhaustive by construction — an endpoint whose geometry parameters fit none of them fails codegen rather",
    "than falling through.",
    "",
    "The rest is the per-model narrowing the unified surface reads: `sizes` / `ratios` / `tiers` are this",
    "endpoint's own vocabulary for the canonical size words, and `extras` is everything it takes that the",
    "canonical vocabulary has no word for, typed from that endpoint's own wire interface.",
    "",
    "`keys` is fal's own parameter list, in fal's own order.",
  ],
  "",
)}
import type { FalParamShape } from "../shape-types";
${importLine}
/**
 * The value half of an \`extras\` entry: \`undefined\` at run time, the cast's type
 * at compile time.
 *
 * Declared here rather than imported from \`core/unified/derive\` on purpose —
 * a generated module is DATA, and importing a runtime value from the unified
 * kernel would put that kernel behind every \`unmodel/fal/values\` import. It is
 * the same one-line definition, and \`test/import-graph.test.ts\` is what keeps
 * the rule it protects honest.
 */
const EXTRA: never = undefined as never;

${rowBlock}

export const FAL_${verbConst(verb)}_PARAM_SHAPES = {
${models.map((model) => `  ${quote(model.id)}: ${rowName.get(model.id)},`).join("\n")}
} as const satisfies Record<string, FalParamShape>;

${renderDoc(
  [
    `Every unified-eligible \`fal.${verb}\` endpoint id, in the order the table above keys them.`,
    "",
    "Here separately from `endpoints.gen.ts` so the import-free `*-params` leaf can publish its adapter model",
    "list without reaching for a second generated module — the leaf rule (A10b in test/import-graph.test.ts)",
    "allows it exactly one, and this is it. Direct-only ids remain in the provider-native artifacts.",
  ],
  "",
)}
export const FAL_${verbConst(verb)}_MODELS = ${renderStringArray(models.map((model) => model.id))} as const;
`;
}

/**
 * The rate table `src/providers/fal/pricing.ts` computes from.
 *
 * This is the pricing half of "the generator emits DATA, hand code owns
 * BEHAVIOR". `data/fal/pricing.json` is a human reading a sentence off a model
 * page and writing down what it said; this file is that transcription in a
 * shape a function can read; and `pricing.ts` is the arithmetic — the
 * per-megapixel ceiling rule, the tier lookups, and the decision to answer
 * `undefined` rather than guess.
 *
 * Emitting it rather than hand-writing a second copy is the whole point. A
 * hand table would be 54 rates transcribed twice, and the second copy would be
 * the one that went stale after a refresh: `pricing.json` fails codegen when a
 * curated endpoint has no rate, but nothing could make it fail when a hand
 * table disagreed with it.
 *
 * Note what is here that `models-*.gen.ts` cannot carry: `ModelCost` expresses
 * exactly four units, so a per-megapixel, tiered or conditional rate reaches
 * the catalog only as a provenance comment. It reaches an ESTIMATE through
 * this file.
 */
function renderPricingFile(models: readonly EndpointModel[]): string {
  const rows = models
    .map((model) => {
      const row = model.pricing;
      const fields: string[] = [];
      if (row.unpriced !== undefined) {
        fields.push(`unpriced: ${quote(row.unpriced)}`);
      } else {
        if (row.unit !== undefined) fields.push(`unit: ${quote(row.unit)}`);
        if (row.usd !== undefined) fields.push(`usd: ${num(row.usd)}`);
        if (row.rounding !== undefined) fields.push(`rounding: ${quote(row.rounding)}`);
        if (row.tierKey !== undefined) fields.push(`tierKey: ${quote(row.tierKey)}`);
        if (row.tiers !== undefined) {
          const tiers = row.tiers
            .map((tier) => `{ when: ${quote(tier.when)}, usd: ${num(tier.usd)} }`)
            .join(", ");
          fields.push(`tiers: [${tiers}]`);
        }
      }
      fields.push(`source: ${quote(row.source)}`);
      fields.push(`verified: ${quote(row.verified)}`);
      return `  ${quote(model.id)}: { ${fields.join(", ")} },`;
    })
    .join("\n");

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    "Every curated fal endpoint's published rate, as data.",
    "",
    "Transcribed from each endpoint's public model page into `data/fal/pricing.json` — quote, source URL and",
    "date included there — and emitted here in the shape `../pricing.ts` computes from. fal publishes no",
    "machine-readable rate anywhere, in the Platform API or the OpenAPI document, so a human read a sentence",
    "for every row below.",
    "",
    "A rate here is NOT a cost. `per_megapixel` needs the request's dimensions, `tiered` needs a quantity and",
    "`conditional` needs whichever field selects the tier — and when the request leaves that open, the honest",
    "answer is `undefined`. That arithmetic, and that refusal, live in `../pricing.ts`.",
  ],
  "",
)}
import type { FalRate } from "../pricing-types";

export const FAL_RATES = {
${rows}
} as const satisfies Record<string, FalRate>;
`;
}

function renderModelsFile(verb: Verb, models: readonly EndpointModel[]): string {
  const rows = models
    .map((model) => {
      const fields: string[] = [
        `    id: ${quote(model.id)},`,
        `    name: ${quote(model.displayName)},`,
        "    attachment: false,",
        "    reasoning: false,",
        "    toolCall: false,",
        "    openWeights: false,",
      ];
      if (model.updatedAt !== undefined) fields.push(`    lastUpdated: ${quote(model.updatedAt)},`);
      if (model.status === "deprecated") fields.push(`    status: "deprecated",`);
      fields.push(
        `    modalities: { input: ${renderStringArray(model.modalities.input)}, output: ${renderStringArray(
          model.modalities.output,
        )} },`,
      );
      fields.push(
        `    limit: ${renderLimit({ context: 0, ...(model.characterLimit === undefined ? {} : { characters: model.characterLimit }) })},`,
      );
      const cost = costFor(model.pricing);
      const rendered = cost === undefined ? undefined : renderMediaCost(cost);
      if (rendered !== undefined) fields.push(`    cost: ${rendered},`);
      return `${pricingComment(model.pricing, "  ")}  ${quote(model.id)}: {
${fields.join("\n")}
  },`;
    })
    .join("\n");

  return `${header(models.map((model) => model.snapshotFile))}
${renderDoc(
  [
    `The catalog slice for \`fal.${verb}\`.`,
    "",
    "fal is not in models.dev, so these rows follow src/providers/HAND_CATALOGS.md — with one difference worth",
    "stating: the SHAPE is generated from fal's own published schema and listing, while the PRICING above each",
    "row is hand-transcribed from a public model page, quote and date included. fal publishes no",
    "machine-readable rate anywhere.",
    "",
    "`limit.context: 0` throughout: none of these models has a token context window, and 0 is what tells the",
    "pipeline to skip the context check rather than to refuse every request.",
  ],
  "",
)}
import type { ModelInfo } from "../../../core/catalog-types";

export const ${verb}Models = {
${rows}
} as const satisfies Record<string, ModelInfo>;

export type Fal${pascalCase(verb)}ModelId = keyof typeof ${verb}Models;
`;
}

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

export interface GenerateInput {
  /** endpoint id → the committed snapshot's parsed JSON. */
  snapshots: Record<string, unknown>;
  curation: unknown;
  pricing: unknown;
  overlays: unknown;
  /**
   * `YYYY-MM-DD`, supplied by `main()` for the retirement-escrow check only.
   *
   * The generated BYTES never depend on it — a retired endpoint's row is
   * identical whether the escrow has expired or not; the date only decides
   * whether codegen throws instead. Omit it and the escrow is not enforced,
   * which is what keeps `generate` a pure function in tests.
   */
  today?: string;
}

/**
 * Pure generation: committed inputs → map of `src/providers/fal/gen/`-relative
 * path → file content.
 *
 * Imports no `src/` module, by rule. The generator must stay runnable against a
 * tree whose generated files are absent, broken, or mid-rename.
 */
export function generate(input: GenerateInput): Map<string, string> {
  const curation = curationSchema.parse(input.curation);
  const pricing = pricingSchema.parse(input.pricing);
  const overlays = overlaysSchema.parse(input.overlays);

  const curatedIds = sorted(Object.keys(curation.endpoints));
  const snapshotIds = sorted(Object.keys(input.snapshots));

  const missing = curatedIds.filter((id) => !snapshotIds.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `No committed snapshot for curated endpoint(s): ${missing.join(", ")}. ` +
        "Run `bun run codegen:fal:refresh` to fetch them.",
    );
  }
  const orphans = snapshotIds.filter((id) => !curatedIds.includes(id));
  if (orphans.length > 0) {
    throw new Error(
      `Snapshot(s) with no curation entry: ${orphans.join(", ")}. ` +
        "Add them to data/fal/curation.json or delete the snapshot — an uncurated snapshot is dead weight " +
        "that the weekly refresh keeps alive.",
    );
  }

  const registry = new ComponentRegistry();
  const models: EndpointModel[] = [];
  const typeNames = new Map<string, string>();

  for (const id of curatedIds) {
    const entry = curation.endpoints[id] as CurationEntry;
    const snapshot = snapshotSchema.parse(input.snapshots[id]);
    const doc = snapshot.openapi as unknown as {
      info?: Record<string, unknown>;
      paths: Record<string, unknown>;
      servers: Array<{ url: string }>;
      components: { schemas: Record<string, Schema> };
    };

    const ctx: LowerCtx = {
      endpointId: id,
      schemas: doc.components.schemas,
      registry,
      resolved: new Map(),
      visiting: new Set(),
    };

    // The submit URL is DERIVED and then asserted, never trusted from
    // `metadata.model_url` — that field is the SYNC host (`fal.run`), and using
    // it as the submit URL would silently produce blocking requests.
    //
    // ## The document's path is not always the endpoint id
    //
    // For an id under `fal-ai/`, the OpenAPI `paths` key IS the id. For an id
    // under a VENDOR namespace it is not, and the difference is not cosmetic:
    //
    //   alibaba/qwen-image-3/edit        → /fal-ai/qwen-image-3/edit
    //   bytedance/seedream/v5/pro/edit   → /fal-ai/seedream-5-pro/edit
    //   ideogram/v4                      → /fal-ai/ideogram-v4
    //   google/nano-banana-2-lite        → /fal-ai/nano-banana-lite
    //   xai/grok-imagine-image           → /fal-ai/xai
    //
    // Both spellings are live routes — probed unauthenticated on 2026-08-24,
    // each answering 401 (auth required, route resolves) where a fabricated id
    // answers 404. The path in the document is fal's INTERNAL alias; the
    // `endpoint_id` the listing publishes is the documented, catalog-keyed,
    // user-typed route, and it is the one unmodel builds `.request.url` from.
    //
    // So the submit path is located STRUCTURALLY — the one path that is not a
    // `/requests/{request_id}` sub-path — rather than by matching the id. What
    // still gets asserted is everything that matters: that there is exactly one
    // such path, that it carries a POST, and that the server is the queue host.
    const serverUrl = doc.servers[0]?.url ?? "";
    const submitPaths = Object.keys(doc.paths).filter((path) => !path.includes("/requests/"));
    if (submitPaths.length !== 1) {
      throw new Error(
        `${id}: expected exactly one non-\`/requests/\` path in the snapshot, found ` +
          `${submitPaths.length} (${submitPaths.join(", ") || "none"}). The submit route is located by shape, ` +
          "not by name, because a vendor-namespaced id and its document's path legitimately differ.",
      );
    }
    const submitPath = submitPaths[0] as string;
    const post = (doc.paths[submitPath] as { post?: unknown } | undefined)?.post;
    if (post === undefined) {
      throw new Error(`${id}: ${submitPath} declares no POST — the document's only route is not a submit route`);
    }
    if (serverUrl !== QUEUE_BASE_URL) {
      throw new Error(
        `${id}: document server is ${quote(serverUrl)}, expected ${quote(QUEUE_BASE_URL)}. ` +
          "unmodel routes fal by interpolating the endpoint id into the queue host; a different host means a " +
          "different contract.",
      );
    }
    // Recorded, not corrected: the alias is a true fact about fal's routing and
    // belongs in the provenance, but it never becomes the URL.
    const routeAlias = submitPath === `/${id}` ? undefined : submitPath.slice(1);

    assertModellable(doc.components.schemas, "#/components/schemas", ctx);

    const requestRef = (
      (post as { requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> } }).requestBody
        ?.content?.["application/json"]?.schema?.$ref
    );
    if (typeof requestRef !== "string") {
      throw new Error(`${id}: POST ${submitPath} declares no application/json request schema $ref`);
    }
    const resultRef = (
      (doc.paths[`${submitPath}/requests/{request_id}`] as
        | { get?: { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> } }
        | undefined)?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref
    );
    if (typeof resultRef !== "string") {
      throw new Error(`${id}: no result schema $ref on GET ${submitPath}/requests/{request_id}`);
    }

    const deps = new Set<string>();
    const inputName = refName(requestRef, ctx, "#/paths");
    const outputName = refName(resultRef, ctx, "#/paths");
    const inputModel = lowerObject(doc.components.schemas[inputName] as Schema, `#/components/schemas/${inputName}`, ctx, deps);
    const outputModel = lowerObject(doc.components.schemas[outputName] as Schema, `#/components/schemas/${outputName}`, ctx, deps);

    // `endpoint` is unmodel's route pseudo-param; a real wire field by that
    // name would be stripped in finalize and silently never sent.
    if (inputModel.props["endpoint"] !== undefined) {
      throw new Error(
        `${id}: declares a wire property named \`endpoint\`, which collides with unmodel's route pseudo-param ` +
          "(stripped in finalize and interpolated into the URL). Rename the pseudo-param or curate this " +
          "endpoint out — it cannot be served as-is.",
      );
    }
    // R6: `model` is a real field on several fal endpoints. It must be a
    // reviewed, per-id decision rather than something codegen absorbs.
    if (inputModel.props["model"] !== undefined && entry.allowsModelProperty !== true) {
      throw new Error(
        `${id}: declares a top-level \`model\` property. unmodel routes fal with the \`endpoint\` pseudo-param, ` +
          "so a genuine `model` wire field is an exception that has to be reviewed: set " +
          '`"allowsModelProperty": true` on this id in data/fal/curation.json, with a note saying what the ' +
          "field selects.",
      );
    }

    const priceRow = pricing.endpoints[id];
    if (priceRow === undefined) {
      throw new Error(
        `${id}: no entry in data/fal/pricing.json. Every curated endpoint needs either a rate (with source, ` +
          "date and quote) or an explicit `unpriced` reason — silence about price is the one thing that file " +
          "may not say.",
      );
    }
    if (priceRow.unpriced === undefined && priceRow.usd === undefined && priceRow.tiers === undefined) {
      throw new Error(`${id}: pricing row has neither a rate, a tier table, nor an \`unpriced\` reason.`);
    }

    const falMeta = (doc.info?.["x-fal-metadata"] ?? {}) as Record<string, unknown>;
    const listing = (snapshot.metadata ?? {}) as Record<string, unknown>;
    const retired = entry.retiredOn !== undefined;
    const listedStatus = metadataString(listing, "status") ?? "active";
    if (retired && input.today !== undefined) {
      const age =
        (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${entry.retiredOn as string}T00:00:00Z`)) /
        86_400_000;
      if (age > RETIREMENT_ESCROW_DAYS) {
        throw new Error(
          `${id}: retiredOn ${entry.retiredOn} is ${Math.floor(age)} days old, past the ` +
            `${RETIREMENT_ESCROW_DAYS}-day escrow. Remove it from data/fal/curation.json and delete its snapshot.`,
        );
      }
    }

    // Shape classes exist only for the unified adapter's canonical lowering.
    // A direct-only endpoint is still fully represented by its wire/schema/IR
    // artifacts, and must not be rejected because that separate vocabulary has
    // no branch for one of its geometry or duration fields.
    const shapes = entry.unified === false ? [] : classifyShapes(id, entry.verb, inputModel, registry);
    const textProp = entry.textParam === undefined ? undefined : inputModel.props[entry.textParam];
    if (entry.textParam !== undefined && textProp === undefined) {
      throw new Error(
        `${id}: curation names textParam "${entry.textParam}", which the schema does not declare. ` +
          `Declared: ${sorted(Object.keys(inputModel.props)).join(", ")}.`,
      );
    }
    const characterLimit =
      entry.verb === "tts" && textProp !== undefined && textProp.node.k === "prim"
        ? textProp.node.maxLen
        : undefined;

    const typeBase = pascalCase(id);
    const collision = typeNames.get(typeBase);
    if (collision !== undefined) {
      throw new Error(`Type-name collision: ${quote(id)} and ${quote(collision)} both render as ${typeBase}`);
    }
    typeNames.set(typeBase, id);

    models.push({
      id,
      verb: entry.verb,
      curation: entry,
      pricing: priceRow,
      snapshotFile: `openapi/${snapshotFileName(id)}`,
      docUrl:
        metadataString(falMeta, "documentationUrl") ??
        metadataString(falMeta, "playgroundUrl") ??
        `https://fal.ai/models/${id}`,
      displayName: metadataString(listing, "display_name") ?? id,
      falCategory: metadataString(falMeta, "category") ?? metadataString(listing, "category") ?? "",
      status: retired || listedStatus !== "active" ? "deprecated" : "active",
      updatedAt: metadataString(listing, "updated_at")?.slice(0, 10),
      input: inputModel,
      output: outputModel,
      inputTypeName: `${typeBase}Input`,
      routeAlias,
      outputTypeName: `${typeBase}Output`,
      requiredProbes: inputModel.order.filter((name) => {
        const prop = inputModel.props[name] as Prop;
        return prop.required && !prop.hasDefault;
      }),
      shapes,
      modalities: {
        input: inputModalities(inputModel, entry),
        output: outputModalities(id, entry.verb, outputModel),
      },
      characterLimit,
    });
  }

  // Anti-rot: an overlay for an endpoint or a parameter that no longer exists
  // is a claim about a wire that is gone.
  for (const [id, list] of Object.entries(overlays.endpoints)) {
    const model = models.find((entry) => entry.id === id);
    if (model === undefined) {
      throw new Error(`data/fal/overlays.json names ${quote(id)}, which is not a curated endpoint.`);
    }
    for (const overlay of list) {
      if (overlay.param !== undefined && model.input.props[overlay.param] === undefined) {
        throw new Error(
          `data/fal/overlays.json: ${id} overlay (${overlay.kind}) names parameter ${quote(overlay.param)}, ` +
            "which the endpoint's schema no longer declares. An exception that has outlived what it excepted " +
            "must be deleted, not carried.",
        );
      }
      if (overlay.kind === "media") {
        if (overlay.param === undefined) {
          throw new Error(
            `data/fal/overlays.json: ${id} has a \`media\` overlay with no \`param\` — a media kind is a ` +
              "statement about one parameter, so there is nothing for this one to correct.",
          );
        }
        const prop = model.input.props[overlay.param] as Prop;
        // Stated wins over inferred, in both directions: a `value` sets the
        // kind, and omitting it suppresses a classification `mediaFromName`
        // made in error.
        if (overlay.value === undefined) delete prop.media;
        else prop.media = overlay.value;
      }
    }
  }

  registry.finalize();

  IMAGE_SIZE_COMPONENTS.clear();
  for (const component of registry.ordered()) IMAGE_SIZE_COMPONENTS.set(component.hash, component.model);

  const files = new Map<string, string>();
  const allSources = models.map((model) => model.snapshotFile);
  files.set("endpoints.gen.ts", renderEndpointsFile(models, curation.excluded ?? {}));
  files.set("pricing.gen.ts", renderPricingFile(models));
  files.set("shared.gen.ts", renderSharedFile(registry, allSources));
  for (const verb of VERBS) {
    const slice = models.filter((model) => model.verb === verb);
    if (slice.length === 0) continue;
    // Provider-native artifacts describe fal's wire and therefore use the
    // whole curated slice. `*-params` is the adapter seam: its rows and MODELS
    // list exist only where the canonical vocabulary can represent the call.
    const unifiedSlice = slice.filter((model) => model.curation.unified !== false);
    const slug = verbSlug(verb);
    files.set(`${slug}-wire.gen.ts`, renderWireFile(verb, slice, registry));
    files.set(`${slug}-schema.gen.ts`, renderSchemaFile(verb, slice, registry));
    const checkFile = renderCheckFile(verb, slice);
    if (checkFile !== "") files.set(`${slug}-check.gen.ts`, checkFile);
    files.set(`${slug}-narrow.gen.ts`, renderNarrowFile(verb, slice, registry));
    files.set(`${slug}-params.gen.ts`, renderParamsFile(verb, unifiedSlice));
    files.set(`models-${slug}.gen.ts`, renderModelsFile(verb, slice));
  }
  return new Map(sorted([...files.keys()]).map((name) => [name, files.get(name) as string]));
}

// ---------------------------------------------------------------------------
// Network: the Platform API
// ---------------------------------------------------------------------------

interface ListedModel {
  endpoint_id: string;
  metadata?: Record<string, unknown>;
  openapi?: Record<string, unknown>;
}

function authHeaders(): Record<string, string> {
  // Auth is OPTIONAL on this endpoint. A key is used when the environment
  // offers one (higher rate limits), and the output is byte-identical either
  // way — a refresh must not depend on who ran it.
  const key = process.env["FAL_KEY"];
  return key === undefined || key === "" ? {} : { authorization: `Key ${key}` };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request, retried on the answers that mean "later", not "no".
 *
 * The keyless roster crawl is ~15 pages and fal rate-limits it: an unretried
 * audit dies on a 429 around page eight. `Retry-After` is honoured when fal
 * sends one; otherwise the backoff doubles. 5xx is retried on the same terms —
 * a provider hiccup should cost seconds, not a failed weekly job. A 4xx that
 * is not 429 is a real answer and is never retried.
 */
async function fetchWithRetry(url: URL): Promise<Response> {
  let delayMs = 1_000;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: authHeaders() });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= 5) {
      throw new Error(`GET ${url.pathname}${url.search} failed: ${response.status} ${response.statusText}`);
    }
    const after = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? after * 1_000 : delayMs;
    console.log(`  ${response.status} — retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    delayMs *= 2;
  }
}

async function fetchPages(params: URLSearchParams): Promise<ListedModel[]> {
  const out: ListedModel[] = [];
  let cursor: string | undefined;
  let page = 0;
  do {
    const url = new URL(PLATFORM_API_URL);
    for (const [key, value] of params) url.searchParams.append(key, value);
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    // Paced rather than hammered: the roster crawl is the only caller that
    // walks double-digit pages, and it is the one fal throttles.
    if (page > 0) await sleep(250);
    page += 1;
    const response = await fetchWithRetry(url);
    const body = (await response.json()) as {
      models?: ListedModel[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    out.push(...(body.models ?? []));
    cursor = body.has_more === true && typeof body.next_cursor === "string" ? body.next_cursor : undefined;
  } while (cursor !== undefined);
  return out;
}

/**
 * Fetches the OpenAPI document for each id.
 *
 * Batched at {@link BATCH_SIZE} ids per call AND paginated inside each batch:
 * the API answers an id list in pages of ten regardless of how many ids were
 * asked for, so a naive one-shot request silently drops everything after the
 * tenth — which looks exactly like an endpoint having been retired.
 */
async function fetchSchemas(ids: readonly string[]): Promise<Map<string, ListedModel>> {
  const found = new Map<string, ListedModel>();
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const params = new URLSearchParams();
    for (const id of batch) params.append("endpoint_id", id);
    params.set("expand", "openapi-3.0");
    for (const model of await fetchPages(params)) found.set(model.endpoint_id, model);
  }
  return found;
}

/** The snapshot file body: fal's document plus fal's own listing row. */
function snapshotBody(model: ListedModel): string {
  const body: Record<string, unknown> = { openapi: model.openapi };
  if (model.metadata !== undefined) body["metadata"] = model.metadata;
  return `${JSON.stringify(sortKeysDeep(body), null, 2)}\n`;
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function renderManifest(rows: Array<[string, Record<string, unknown>]>): string {
  const body = {
    $comment: [
      "GENERATED by `bun run codegen:fal:refresh` — DO NOT EDIT.",
      "One row per curated endpoint: where its snapshot lives, what fal's own listing said about it at fetch",
      "time, and the sha256 of the exact snapshot bytes.",
      "The hash is what `bun run codegen:fal:check` compares against on its weekly run: a schema that changed",
      "under a stable id is the failure mode that would otherwise ship as types that quietly stopped matching",
      "the wire. `category` and `status` are fal's, carried here so the audit can diff the roster without",
      "re-downloading every document.",
    ],
    endpoints: Object.fromEntries(rows),
  };
  return `${JSON.stringify(sortKeysDeep(body), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Missing ${path}`);
  return file.json();
}

/** Every committed snapshot, keyed by the endpoint id its file name encodes. */
async function loadSnapshots(): Promise<Record<string, unknown>> {
  const snapshots: Record<string, unknown> = {};
  const { readdir } = await import("node:fs/promises");
  let present: string[] = [];
  try {
    present = await readdir(OPENAPI_DIR);
  } catch {
    present = [];
  }
  for (const name of present.filter((file) => file.endsWith(".json")).sort()) {
    const id = name.slice(0, -".json".length).replace(/__/g, "/");
    snapshots[id] = await Bun.file(`${OPENAPI_DIR}${name}`).json();
  }
  return snapshots;
}

async function refresh(curatedIds: readonly string[]): Promise<void> {
  console.log(`Fetching ${curatedIds.length} endpoint schemas from ${PLATFORM_API_URL} ...`);
  const found = await fetchSchemas(curatedIds);
  const gone = curatedIds.filter((id) => !found.has(id));
  if (gone.length > 0) {
    throw new Error(
      `fal no longer serves: ${gone.join(", ")}. Set \`retiredOn\` on those ids in data/fal/curation.json ` +
        "(the row then ships as deprecated for 90 days), or remove them.",
    );
  }

  const { mkdir, readdir, rm } = await import("node:fs/promises");
  await mkdir(OPENAPI_DIR, { recursive: true });

  const rows: Array<[string, Record<string, unknown>]> = [];
  const wanted = new Set<string>();
  for (const id of [...curatedIds].sort()) {
    const model = found.get(id) as ListedModel;
    if (model.openapi === undefined) {
      throw new Error(`${id}: the Platform API returned no \`openapi\` document (expand=openapi-3.0 ignored?)`);
    }
    const body = snapshotBody(model);
    const name = snapshotFileName(id);
    wanted.add(name);
    await Bun.write(`${OPENAPI_DIR}${name}`, body);
    const listing = model.metadata ?? {};
    rows.push([
      id,
      {
        file: `openapi/${name}`,
        category:
          metadataString((model.openapi["info"] as Record<string, unknown> | undefined)?.["x-fal-metadata"], "category") ??
          metadataString(listing, "category") ??
          "",
        display_name: metadataString(listing, "display_name") ?? id,
        status: metadataString(listing, "status") ?? "unknown",
        updated_at: metadataString(listing, "updated_at") ?? "",
        sha256: sha256(body),
      },
    ]);
  }

  for (const name of await readdir(OPENAPI_DIR)) {
    if (name.endsWith(".json") && !wanted.has(name)) {
      await rm(`${OPENAPI_DIR}${name}`);
      console.log(`Removed stale snapshot ${name}`);
    }
  }
  await Bun.write(MANIFEST_PATH, renderManifest(rows));
  console.log(`Wrote ${rows.length} snapshots and data/fal/manifest.json`);
}

/**
 * Re-fetches every curated endpoint and compares it with what is committed.
 *
 * Scheduled, never per-commit: it needs the network, and a provider outage
 * must not be able to fail an unrelated pull request. `fal-ai/veo3` and
 * `fal-ai/whisper` both disappeared from fal DURING the week this integration
 * was designed, which is why this exists at all.
 */
async function check(curatedIds: readonly string[]): Promise<void> {
  const manifest = (await readJson(MANIFEST_PATH)) as {
    endpoints: Record<string, { sha256?: string; status?: string }>;
  };
  const found = await fetchSchemas(curatedIds);
  const problems: string[] = [];
  for (const id of [...curatedIds].sort()) {
    const model = found.get(id);
    if (model === undefined) {
      problems.push(`${id}: GONE from fal (404) — set \`retiredOn\` in data/fal/curation.json`);
      continue;
    }
    const status = metadataString(model.metadata ?? {}, "status") ?? "unknown";
    if (status !== "active") problems.push(`${id}: status is now ${quote(status)}`);
    const committed = manifest.endpoints[id]?.sha256;
    const current = sha256(snapshotBody(model));
    if (committed !== current) {
      problems.push(`${id}: schema changed (${committed?.slice(0, 12)} → ${current.slice(0, 12)})`);
    }
  }
  if (problems.length > 0) {
    console.error(`fal snapshot drift (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("\nRun `bun run codegen:fal:refresh` and review the diff.");
    process.exitCode = 1;
    return;
  }
  console.log(`All ${curatedIds.length} curated fal endpoints match their committed snapshots.`);
}

/**
 * Crawls fal's whole listing and reports roster drift. Never writes.
 *
 * Deliberately WITHOUT `expand`: the point is the roster, not the schemas, and
 * ~1,500 documents is a download nobody wants on a weekly job.
 */
async function audit(curation: z.output<typeof curationSchema>): Promise<void> {
  const manifest = (await readJson(MANIFEST_PATH).catch(() => ({ endpoints: {} }))) as {
    endpoints: Record<string, { category?: string; status?: string }>;
  };
  console.log(`Crawling ${PLATFORM_API_URL} (no expand) ...`);
  const listed = await fetchPages(new URLSearchParams());
  const byId = new Map(listed.map((model) => [model.endpoint_id, model]));
  console.log(`fal serves ${listed.length} endpoints.`);

  const curatedIds = sorted(Object.keys(curation.endpoints));
  const curatedCategories = new Set<string>();
  for (const id of curatedIds) {
    const category = metadataString(byId.get(id)?.metadata ?? {}, "category");
    if (category !== undefined) curatedCategories.add(category);
  }

  const gone = curatedIds.filter((id) => !byId.has(id));
  const flipped = curatedIds
    .filter((id) => byId.has(id))
    .map((id) => ({
      id,
      was: manifest.endpoints[id]?.status ?? "unknown",
      now: metadataString(byId.get(id)?.metadata ?? {}, "status") ?? "unknown",
    }))
    .filter((row) => row.was !== row.now);
  const excluded = new Set(Object.keys(curation.excluded?.endpoints ?? {}));
  const fresh = sorted(
    listed
      .filter((model) => !curatedIds.includes(model.endpoint_id) && !excluded.has(model.endpoint_id))
      .filter((model) => curatedCategories.has(metadataString(model.metadata ?? {}, "category") ?? ""))
      .filter((model) => (metadataString(model.metadata ?? {}, "status") ?? "") === "active")
      .map((model) => model.endpoint_id),
  );

  console.log(`\nCurated but GONE (${gone.length}):`);
  for (const id of gone) console.log(`  ${id}`);
  console.log(`\nStatus flips since the last refresh (${flipped.length}):`);
  for (const row of flipped) console.log(`  ${row.id}: ${row.was} → ${row.now}`);
  console.log(`\nActive and uncurated, in categories we already serve (${fresh.length}):`);
  for (const id of fresh) console.log(`  ${id}`);
  console.log("\nReport only — nothing was written.");
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--refresh")
    ? "refresh"
    : process.argv.includes("--check")
      ? "check"
      : process.argv.includes("--audit")
        ? "audit"
        : "generate";

  const curationJson = await readJson(CURATION_PATH);
  const curation = curationSchema.parse(curationJson);
  const curatedIds = sorted(Object.keys(curation.endpoints));

  if (mode === "audit") return audit(curation);
  if (mode === "check") return check(curatedIds);
  if (mode === "refresh") await refresh(curatedIds);

  const files = generate({
    snapshots: await loadSnapshots(),
    curation: curationJson,
    pricing: await readJson(PRICING_PATH),
    overlays: await readJson(OVERLAYS_PATH),
    today: new Date().toISOString().slice(0, 10),
  });

  const { mkdir, readdir, rm } = await import("node:fs/promises");
  await mkdir(GEN_DIR, { recursive: true });

  // Stale sweep, scoped to `src/providers/fal/gen/` and nothing else — it is
  // disjoint from scripts/codegen.ts's sweep over `src/catalog/`, and it must
  // stay that way: two generators sweeping one directory would take turns
  // deleting each other's output.
  for (const existing of await readdir(GEN_DIR)) {
    if (existing.endsWith(".gen.ts") && !files.has(existing)) {
      await rm(`${GEN_DIR}${existing}`);
      console.log(`Removed stale ${existing}`);
    }
  }
  for (const [name, content] of files) await Bun.write(`${GEN_DIR}${name}`, content);
  console.log(`Generated ${files.size} files into src/providers/fal/gen/`);
}

if (import.meta.main) {
  await main();
}
