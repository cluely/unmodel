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
 *     are both "image-to-image").
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
 * The nine unmodel verbs fal serves. Sorted, and the sort IS the emission
 * order — `image` before `imageEdit` is plain string order, not a special case.
 */
const VERBS = [
  "avatar",
  "image",
  "imageEdit",
  "lipsync",
  "music",
  "stt",
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
  tts: "audio",
  video: "video",
};

// ---------------------------------------------------------------------------
// Hand inputs. Loose everywhere a future field might land; strict on the
// fields that decide what gets emitted.
// ---------------------------------------------------------------------------

const curationEntrySchema = z.looseObject({
  verb: z.enum(VERBS),
  textParam: z.string().optional(),
  allowsModelProperty: z.boolean().optional(),
  note: z.string().optional(),
  retiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const curationSchema = z.looseObject({
  endpoints: z.record(z.string(), curationEntrySchema),
  excluded: z.unknown().optional(),
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

function classifyShapes(
  endpointId: string,
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

  const resolution = props["resolution"];
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

function renderEndpointsFile(models: readonly EndpointModel[]): string {
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
};

/** fal's `resolution` vocabulary onto the canonical tiers. `0.5K` has none. */
function canonicalTier(value: string): string | undefined {
  const match = /^([0-9.]+)k$/i.exec(value.trim());
  if (match === null) return undefined;
  const scale = Number(match[1]);
  return scale === 1 ? "1k" : scale === 2 ? "2k" : scale === 4 ? "4k" : undefined;
}

/** Canonical `W:H` spellings, from an enum that may hold other things too. */
function canonicalRatios(values: readonly (string | number)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && /^\d+:\d+$/.test(value));
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
  /** wire param name → the endpoint whose interface types it. */
  extras: readonly string[];
}

function unifiedRow(verb: Verb, model: EndpointModel): UnifiedRow {
  const props = model.input.props;
  const canonical = new Set(CANONICAL_WIRE_PARAMS[verb] ?? []);
  const row: UnifiedRow = {
    classes: model.shapes,
    keys: model.input.order,
    extras: model.input.order.filter((name) => !canonical.has(name)),
  };

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
    `How each \`fal.${verb}\` endpoint lets a caller state geometry, and which wire keys it takes.`,
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
    `Every \`fal.${verb}\` endpoint id, in the order the table above keys them.`,
    "",
    "Here as well as in `endpoints.gen.ts` so the import-free `*-params` leaf can publish a model list without",
    "reaching for a second generated module — the leaf rule (A10b in test/import-graph.test.ts) allows it",
    "exactly one, and this is it. Same ids, same order, one generator.",
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

    const shapes = classifyShapes(id, inputModel, registry);
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
  files.set("endpoints.gen.ts", renderEndpointsFile(models));
  files.set("pricing.gen.ts", renderPricingFile(models));
  files.set("shared.gen.ts", renderSharedFile(registry, allSources));
  for (const verb of VERBS) {
    const slice = models.filter((model) => model.verb === verb);
    if (slice.length === 0) continue;
    const slug = verbSlug(verb);
    files.set(`${slug}-wire.gen.ts`, renderWireFile(verb, slice, registry));
    files.set(`${slug}-schema.gen.ts`, renderSchemaFile(verb, slice, registry));
    files.set(`${slug}-narrow.gen.ts`, renderNarrowFile(verb, slice, registry));
    files.set(`${slug}-params.gen.ts`, renderParamsFile(verb, slice));
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
  const excluded = new Set(Object.keys((curation.excluded as { endpoints?: object })?.endpoints ?? {}));
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
