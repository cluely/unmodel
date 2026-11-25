/**
 * Generates the Higgsfield route surface from Higgsfield's own published
 * per-route documents, plus three hand-maintained inputs for what those
 * documents cannot say.
 *
 *   bun scripts/codegen-higgsfield.ts             lower the committed data/higgsfield/ inputs and report (no writes)
 *   bun scripts/codegen-higgsfield.ts --refresh   re-fetch the documented sources into data/higgsfield/, then lower
 *   bun scripts/codegen-higgsfield.ts --check     re-fetch and compare against the committed snapshot (network; no writes)
 *
 * ## Why Higgsfield gets a generator
 *
 * Higgsfield is one URL template — `POST https://api.higgsfield.ai/{endpoint}`
 * — in front of more than a hundred routes: its own models (Soul, Genjutsu,
 * Cinema Studio, Marketing Studio) and hosted ones (Seedance, Kling, Wan,
 * MiniMax, LTX, Recraft, …). Every route publishes its own JSON Schema, and the
 * roster moves weekly. unmodel serves every route, so the per-route bodies are
 * data, and hand-transcribing them would be a rolling liability.
 *
 * ## The thesis, the same one `scripts/codegen-fal.ts` states
 *
 * **The generator emits DATA and TYPES-AS-DATA; hand code owns BEHAVIOUR.**
 * `generate()` returns the id lists, one wire interface per route, one shape
 * gate per output type, the per-route shape rows a check battery reads, the
 * catalog rows and the rates. It emits no check, no message and no validator.
 *
 * Routes are grouped by what they answer — `image` or `video` — and by nothing
 * finer: the route is one URL template with a variable path, and the path's
 * tail is not a rule (`alibaba/happy-horse/text-to-video` is filed
 * `image2video` by the vendor). The picture-editing routes are a VIEW over the
 * image group, listed by id, with no tables of their own.
 *
 * ## The three sources, all documented and keyless
 *
 *   • **console** — `https://dash.higgsfield.ai/models/<id>/llms.txt`, the
 *     per-route console document every model page links ("Follow its
 *     model-specific `llms.txt` link when available",
 *     https://docs.higgsfield.ai/docs/llms.txt). It carries the route's
 *     "Input JSON Schema" and its "## Pricing" paragraph.
 *   • **page** — the data `https://open.higgsfield.ai/models/<id>/api-reference`
 *     server-renders into its own HTML. It is how routes are ENUMERATED (the
 *     `/explore` listings seed the walk, each page names its family and related
 *     routes) and it carries what the console document does not: the output
 *     type, the operation type, the release date and the page's own price
 *     sentence ("Images cost $0.0938 each at 720p and $0.1875 each at 1080p.").
 *   • **docs** — `https://docs.higgsfield.ai/docs/models/<family>/<workflow>.md`,
 *     indexed by `https://docs.higgsfield.ai/docs/llms.txt`. Each page has a
 *     "Complete JSON schema" block and "## Usage notes".
 *
 * The console's JSON API (`dash.higgsfield.ai/api/v2/…`, which the pages
 * themselves call) is deliberately NOT a source: it is undocumented, and
 * `https://open.higgsfield.ai/robots.txt` disallows `/api/`. Everything read
 * here is a document a person is pointed at.
 *
 * `https://docs.higgsfield.ai/docs/openapi.json` is snapshotted for drift
 * detection only and never lowered: its own index calls it "supplementary
 * reference, not the authoritative model catalog".
 *
 * ## Two schemas for one route
 *
 * Most routes are published twice, by the console and by the docs, and the two
 * disagree on a handful of pointers. There is no default winner. Where the
 * schemas are equal once annotations are dropped, the docs schema is used;
 * where they differ, EVERY differing JSON pointer needs a `prefer` entry in
 * `data/higgsfield/overlays.json`, or the run stops naming both values.
 *
 * ## The three hand inputs
 *
 *   • `curation.json` — aliases, the one hand-written route, view exclusions
 *     and the routes unmodel does not serve.
 *   • `overlays.json` — every deviation from a published schema.
 *   • `pricing.json` — one row per generation route: a rate read from a
 *     sentence, or the reason no rate can be stated. Two guards make the
 *     transcription mechanical to check: the quote must still be in the
 *     snapshot, and every number must be in its own quote.
 *
 * ## Determinism and loud failure
 *
 * Output is a pure function of the committed inputs: no clock, no network,
 * everything sorted, shared enum lists named by content hash. Every construct
 * this script does not model — a schema keyword, a `format`, a conditional
 * outside the patterns below, an output or operation type, a media-looking
 * property nobody filed — is a HARD ERROR naming the route and the JSON
 * pointer. So is a stale overlay or curation id: an exception that has stopped
 * being one must be deleted.
 *
 * ## Where the row types live
 *
 * This script imports nothing from `src/`: it has to run against a tree whose
 * provider directory is absent or broken. So the row shapes are declared
 * twice — privately here (`Rule`, `RateRow`, the shared `Node`), and as the
 * public `HiggsfieldEndpointShape` and `HiggsfieldRate` that the emitted files
 * name in their `satisfies` clauses (`../shape-types`, `../pricing-types`). The
 * public declarations are canonical, and `tsc` over the emitted files is what
 * holds the two together.
 */

import { z } from "zod";
import {
  canonical,
  hash6,
  irType,
  jsdocText,
  literal,
  mergeType,
  propKey,
  renderDoc,
  snapshotFileName,
  sorted,
  tsType,
  zodExpr,
  type Node,
  type Prop,
} from "./codegen-fal";
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

const PAGE_BASE_URL = "https://open.higgsfield.ai";
const CONSOLE_BASE_URL = "https://dash.higgsfield.ai";
const DOCS_BASE_URL = "https://docs.higgsfield.ai/docs";

/** The listings that seed the route walk. Each is server-rendered with its first page of families. */
const EXPLORE_PATHS = ["/explore", "/explore/image", "/explore/video"] as const;
/** Named by `https://open.higgsfield.ai/robots.txt`. One `/models/<id>/playground` entry per family or preset. */
const SITEMAP_URL = `${PAGE_BASE_URL}/sitemap.xml`;
const DOCS_INDEX_URL = `${DOCS_BASE_URL}/llms.txt`;
/** The two category indexes; which one links a family is a docs-only route's verb. */
const DOCS_CATEGORY_PAGES = { image: "image-generation", video: "video-generation" } as const;
const OPENAPI_URL = `${DOCS_BASE_URL}/openapi.json`;

const DATA_DIR = new URL("../data/higgsfield/", import.meta.url).pathname;
const ROUTES_DIR = `${DATA_DIR}routes/`;
const MANIFEST_PATH = `${DATA_DIR}manifest.json`;
const OPENAPI_PATH = `${DATA_DIR}openapi.json`;
const CURATION_PATH = `${DATA_DIR}curation.json`;
const OVERLAYS_PATH = `${DATA_DIR}overlays.json`;
const PRICING_PATH = `${DATA_DIR}pricing.json`;

function consoleUrl(id: string): string {
  return `${CONSOLE_BASE_URL}/models/${id}/llms.txt`;
}

function pageUrl(id: string): string {
  return `${PAGE_BASE_URL}/models/${id}/api-reference`;
}

// ---------------------------------------------------------------------------
// The snapshot, parsed strictly
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

const jsonSchemaSchema = z.record(z.string(), z.unknown());

/** What the console document says when it has no price. The page data's `pricing_description` is `null` there. */
export const CONSOLE_NO_PRICING = "Public pricing information is not available for this model.";

const consoleSourceSchema = z.strictObject({
  url: z.string().min(1),
  /** The document's H1. */
  title: z.string().min(1),
  /** "Category" under "## Overview": the vendor's operation type for the route. */
  category: z.string().min(1),
  input_schema: jsonSchemaSchema,
  /** The "## Pricing" paragraph, verbatim. */
  pricing: z.string().min(1),
});

const pageSourceSchema = z.strictObject({
  url: z.string().min(1),
  title: z.string().min(1),
  variant_title: z.string().nullable(),
  description: z.string(),
  company: z.string().min(1),
  output_type: z.string().min(1),
  operation_type: z.string().min(1),
  input_types: z.array(z.string().min(1)),
  availability_state: z.string().min(1),
  released_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** The page's own price sentence, shown beside its related models. */
  related_models_description: z.string().nullable(),
});

const docsSourceSchema = z.strictObject({
  url: z.string().min(1),
  /** Which category index links the page's family. */
  category: z.enum(["image", "video"]),
  /** The page's H1, without its " API" suffix. */
  title: z.string().min(1),
  method: z.literal("POST"),
  /** "**Catalog ID:**", where the page states that the console files the route under another slug. */
  catalog_id: z.string().min(1).nullable(),
  schema: jsonSchemaSchema,
  usage_notes: z.array(z.string().min(1)),
});

const routeSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  console: consoleSourceSchema.nullable(),
  page: pageSourceSchema.nullable(),
  docs: docsSourceSchema.nullable(),
});

type RouteSnapshot = z.output<typeof routeSnapshotSchema>;

// ---------------------------------------------------------------------------
// The hand inputs
// ---------------------------------------------------------------------------

const provenance = {
  reason: z.string().min(1),
  source: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};
const provenanceSchema = z.strictObject(provenance);

const curationSchema = z.strictObject({
  $comment: z.array(z.string()).optional(),
  handWritten: z.record(z.string(), provenanceSchema),
  views: z.strictObject({
    imageEdit: z.strictObject({ exclude: z.record(z.string(), provenanceSchema) }),
  }),
  excluded: z.strictObject({ routes: z.record(z.string(), provenanceSchema) }),
});

const SOFT_BOUND_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "maxLength"] as const;

const overlaySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("prefer"),
    route: z.string().min(1),
    pointer: z.string().startsWith("/"),
    prefer: z.enum(["console", "docs"]),
    ...provenance,
  }),
  z.strictObject({
    kind: z.literal("nullable"),
    route: z.string().min(1),
    param: z.string().min(1),
    warn: z.literal(true).optional(),
    ...provenance,
  }),
  z.strictObject({
    kind: z.literal("softBound"),
    route: z.string().min(1),
    param: z.string().min(1),
    keyword: z.enum(SOFT_BOUND_KEYWORDS),
    value: z.number(),
    ...provenance,
  }),
  z.strictObject({
    kind: z.literal("ignoreKeyword"),
    route: z.string().min(1),
    pointer: z.string().startsWith("/"),
    ...provenance,
  }),
  z.strictObject({
    kind: z.literal("tokens"),
    route: z.string().min(1),
    prompt: z.string().min(1),
    arrays: z.record(z.string(), z.string().min(1)),
    ...provenance,
  }),
]);

const overlaysSchema = z.strictObject({
  $comment: z.array(z.string()).optional(),
  overlays: z.array(overlaySchema),
});

type Overlay = z.output<typeof overlaySchema>;

const rateTableSchema = z.union([z.number().positive(), z.record(z.string(), z.number().positive())]);

const undefinedWhenSchema = z.strictObject({
  param: z.string().min(1),
  /** The values that select the arm… */
  in: z.array(z.union([z.string(), z.boolean()])).min(1).optional(),
  /** …or the array length from which it applies. Exactly one of the two. */
  minItems: z.number().int().positive().optional(),
  changes: z.enum(["rate", "unit"]),
  reason: z.string().min(1),
});

const rateRowSchema = z.strictObject({
  unit: z.enum(["per_image", "per_second"]),
  usd: rateTableSchema,
  by: z.string().min(1).optional(),
  byUnpublished: z.string().min(1).optional(),
  usdWithVideoInput: rateTableSchema.optional(),
  videoInputs: z.array(z.string().min(1)).min(1).optional(),
  seconds: z.enum(["request", "source", "output", "formula"]).optional(),
  sourceParam: z.string().min(1).optional(),
  rounding: z.enum(["up", "nearest"]).optional(),
  maxSeconds: z.number().positive().optional(),
  maxSecondsQuote: z.string().min(1).optional(),
  count: z.string().min(1).optional(),
  countQuote: z.string().min(1).optional(),
  multipliedBy: z.string().min(1).optional(),
  catalog: z.string().min(1).optional(),
  undefinedWhen: z.array(undefinedWhenSchema).min(1).optional(),
  /** The date the owner ruled that this rate is catalogued at a route whose console document says no price is public. */
  decided: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().min(1),
  verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quote: z.string().min(1),
});

const unpricedRowSchema = z.strictObject({
  unpriced: z.string().min(1),
  source: z.string().min(1),
  verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Absent only where no surface prints a sentence about price at all. */
  quote: z.string().min(1).optional(),
});

const pricingSchema = z.strictObject({
  $comment: z.array(z.string()).optional(),
  endpoints: z.record(z.string(), z.union([rateRowSchema, unpricedRowSchema])),
});

type RateRow = z.output<typeof rateRowSchema>;
type PricingRow = RateRow | z.output<typeof unpricedRowSchema>;

export interface GenerateInput {
  /** route id → the committed snapshot's parsed JSON. */
  routes: Record<string, unknown>;
  curation: unknown;
  overlays: unknown;
  pricing: unknown;
}

// ---------------------------------------------------------------------------
// Two schemas for one route
// ---------------------------------------------------------------------------

/** Keys that describe a schema without constraining a request. */
const ANNOTATION_KEYS: ReadonlySet<string> = new Set(["title", "description", "default", "examples", "$schema"]);
/** `format` values that restate the JSON type and constrain nothing further. */
const ANNOTATION_FORMATS: ReadonlySet<string> = new Set(["float", "double"]);
/** Keys whose arrays are sets: two orders of the same members are one schema. */
const SET_VALUED_KEYS: ReadonlySet<string> = new Set(["required", "enum"]);

/**
 * A schema with everything that cannot change validation removed, so two
 * publications of one contract compare equal: annotations dropped, `type: [T,
 * "null"]` written the way `anyOf: [T, null]` is, and set-valued arrays sorted.
 *
 * `properties` and `$defs` are maps from a NAME to a schema, so their keys are
 * never mistaken for keywords: a property called `title` is kept.
 */
export function comparable(schema: unknown, inNameMap = false): unknown {
  if (Array.isArray(schema)) return schema.map((item) => comparable(item));
  if (typeof schema !== "object" || schema === null) return schema;
  const source = schema as Schema;
  const out: Schema = {};
  for (const key of Object.keys(source).sort()) {
    const value = source[key];
    if (inNameMap) {
      out[key] = comparable(value);
      continue;
    }
    if (ANNOTATION_KEYS.has(key)) continue;
    if (key === "format" && typeof value === "string" && ANNOTATION_FORMATS.has(value)) continue;
    if (SET_VALUED_KEYS.has(key) && Array.isArray(value)) {
      out[key] = [...value].sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1));
      continue;
    }
    out[key] = comparable(value, key === "properties" || key === "$defs");
  }
  const type = out["type"];
  if (Array.isArray(type) && type.length === 2 && type.includes("null")) {
    const { type: _dropped, ...rest } = out;
    return { anyOf: [{ ...rest, type: type.find((member) => member !== "null") }, { type: "null" }] };
  }
  return out;
}

/** Every JSON pointer at which two comparable schemas differ. Arrays differ as wholes. */
export function differingPointers(a: unknown, b: unknown, pointer = ""): string[] {
  if (isMap(a) && isMap(b)) {
    return sorted(new Set([...Object.keys(a), ...Object.keys(b)])).flatMap((key) => {
      const at = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!(key in a) || !(key in b)) return [at];
      return differingPointers(a[key], b[key], at);
    });
  }
  return canonical(a) === canonical(b) ? [] : [pointer];
}

function isMap(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The value at a JSON pointer, or `undefined` when the path does not exist. */
function valueAt(root: unknown, pointer: string): unknown {
  let current = root;
  for (const segment of pointerSegments(pointer)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Schema)[segment];
  }
  return current;
}

/** Whether a JSON pointer names something the schema itself spells: every segment is an own key. */
function existsAt(root: unknown, pointer: string): boolean {
  let current = root;
  for (const segment of pointerSegments(pointer)) {
    if (typeof current !== "object" || current === null || !(segment in current)) return false;
    current = (current as Schema)[segment];
  }
  return true;
}

/** Writes (or, for `undefined`, deletes) the value at a pointer whose parent exists. */
function writeAt(root: Schema, pointer: string, value: unknown): void {
  const segments = pointerSegments(pointer);
  const last = segments.pop() as string;
  let parent: Schema = root;
  for (const segment of segments) parent = parent[segment] as Schema;
  if (value === undefined) delete parent[last];
  else parent[last] = structuredClone(value);
}

function covers(overlayPointer: string, pointer: string): boolean {
  return pointer === overlayPointer || pointer.startsWith(`${overlayPointer}/`);
}

interface Resolved {
  schema: Schema;
  /** Every published schema of the route, for the "do the sources agree" questions. */
  sources: readonly Schema[];
}

/** Tracks which overlays a run consumed, so one that matched nothing can be reported as stale. */
class OverlayBook {
  private readonly used = new Set<Overlay>();

  constructor(private readonly overlays: readonly Overlay[]) {}

  of<K extends Overlay["kind"]>(route: string, kind: K): Array<Extract<Overlay, { kind: K }>> {
    return this.overlays.filter((overlay): overlay is Extract<Overlay, { kind: K }> => overlay.route === route && overlay.kind === kind);
  }

  use(overlay: Overlay): void {
    this.used.add(overlay);
  }

  assertAllUsed(knownRoutes: ReadonlySet<string>): void {
    for (const overlay of this.overlays) {
      if (!knownRoutes.has(overlay.route)) {
        throw new Error(`overlays.json: \`${overlay.kind}\` names ${overlay.route}, which is not a generated route. Delete the entry.`);
      }
      if (!this.used.has(overlay)) {
        const at = "pointer" in overlay ? overlay.pointer : "param" in overlay ? overlay.param : overlay.prompt;
        throw new Error(
          `overlays.json: the \`${overlay.kind}\` entry for ${overlay.route} at ${at} no longer applies to the published schemas. ` +
            "An exception that has stopped being one must be deleted.",
        );
      }
    }
  }
}

/**
 * The one schema a route is lowered from.
 *
 * One source → that schema. Two that compare equal → the docs schema. Two that
 * differ → the docs schema with every `prefer: "console"` pointer taken from
 * the console, and a hard stop on any differing pointer no entry covers.
 */
function resolveSchema(route: RouteSnapshot, book: OverlayBook): Resolved {
  const docs = route.docs?.schema;
  const consoleSchema = route.console?.input_schema;
  if (docs === undefined || consoleSchema === undefined) {
    const only = docs ?? consoleSchema;
    if (only === undefined) {
      throw new Error(
        `${route.id}: no documented source publishes an input schema for this route. ` +
          "File it under `excluded.routes` in data/higgsfield/curation.json with the reason.",
      );
    }
    return { schema: structuredClone(only), sources: [only] };
  }

  const differing = differingPointers(comparable(docs), comparable(consoleSchema));
  const preferences = book.of(route.id, "prefer");
  const schema = structuredClone(docs);
  for (const pointer of differing) {
    const preference = preferences.find((entry) => covers(entry.pointer, pointer));
    if (preference === undefined) {
      throw new Error(
        `${route.id}: the docs and console schemas differ at ${pointer} — docs: ${literal(valueAt(comparable(docs), pointer))}, ` +
          `console: ${literal(valueAt(comparable(consoleSchema), pointer))}. Add a \`prefer\` entry for that pointer to ` +
          "data/higgsfield/overlays.json saying which source stands, and why.",
      );
    }
    book.use(preference);
  }
  for (const preference of preferences) {
    if (!differing.some((pointer) => covers(preference.pointer, pointer))) continue;
    if (preference.prefer === "console") takeFromConsole(route.id, schema, consoleSchema, preference.pointer);
  }
  return { schema, sources: [docs, consoleSchema] };
}

/**
 * Copies the console's value at `pointer` over the docs schema, or removes it
 * where the console has none.
 *
 * The pointers were found on the `comparable()` forms, and the copy is between
 * the schemas as published. A pointer only the comparable form has (one under
 * the `anyOf` a `type: [T, "null"]` is compared as) names nothing in the
 * published schema: reading it would find no value, and the copy would then
 * remove the docs' field as though the console did not accept it.
 *
 * Past that check the pointer's parent is in both published schemas: a parent
 * only one of them has is itself the differing pointer, which no entry below
 * it covers, and arrays differ as wholes.
 */
function takeFromConsole(route: string, schema: Schema, consoleSchema: Schema, pointer: string): void {
  for (const [name, published] of [
    ["docs", schema],
    ["console", consoleSchema],
  ] as const) {
    if (existsAt(comparable(published), pointer) && !existsAt(published, pointer)) {
      throw new Error(
        `${route}: the \`prefer\` entry at ${pointer} names a pointer the ${name} schema has only once it is normalised for comparison ` +
          '(a `type: [T, "null"]` is compared as an `anyOf`). Point the entry at the enclosing property instead.',
      );
    }
  }
  writeAt(schema, pointer, valueAt(consoleSchema, pointer));
}

// ---------------------------------------------------------------------------
// Lowering: JSON Schema → the shared IR
// ---------------------------------------------------------------------------

interface LowerCtx {
  route: string;
  root: Schema;
  ignored: ReadonlySet<string>;
  /** `$ref` targets being expanded, to stop on a cycle. */
  expanding: string[];
}

function fail(ctx: { route: string }, pointer: string, message: string): never {
  throw new Error(`${ctx.route}: ${message} (at ${pointer === "" ? "/" : pointer})`);
}

const VALUE_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "multipleOf",
  "format",
  "items",
  "minItems",
  "maxItems",
  "properties",
  "required",
  "additionalProperties",
  "maxProperties",
  "anyOf",
  "$ref",
]);

function assertKnownKeywords(schema: Schema, pointer: string, ctx: LowerCtx, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(schema)) {
    if (allowed.has(key) || ANNOTATION_KEYS.has(key) || ctx.ignored.has(`${pointer}/${key}`)) continue;
    fail(
      ctx,
      `${pointer}/${key}`,
      `the schema keyword \`${key}\` is not modelled. Teach scripts/codegen-higgsfield.ts what it means, or, if it is not a ` +
        "JSON Schema keyword at all, record it as an `ignoreKeyword` overlay",
    );
  }
}

/** A primitive's numeric keywords, as the IR field each one is lowered to. */
const NUMERIC_KEYWORDS = [
  ["min", "minimum"],
  ["max", "maximum"],
  ["xmin", "exclusiveMinimum"],
  ["xmax", "exclusiveMaximum"],
  ["minLen", "minLength"],
  ["maxLen", "maxLength"],
  ["step", "multipleOf"],
] as const;

function numberAt(schema: Schema, key: string, pointer: string, ctx: LowerCtx): number | undefined {
  const value = schema[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number") fail(ctx, `${pointer}/${key}`, `\`${key}\` is ${literal(value)}, not a number`);
  return value;
}

interface Lowered {
  node: Node;
  nullable: boolean;
}

function lowerNode(schema: Schema, pointer: string, ctx: LowerCtx): Lowered {
  assertKnownKeywords(schema, pointer, ctx, VALUE_KEYWORDS);

  if (typeof schema["$ref"] === "string") {
    const ref = schema["$ref"];
    const name = /^#\/\$defs\/([^/]+)$/.exec(ref)?.[1];
    const target = name === undefined ? undefined : (ctx.root["$defs"] as Schema | undefined)?.[name];
    if (typeof target !== "object" || target === null) fail(ctx, pointer, `\`$ref\` ${ref} does not resolve inside the schema's own \`$defs\``);
    if (ctx.expanding.includes(ref)) fail(ctx, pointer, `\`$ref\` ${ref} is recursive`);
    ctx.expanding.push(ref);
    const lowered = lowerNode(target as Schema, `/$defs/${name}`, ctx);
    ctx.expanding.pop();
    return lowered;
  }

  if (schema["anyOf"] !== undefined) {
    const arms = schema["anyOf"] as Schema[];
    const nullArms = Array.isArray(arms) ? arms.filter((arm) => arm["type"] === "null") : [];
    if (!Array.isArray(arms) || arms.length !== 2 || nullArms.length !== 1) {
      fail(ctx, `${pointer}/anyOf`, "`anyOf` is modelled only as `[T, null]` below the top level");
    }
    const inner = arms.findIndex((arm) => arm["type"] !== "null");
    return { node: lowerNode(arms[inner] as Schema, `${pointer}/anyOf/${inner}`, ctx).node, nullable: true };
  }

  let type = schema["type"];
  let nullable = false;
  if (Array.isArray(type)) {
    if (type.length !== 2 || !type.includes("null")) fail(ctx, `${pointer}/type`, `the type list ${literal(type)} is not \`[T, "null"]\``);
    nullable = true;
    type = type.find((member) => member !== "null");
  }
  const listed = schema["const"] !== undefined ? [schema["const"]] : (schema["enum"] as unknown[] | undefined);
  if (type === undefined && listed !== undefined) {
    // A bare `enum` types itself: every member has to be the same primitive.
    const kinds = new Set(listed.map((member) => typeof member));
    if (kinds.size === 1) type = [...kinds][0];
  }

  switch (type) {
    case "string":
    case "integer":
    case "number":
    case "boolean": {
      const node: Extract<Node, { k: "prim" }> = { k: "prim", t: type };
      if (listed !== undefined) {
        if (type === "boolean") {
          if (listed.length !== 1 || typeof listed[0] !== "boolean") fail(ctx, pointer, `the boolean vocabulary ${literal(listed)} is not one \`const\``);
          node.const = listed[0];
        } else {
          const expected = type === "string" ? "string" : "number";
          if (!listed.every((member) => typeof member === expected)) fail(ctx, pointer, `the ${type} vocabulary ${literal(listed)} has a member of another type`);
          node.enum = listed as Array<string | number>;
        }
      }
      const format = schema["format"];
      if (format === "uri" || format === "uuid") node.format = format;
      else if (format !== undefined && !(typeof format === "string" && ANNOTATION_FORMATS.has(format))) {
        fail(ctx, `${pointer}/format`, `the format ${literal(format)} is not modelled`);
      }
      const pattern = schema["pattern"];
      if (pattern !== undefined) {
        if (typeof pattern !== "string") fail(ctx, `${pointer}/pattern`, "`pattern` is not a string");
        try {
          // The check battery compiles this at run time, where a pattern in
          // another regex dialect would throw instead of reporting.
          new RegExp(pattern, "u");
        } catch {
          fail(ctx, `${pointer}/pattern`, `the pattern ${literal(pattern)} does not compile as a JavaScript regular expression`);
        }
        node.pattern = pattern;
      }
      for (const [field, key] of NUMERIC_KEYWORDS) {
        const value = numberAt(schema, key, pointer, ctx);
        if (value !== undefined) node[field] = value;
      }
      return { node, nullable };
    }
    case "array": {
      const items = schema["items"];
      const lowered =
        typeof items === "object" && items !== null ? lowerNode(items as Schema, `${pointer}/items`, ctx) : { node: { k: "unknown" } as Node, nullable: false };
      const node: Extract<Node, { k: "array" }> = {
        k: "array",
        items: lowered.nullable ? { k: "nullable", inner: lowered.node } : lowered.node,
      };
      const minItems = numberAt(schema, "minItems", pointer, ctx);
      const maxItems = numberAt(schema, "maxItems", pointer, ctx);
      if (minItems !== undefined) node.minItems = minItems;
      if (maxItems !== undefined) node.maxItems = maxItems;
      return { node, nullable };
    }
    case "object":
      return { node: lowerObjectNode(schema, pointer, ctx), nullable };
    default:
      return fail(ctx, pointer, `the type ${literal(schema["type"])} is not modelled`);
  }
}

function lowerProps(schema: Schema, pointer: string, ctx: LowerCtx): { props: Record<string, Prop>; order: string[] } {
  const properties = (schema["properties"] ?? {}) as Record<string, Schema>;
  const required = new Set((schema["required"] ?? []) as string[]);
  // Alphabetical, not "as published": both sources print properties shortest
  // key first, which is a storage order and not an authored one, and the
  // committed snapshot sorts keys so that a refresh diffs on content.
  const order = Object.keys(properties).sort();
  for (const name of required) {
    if (!(name in properties)) fail(ctx, `${pointer}/required`, `\`required\` names ${name}, which \`properties\` does not declare`);
  }
  const props: Record<string, Prop> = {};
  for (const name of order) {
    const raw = properties[name] as Schema;
    const lowered = lowerNode(raw, `${pointer}/properties/${name}`, ctx);
    const prop: Prop = { node: lowered.node, required: required.has(name), nullable: lowered.nullable, hasDefault: false };
    if (typeof raw["description"] === "string") prop.description = raw["description"];
    props[name] = prop;
  }
  return { props, order };
}

function lowerObjectNode(schema: Schema, pointer: string, ctx: LowerCtx): Node {
  const additional = schema["additionalProperties"];
  if (typeof additional !== "object" || additional === null) {
    if (schema["maxProperties"] !== undefined) fail(ctx, `${pointer}/maxProperties`, "`maxProperties` is modelled only on a map (`additionalProperties: <schema>`)");
    const { props, order } = lowerProps(schema, pointer, ctx);
    return additional === false ? { k: "object", props, order, closed: true } : { k: "object", props, order };
  }
  // A map. `properties` beside it types some keys apart from the rest.
  const values = lowerNode(additional as Schema, `${pointer}/additionalProperties`, ctx);
  const node: Extract<Node, { k: "record" }> = { k: "record", values: values.nullable ? { k: "nullable", inner: values.node } : values.node };
  const maxProps = numberAt(schema, "maxProperties", pointer, ctx);
  if (maxProps !== undefined) node.maxProps = maxProps;
  const named = lowerProps(schema, pointer, ctx);
  if (named.order.length > 0) {
    node.named = {};
    for (const name of named.order) {
      const own = (named.props[name] as Prop).node;
      if (node.values.k !== "prim" || node.values.enum === undefined || own.k !== "prim" || own.enum === undefined || own.t !== node.values.t) {
        fail(ctx, `${pointer}/properties/${name}`, "a map's named key is modelled only when both it and the map's values are enums of one type");
      }
      node.named[name] = own;
    }
  }
  return node;
}

/**
 * The node a TYPE is rendered from: the same node, with a map's value type
 * widened to admit the vocabulary of every key the schema names apart. The
 * shape rows keep the narrower per-key lists for the check battery.
 */
function typeNode(node: Node): Node {
  switch (node.k) {
    case "array":
      return { ...node, items: typeNode(node.items) };
    case "nullable":
      return { ...node, inner: typeNode(node.inner) };
    case "object":
      return {
        ...node,
        props: Object.fromEntries(Object.entries(node.props).map(([name, prop]) => [name, { ...prop, node: typeNode(prop.node) }])),
      };
    case "record": {
      const values = typeNode(node.values);
      if (node.named === undefined || values.k !== "prim" || values.enum === undefined) return { k: "record", values };
      const members = new Set<string | number>(values.enum);
      for (const own of Object.values(node.named)) {
        if (own.k === "prim") for (const member of own.enum ?? []) members.add(member);
      }
      return { k: "record", values: { ...values, enum: [...members] } };
    }
    default:
      return node;
  }
}

// ---------------------------------------------------------------------------
// Conditionals → rule rows
//
// Higgsfield's schemas state cross-field requirements with `if` / `then` /
// `else`, `allOf`, `anyOf` and `not`. They reduce to five patterns and two
// rule kinds. A conditional that matches none stops the run: the fix is a new
// pattern here, never a silently dropped requirement.
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean;

interface RuleCondition {
  name: string;
  in: readonly Scalar[];
}

interface RuleConstraint {
  in?: readonly Scalar[];
  minItems?: number;
  maxItems?: number;
  /** The value must be `null` or absent. */
  null?: true;
  props?: Record<string, RuleConstraint>;
}

interface RuleConsequence {
  required?: string[];
  /** Required by the branch, and omitted safely if the server fills this agreed default first. */
  defaulted?: Record<string, Scalar>;
  props?: Record<string, RuleConstraint>;
}

type Rule =
  /** At least one of these must be sent (and be non-empty where `nonEmpty`). */
  | { kind: "atLeastOne"; params: Array<{ name: string; nonEmpty?: true }> }
  /** When every `if` clause holds, `then` applies; otherwise `else` does. */
  | {
      kind: "when";
      if: RuleCondition[];
      /** Which branch applies to a request that omits the `if` parameter. */
      absent: "then" | "else" | "either";
      then: RuleConsequence;
      else?: RuleConsequence;
    }
  /** `<<<kind_N>>>` tokens in `prompt` index an item of that kind's array, 1-based. */
  | { kind: "tokens"; prompt: string; arrays: Record<string, string> };

const CONDITIONAL_KEYWORDS = ["if", "then", "else", "allOf", "anyOf", "not"] as const;

function onlyKeys(schema: Schema, allowed: readonly string[]): boolean {
  return Object.keys(schema).every((key) => allowed.includes(key));
}

/** `{ required: [a], properties?: { a: { minItems: 1, type?: "array" } } }` → "a is present (and non-empty)". */
function presenceClause(schema: unknown): { name: string; nonEmpty?: true } | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const clause = schema as Schema;
  const required = clause["required"];
  if (!onlyKeys(clause, ["required", "properties"]) || !Array.isArray(required) || required.length !== 1) return undefined;
  const name = required[0] as string;
  const properties = clause["properties"] as Record<string, Schema> | undefined;
  if (properties === undefined) return { name };
  const own = properties[name];
  if (Object.keys(properties).length !== 1 || own === undefined || !onlyKeys(own, ["minItems", "type"]) || own["minItems"] !== 1) return undefined;
  if (own["type"] !== undefined && own["type"] !== "array") return undefined;
  return { name, nonEmpty: true };
}

/** P1: `if { present a } else <P1 | { present b }>`, with no `then`. */
function presenceChain(schema: Schema): Array<{ name: string; nonEmpty?: true }> | undefined {
  if (!onlyKeys(schema, ["if", "else"]) || schema["else"] === undefined) return undefined;
  const head = presenceClause(schema["if"]);
  if (head === undefined) return undefined;
  const tail = presenceClause(schema["else"]) ?? undefined;
  if (tail !== undefined) return [head, tail];
  const rest = typeof schema["else"] === "object" && schema["else"] !== null ? presenceChain(schema["else"] as Schema) : undefined;
  return rest === undefined ? undefined : [head, ...rest];
}

/** `{ properties: { a: { maxItems: 0 }, b: false } }` → "a is absent or empty, b is absent", as the negated presences. */
function absenceClause(schema: unknown): Array<{ name: string; nonEmpty?: true }> | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const clause = schema as Schema;
  const properties = clause["properties"];
  if (!onlyKeys(clause, ["properties"]) || typeof properties !== "object" || properties === null) return undefined;
  const out: Array<{ name: string; nonEmpty?: true }> = [];
  for (const [name, own] of Object.entries(properties as Record<string, unknown>)) {
    if (own === false) out.push({ name });
    else if (typeof own === "object" && own !== null && canonical(own) === canonical({ maxItems: 0 })) out.push({ name, nonEmpty: true });
    else return undefined;
  }
  return out.length === 0 ? undefined : out;
}

function scalarList(value: unknown): Scalar[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((member) => ["string", "number", "boolean"].includes(typeof member)) ? (value as Scalar[]) : undefined;
}

function lowerConstraint(schema: unknown, pointer: string, ctx: LowerCtx): RuleConstraint {
  if (typeof schema !== "object" || schema === null) fail(ctx, pointer, "a conditional's property constraint is not an object");
  const source = schema as Schema;
  const out: RuleConstraint = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "const" && ["string", "number", "boolean"].includes(typeof value)) out.in = [value as Scalar];
    else if (key === "enum" && scalarList(value) !== undefined) out.in = scalarList(value) as Scalar[];
    else if ((key === "minItems" || key === "maxItems") && typeof value === "number") out[key] = value;
    else if (key === "type" && value === "null") out.null = true;
    else if (key === "properties" && typeof value === "object" && value !== null) {
      out.props = Object.fromEntries(
        Object.entries(value as Schema).map(([name, own]) => [name, lowerConstraint(own, `${pointer}/properties/${name}`, ctx)]),
      );
    } else fail(ctx, `${pointer}/${key}`, `\`${key}: ${literal(value)}\` is not a constraint a conditional's branch is modelled to carry`);
  }
  return out;
}

function lowerConsequence(schema: unknown, pointer: string, ctx: LowerCtx): RuleConsequence {
  if (typeof schema !== "object" || schema === null) fail(ctx, pointer, "a conditional's branch is not an object");
  const source = schema as Schema;
  if (!onlyKeys(source, ["required", "properties"])) fail(ctx, pointer, "a conditional's branch is modelled only as `required` and `properties`");
  const out: RuleConsequence = {};
  if (source["required"] !== undefined) out.required = [...(source["required"] as string[])];
  if (source["properties"] !== undefined) {
    out.props = Object.fromEntries(
      Object.entries(source["properties"] as Schema).map(([name, own]) => [name, lowerConstraint(own, `${pointer}/properties/${name}`, ctx)]),
    );
  }
  return out;
}

interface RuleCtx extends LowerCtx {
  props: Record<string, Prop>;
  /** The default every source that declares the parameter agrees on, when they do. */
  agreedDefault(name: string): { value: unknown } | undefined;
}

/**
 * P5: `if { properties: { p: { const | enum | not: { const | enum } } }, required?: [p] } then {…} else? {…}`.
 *
 * **An omitted `if` parameter.** Strict JSON Schema says an `if` with no
 * `required` holds for a request that omits the parameter, so `then` applies.
 * A server that fills defaults before validating would instead take the branch
 * the default selects. `absent` records which reading is safe to enforce:
 *
 *   • `if` requires the parameter → `"else"` (the schema says so).
 *   • not required, and the default every source agrees on satisfies the `if`
 *     → `"then"`: both readings agree.
 *   • otherwise → `"either"`: the readings disagree or cannot be compared, so a
 *     request that omits the parameter is refused only when it satisfies
 *     neither branch — every reading refuses that one. Whatever BOTH branches
 *     require is hoisted to the route's own `required` first.
 */
function lowerWhen(schema: Schema, pointer: string, ctx: RuleCtx): Rule {
  if (!onlyKeys(schema, ["if", "then", "else"]) || schema["then"] === undefined) {
    fail(ctx, pointer, "this conditional matches none of the modelled patterns");
  }
  const condition = schema["if"] as Schema;
  const properties = condition["properties"] as Record<string, Schema> | undefined;
  if (!onlyKeys(condition, ["properties", "required"]) || properties === undefined || Object.keys(properties).length !== 1) {
    fail(ctx, `${pointer}/if`, "an `if` is modelled only as one property's `const` / `enum`");
  }
  const name = Object.keys(properties)[0] as string;
  const test = properties[name] as Schema;
  const declared = ctx.props[name];
  if (declared === undefined) fail(ctx, `${pointer}/if`, `the \`if\` tests ${name}, which the route does not declare`);

  let accepted: Scalar[];
  const direct = test["const"] !== undefined ? [test["const"]] : test["enum"];
  if (onlyKeys(test, ["const"]) || onlyKeys(test, ["enum"])) {
    accepted = scalarList(direct) ?? fail(ctx, `${pointer}/if`, "the tested values are not scalars");
  } else if (onlyKeys(test, ["not"]) && typeof test["not"] === "object" && test["not"] !== null) {
    // The complement, which only a CLOSED vocabulary has.
    const negated = test["not"] as Schema;
    const excluded = scalarList(negated["const"] !== undefined ? [negated["const"]] : negated["enum"]);
    const vocabulary = declared.node.k === "prim" ? declared.node.enum : undefined;
    if (excluded === undefined || !(onlyKeys(negated, ["const"]) || onlyKeys(negated, ["enum"])) || vocabulary === undefined) {
      fail(ctx, `${pointer}/if`, `\`not\` is modelled only as the complement of a \`const\` / \`enum\` over ${name}'s own closed enum`);
    }
    accepted = vocabulary.filter((member) => !excluded.includes(member));
  } else {
    fail(ctx, `${pointer}/if`, "an `if` is modelled only as one property's `const` / `enum`");
  }

  const then = lowerConsequence(schema["then"], `${pointer}/then`, ctx);
  const otherwise = schema["else"] === undefined ? undefined : lowerConsequence(schema["else"], `${pointer}/else`, ctx);
  if (otherwise !== undefined) {
    const shared = (then.required ?? []).filter((param) => (otherwise.required ?? []).includes(param));
    for (const param of shared) {
      const prop = ctx.props[param];
      if (prop === undefined) fail(ctx, pointer, `both branches require ${param}, which the route does not declare`);
      prop.required = true;
    }
    for (const branch of [then, otherwise]) {
      const rest = (branch.required ?? []).filter((param) => !shared.includes(param));
      if (rest.length > 0) branch.required = rest;
      else delete branch.required;
    }
  }

  for (const branch of otherwise === undefined ? [then] : [then, otherwise]) splitDefaulted(branch, ctx);

  let absent: "then" | "else" | "either";
  if (((condition["required"] ?? []) as string[]).includes(name)) absent = "else";
  else {
    const agreed = ctx.agreedDefault(name);
    absent = agreed !== undefined && accepted.includes(agreed.value as Scalar) ? "then" : "either";
  }
  const rule: Rule = { kind: "when", if: [{ name, in: accepted }], absent, then };
  if (otherwise !== undefined && Object.keys(otherwise).length > 0) rule.else = otherwise;
  return rule;
}

/**
 * A branch's `required` parameter whose agreed default already satisfies what
 * the branch holds it to moves to `defaulted`.
 *
 * The same two readings as an omitted `if` parameter: strict JSON Schema
 * refuses the request that omits it, and a server that fills defaults before
 * validating fulfils it. Nothing here was probed against a live key, so the
 * omission is reported and not refused.
 */
function splitDefaulted(branch: RuleConsequence, ctx: RuleCtx): void {
  const strict: string[] = [];
  for (const param of branch.required ?? []) {
    const agreed = ctx.agreedDefault(param);
    const value = agreed?.value;
    const allowed = branch.props?.[param]?.in;
    const scalar = typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    if (scalar && Object.keys(branch.props?.[param] ?? {}).every((key) => key === "in") && (allowed === undefined || allowed.includes(value))) {
      branch.defaulted = { ...branch.defaulted, [param]: value };
    } else strict.push(param);
  }
  if (strict.length > 0) branch.required = strict;
  else delete branch.required;
}

function lowerRules(schema: Schema, ctx: RuleCtx): Rule[] {
  const rules: Rule[] = [];
  if (schema["if"] !== undefined || schema["then"] !== undefined || schema["else"] !== undefined) {
    const unit: Schema = {};
    for (const key of ["if", "then", "else"]) if (schema[key] !== undefined) unit[key] = schema[key];
    const chain = presenceChain(unit);
    // P4: "when these are all absent or empty, that one is required and non-empty".
    const absent = onlyKeys(unit, ["if", "then"]) ? absenceClause(unit["if"]) : undefined;
    const demanded = absent === undefined ? undefined : presenceClause(unit["then"]);
    if (chain !== undefined) rules.push({ kind: "atLeastOne", params: chain });
    else if (absent !== undefined && demanded !== undefined) rules.push({ kind: "atLeastOne", params: [...absent, demanded] });
    else rules.push(lowerWhen(unit, "", ctx));
  }
  if (schema["allOf"] !== undefined) {
    (schema["allOf"] as Schema[]).forEach((member, index) => rules.push(lowerWhen(member, `/allOf/${index}`, ctx)));
  }
  if (schema["anyOf"] !== undefined) {
    // P2: every arm is a presence test.
    const arms = (schema["anyOf"] as unknown[]).map(presenceClause);
    if (arms.some((arm) => arm === undefined)) fail(ctx, "/anyOf", "a top-level `anyOf` is modelled only as a list of `required` arms");
    rules.push({ kind: "atLeastOne", params: arms as Array<{ name: string; nonEmpty?: true }> });
  }
  if (schema["not"] !== undefined) {
    // P3: `not` over "all of these are absent or empty".
    const negated = absenceClause(schema["not"]);
    if (negated === undefined) fail(ctx, "/not", "a top-level `not` is modelled only over `properties` that are `false` or `{ maxItems: 0 }`");
    rules.push({ kind: "atLeastOne", params: negated });
  }
  for (const rule of rules) {
    const named =
      rule.kind === "atLeastOne"
        ? rule.params.map((param) => param.name)
        : rule.kind === "when"
          ? [rule.then, ...(rule.else === undefined ? [] : [rule.else])].flatMap((branch) => [
              ...(branch.required ?? []),
              ...Object.keys(branch.defaulted ?? {}),
              ...Object.keys(branch.props ?? {}),
            ])
          : [];
    for (const name of named) {
      if (ctx.props[name] === undefined) fail(ctx, "", `a conditional names ${name}, which the route does not declare`);
    }
  }
  return rules;
}

// ---------------------------------------------------------------------------
// A route, lowered
// ---------------------------------------------------------------------------

const VERBS = ["image", "video"] as const;
type Verb = (typeof VERBS)[number];

/** The vendor's operation types. A new one means a new kind of route, which a person files. */
const OPERATION_TYPES: ReadonlySet<string> = new Set(["text2image", "image_edit", "text2video", "image2video", "video2video", "character"]);

/**
 * Which input modality a media parameter carries, by its wire name.
 *
 * Higgsfield's media spellings are uniform across vendors, so this is a table
 * and not a classifier. A parameter that LOOKS like media (a `uri` format, or
 * a name ending `_url` / `_urls`) and is not here stops the run: a new media
 * key is filed by a person. `undefined` is a filed answer too — a document or
 * a web page is an attachment, and `Modality` has no word for either.
 */
const MEDIA_PARAMS: Readonly<Record<string, "image" | "video" | "audio" | undefined>> = {
  audio_url: "audio",
  audio_urls: "audio",
  end_image_url: "image",
  file_url: undefined,
  first_frame_url: "image",
  image_reference_url: "image",
  image_url: "image",
  image_urls: "image",
  item_image_urls: "image",
  last_frame_url: "image",
  last_image_url: "image",
  link_url: undefined,
  video_url: "video",
  video_urls: "video",
};

/** unmodel's two URL parameters. A route that declared one would collide with the selector. */
const RESERVED_PARAMS: readonly string[] = ["endpoint", "hf_webhook"];

interface SoftBounds {
  softMin?: number;
  softMax?: number;
  softXmin?: number;
  softMaxLen?: number;
  nulWarn?: true;
}

interface RouteModel {
  id: string;
  verb: Verb;
  imageEdit: boolean;
  typeName: string;
  name: string;
  docUrl: string;
  releaseDate?: string;
  props: Record<string, Prop>;
  order: string[];
  closed: boolean;
  soft: Record<string, SoftBounds>;
  rules: Rule[];
  usageNotes: string[];
  inputModalities: string[];
  attachment: boolean;
  snapshot: RouteSnapshot;
  pricing: PricingRow;
  /** The console says no price is public while another surface of the route states this one. */
  contradicted: boolean;
}

function isUriNode(node: Node): boolean {
  if (node.k === "prim") return node.format === "uri";
  if (node.k === "array") return isUriNode(node.items);
  if (node.k === "nullable") return isUriNode(node.inner);
  return false;
}

/** Docs prose is Markdown; a JSDoc block wants the text. */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([_[\]<>{}*#`|~])/g, "$1");
}

function lowerRoute(route: RouteSnapshot, verb: Verb, imageEdit: boolean, book: OverlayBook): Omit<RouteModel, "pricing" | "contradicted"> {
  const ignored = book.of(route.id, "ignoreKeyword");
  const published = [route.docs?.schema, route.console?.input_schema].filter((schema) => schema !== undefined);
  for (const overlay of ignored) {
    if (published.some((schema) => valueAt(schema, overlay.pointer) !== undefined)) book.use(overlay);
  }

  const resolved = resolveSchema(route, book);
  const schema = resolved.schema;
  const ctx: LowerCtx = { route: route.id, root: schema, ignored: new Set(ignored.map((overlay) => overlay.pointer)), expanding: [] };

  assertKnownKeywords(schema, "", ctx, new Set(["type", "properties", "required", "additionalProperties", "$defs", ...CONDITIONAL_KEYWORDS]));
  if (schema["type"] !== "object") fail(ctx, "/type", "a route's input schema is not an object");
  const additional = schema["additionalProperties"];
  if (additional !== undefined && typeof additional !== "boolean") fail(ctx, "/additionalProperties", "a route's `additionalProperties` is not a boolean");
  const { props, order } = lowerProps(schema, "", ctx);

  for (const name of order) {
    const prop = props[name] as Prop;
    if (RESERVED_PARAMS.includes(name)) {
      fail(ctx, `/properties/${name}`, `the route declares \`${name}\`, which is unmodel's own URL parameter at every Higgsfield address`);
    }
    if ((isUriNode(prop.node) || /_urls?$/.test(name)) && !(name in MEDIA_PARAMS)) {
      fail(ctx, `/properties/${name}`, `\`${name}\` looks like a media parameter and is not in MEDIA_PARAMS. File it there with the modality it carries`);
    }
  }

  /** The default every source that declares the parameter agrees on. */
  function agreedDefault(name: string): { value: unknown } | undefined {
    const declaring = resolved.sources
      .map((source) => (source["properties"] as Record<string, Schema> | undefined)?.[name])
      .filter((own) => own !== undefined);
    if (declaring.length === 0 || !declaring.every((own) => "default" in own)) return undefined;
    const first = (declaring[0] as Schema)["default"];
    return declaring.every((own) => canonical(own["default"]) === canonical(first)) ? { value: first } : undefined;
  }
  // A top-level `required` parameter with an agreed default is optional: Higgsfield fills top-level defaults
  // before it validates (the LTX-2.5 routes' own usage notes: "duration is marked required in the schema and
  // has default 6; the API applies this top-level default before validation"), so the omission is fulfilled.
  for (const name of order) {
    const agreed = agreedDefault(name);
    if (agreed === undefined) continue;
    const prop = props[name] as Prop;
    prop.hasDefault = true;
    prop.default = agreed.value;
    prop.required = false;
  }

  const soft: Record<string, SoftBounds> = {};
  for (const overlay of book.of(route.id, "nullable")) {
    const prop = props[overlay.param];
    if (prop === undefined || prop.nullable) continue;
    prop.nullable = true;
    if (overlay.warn === true) soft[overlay.param] = { ...soft[overlay.param], nulWarn: true };
    book.use(overlay);
  }
  for (const overlay of book.of(route.id, "softBound")) {
    const node = props[overlay.param]?.node;
    if (node === undefined || node.k !== "prim") continue;
    // A soft bound must be TIGHTER than the hard one, or it says nothing.
    const tighter = {
      minimum: (node.min ?? -Infinity) < overlay.value && (node.xmin ?? -Infinity) < overlay.value,
      exclusiveMinimum: (node.min ?? -Infinity) <= overlay.value && (node.xmin ?? -Infinity) < overlay.value,
      maximum: (node.max ?? Infinity) > overlay.value && (node.xmax ?? Infinity) > overlay.value,
      maxLength: (node.maxLen ?? Infinity) > overlay.value,
    }[overlay.keyword];
    if (!tighter) continue;
    const field = ({ minimum: "softMin", maximum: "softMax", exclusiveMinimum: "softXmin", maxLength: "softMaxLen" } as const)[overlay.keyword];
    soft[overlay.param] = { ...soft[overlay.param], [field]: overlay.value };
    book.use(overlay);
  }

  const rules = lowerRules(schema, { ...ctx, props, agreedDefault });
  for (const overlay of book.of(route.id, "tokens")) {
    const promptNode = props[overlay.prompt]?.node;
    const arraysExist = Object.values(overlay.arrays).every((name) => props[name]?.node.k === "array");
    if (promptNode === undefined || promptNode.k !== "prim" || promptNode.t !== "string" || !arraysExist) continue;
    rules.push({ kind: "tokens", prompt: overlay.prompt, arrays: { ...overlay.arrays } });
    book.use(overlay);
  }

  const inputModalities = new Set<string>();
  for (const name of order) {
    const modality = MEDIA_PARAMS[name];
    if (modality !== undefined) inputModalities.add(modality);
  }
  const modalityOrder = ["text", "image", "video", "audio"];
  // `prompt` is text; so is a brief. A route with neither takes no text.
  if (order.some((name) => (props[name] as Prop).node.k === "prim" && ["prompt", "brief"].includes(name))) inputModalities.add("text");

  const page = route.page;
  const name =
    page === null
      ? (route.docs as NonNullable<RouteSnapshot["docs"]>).title
      : page.variant_title === null || page.variant_title === page.title
        ? page.title
        : `${page.title} — ${page.variant_title}`;
  const model: Omit<RouteModel, "pricing" | "contradicted"> = {
    id: route.id,
    verb,
    imageEdit,
    typeName: `${pascalCase(route.id)}Input`,
    name,
    docUrl: route.docs?.url ?? (page as NonNullable<RouteSnapshot["page"]>).url,
    props,
    order,
    closed: additional === false,
    soft,
    rules,
    usageNotes: (route.docs?.usage_notes ?? []).map(unescapeMarkdown),
    inputModalities: modalityOrder.filter((modality) => inputModalities.has(modality)),
    attachment: order.some((param) => param in MEDIA_PARAMS),
    snapshot: route,
  };
  if (page?.released_on !== null && page?.released_on !== undefined) model.releaseDate = page.released_on;
  return model;
}

// ---------------------------------------------------------------------------
// Pricing rows, guarded
// ---------------------------------------------------------------------------

/** Every sentence of a route's snapshot that a price quote may be read from. */
function priceAnchors(route: RouteSnapshot): string[] {
  const anchors: Array<string | null | undefined> = [
    route.console?.pricing,
    route.page?.related_models_description,
    route.page?.description,
    ...(route.docs?.usage_notes ?? []),
  ];
  for (const schema of [route.console?.input_schema, route.docs?.schema]) {
    for (const own of Object.values((schema?.["properties"] ?? {}) as Record<string, Schema>)) {
      if (typeof own["description"] === "string") anchors.push(own["description"]);
    }
  }
  return anchors.filter((anchor): anchor is string => typeof anchor === "string");
}

/** Every dollar amount a sentence states, as numbers: `$0.1540`, `$5`, `USD 0.08`. */
export function quotedAmounts(quote: string): number[] {
  return [...quote.matchAll(/(?:\$|USD )(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
}

/**
 * The amounts a sentence states beside a label, by lower-cased label, in the
 * three ways Higgsfield's price sentences pair them:
 *
 *   "720p: $0.2647", "480p — $0.0739", "720p $0.1257 / $0.1544"   label, then its amount(s)
 *   "$0.054 each at 1k and 1.5k"                                   amount, then every label it holds for
 *   "$0.0467 per second at 768p for 6 second clips"                amount, then the clip length it holds for
 *
 * A label the sentence states away from its amount ("4K:" opening a list) is
 * not in the map; Guard B then has only the amounts themselves to check.
 */
export function labelledAmounts(quote: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  function add(label: string, amount: string | undefined): void {
    if (amount === undefined) return;
    const key = label.toLowerCase();
    found.set(key, [...(found.get(key) ?? []), Number(amount)]);
  }
  const amount = String.raw`\$(\d+(?:\.\d+)?)`;
  // A label starts with a digit ("720p", "1.5k", "4K"), which keeps the word before an amount ("cost $0.04") out.
  const label = String.raw`\d(?:[\w.]*\w)?`;
  for (const match of quote.matchAll(new RegExp(String.raw`(${label})(?::| —)? ${amount}(?: / ${amount})?`, "g"))) {
    add(match[1] as string, match[2]);
    add(match[1] as string, match[3]);
  }
  for (const match of quote.matchAll(new RegExp(String.raw`${amount} each at (${label}(?:(?:, | and )${label})*)`, "g"))) {
    for (const each of (match[2] as string).split(/, | and /)) add(each, match[1]);
  }
  for (const match of quote.matchAll(new RegExp(String.raw`${amount} per second(?: at ${label})? for (\d+) second clips`, "g"))) {
    add(match[2] as string, match[1]);
  }
  return found;
}

function rateValues(table: number | Record<string, number> | undefined): number[] {
  if (table === undefined) return [];
  return typeof table === "number" ? [table] : Object.values(table);
}

function closedEnum(prop: Prop | undefined): readonly (string | number)[] | undefined {
  return prop?.node.k === "prim" ? prop.node.enum : undefined;
}

/**
 * Checks one pricing row against its route. Returns whether the rate is
 * contradicted: transcribed from another surface while the route's console
 * document prints `CONSOLE_NO_PRICING`. That is read off the snapshot, never
 * entered by hand.
 *
 * Contradicting pages are not catalogued, so a rate at such a route stops the
 * run unless its row carries `decided`, the date the owner ruled for that
 * route; and a `decided` at a route that is not contradicted stops it too.
 */
function checkPricingRow(model: Omit<RouteModel, "pricing" | "contradicted">, row: PricingRow): boolean {
  const route = model.snapshot;
  const where = `pricing.json: ${model.id}`;
  const anchors = priceAnchors(route);
  function anchored(field: string, quote: string): void {
    if (!anchors.some((anchor) => anchor.includes(quote))) {
      throw new Error(
        `${where}: \`${field}\` is not in the route's committed snapshot any more — ${literal(quote)}. ` +
          "The sentence changed upstream (or was mistyped): re-read the source and rewrite the row.",
      );
    }
  }
  function declared(field: string, name: string): Prop {
    const prop = model.props[name];
    if (prop === undefined) throw new Error(`${where}: \`${field}\` names ${name}, which the route does not declare`);
    return prop;
  }

  if ("unpriced" in row) {
    // A route only the docs publish has no sentence about price at all.
    if (row.quote === undefined && (route.console !== null || route.page !== null)) {
      throw new Error(`${where}: an \`unpriced\` row needs the \`quote\` it was read from`);
    }
    if (row.quote !== undefined) anchored("quote", row.quote);
    return false;
  }

  anchored("quote", row.quote);
  const amounts = quotedAmounts(row.quote);
  for (const usd of [...rateValues(row.usd), ...rateValues(row.usdWithVideoInput)]) {
    if (!amounts.includes(usd)) throw new Error(`${where}: the rate ${usd} is not one of the amounts in its own quote (${amounts.join(", ")})`);
  }
  const labelled = labelledAmounts(row.quote);
  for (const table of [row.usd, row.usdWithVideoInput]) {
    for (const [key, usd] of Object.entries(typeof table === "object" ? table : {})) {
      const stated = labelled.get(key.toLowerCase());
      if (stated !== undefined && !stated.includes(usd)) {
        throw new Error(`${where}: the rate under ${literal(key)} is ${usd}, and the quote puts ${stated.join(" and ")} beside ${key}`);
      }
    }
  }

  const keyed = typeof row.usd !== "number";
  if (keyed !== (row.by !== undefined || row.byUnpublished !== undefined) || (row.by !== undefined && row.byUnpublished !== undefined)) {
    throw new Error(`${where}: a rate table needs exactly one of \`by\` and \`byUnpublished\`, and a single rate needs neither`);
  }
  if (row.by !== undefined) {
    const vocabulary = closedEnum(declared("by", row.by));
    if (vocabulary === undefined) throw new Error(`${where}: \`by\` names ${row.by}, which has no closed enum to key a table on`);
    const members = vocabulary.map(String);
    const keys = Object.keys(row.usd as Record<string, number>);
    if (canonical(sorted(keys)) !== canonical(sorted(members))) {
      throw new Error(`${where}: \`usd\` is keyed ${literal(keys)} and ${row.by} offers ${literal(members)}. Keys are wire values, one per member.`);
    }
    for (const key of Object.keys(typeof row.usdWithVideoInput === "object" ? row.usdWithVideoInput : {})) {
      if (!members.includes(key)) throw new Error(`${where}: \`usdWithVideoInput\` has the key ${key}, which is not a value of ${row.by}`);
    }
  }
  if ((row.usdWithVideoInput !== undefined) !== (row.videoInputs !== undefined)) {
    throw new Error(`${where}: \`usdWithVideoInput\` and \`videoInputs\` come together`);
  }
  for (const name of row.videoInputs ?? []) declared("videoInputs", name);

  if ((row.unit === "per_second") !== (row.seconds !== undefined)) {
    throw new Error(`${where}: a per-second rate states what its seconds are (\`seconds\`), and a per-image rate does not`);
  }
  if (row.seconds === "request") declared("seconds", "duration");
  if ((row.seconds === "source") !== (row.sourceParam !== undefined) || (row.seconds === "source") !== (row.rounding !== undefined)) {
    throw new Error(`${where}: \`sourceParam\` and \`rounding\` go with \`seconds: "source"\`, and only with it`);
  }
  if (row.sourceParam !== undefined) declared("sourceParam", row.sourceParam);
  if (row.maxSecondsQuote !== undefined) anchored("maxSecondsQuote", row.maxSecondsQuote);
  if ((row.maxSeconds === undefined) !== (row.seconds !== "source" || !(row.maxSecondsQuote ?? row.quote).includes(`${row.maxSeconds} seconds`))) {
    throw new Error(`${where}: \`maxSeconds\` is a cap on a source clip that the quote, or \`maxSecondsQuote\`, states in seconds`);
  }

  if (row.count !== undefined) declared("count", row.count);
  if ((row.count !== undefined) !== (row.countQuote !== undefined)) throw new Error(`${where}: \`count\` needs the \`countQuote\` that says it multiplies`);
  if (row.countQuote !== undefined) anchored("countQuote", row.countQuote);
  if (row.multipliedBy !== undefined) declared("multipliedBy", row.multipliedBy);

  for (const arm of row.undefinedWhen ?? []) {
    const prop = declared("undefinedWhen", arm.param);
    if ((arm.in !== undefined) === (arm.minItems !== undefined)) throw new Error(`${where}: an \`undefinedWhen\` arm on ${arm.param} states exactly one of \`in\` and \`minItems\``);
    if (arm.minItems !== undefined && prop.node.k !== "array") throw new Error(`${where}: \`undefinedWhen.minItems\` is on ${arm.param}, which is not an array`);
    const vocabulary = closedEnum(prop);
    for (const value of arm.in ?? []) {
      if (vocabulary !== undefined && !vocabulary.includes(value as string)) {
        throw new Error(`${where}: \`undefinedWhen\` names ${literal(value)}, which is not a value of ${arm.param}`);
      }
    }
  }

  if (row.catalog !== undefined) {
    const selector = row.by === undefined ? undefined : model.props[row.by];
    if (selector === undefined || !(row.catalog in (row.usd as Record<string, number>))) {
      throw new Error(`${where}: \`catalog\` names a key of a \`by\`-keyed table`);
    }
    if (!selector.hasDefault || selector.default !== row.catalog) {
      throw new Error(
        `${where}: \`catalog\` is ${literal(row.catalog)}, and the default every source agrees on for ${row.by} is ` +
          `${selector.hasDefault ? literal(selector.default) : "not published"}. The catalog figure is the default's, or none.`,
      );
    }
  }

  const contradicted = route.console?.pricing === CONSOLE_NO_PRICING;
  if (contradicted && row.decided === undefined) {
    throw new Error(
      `${where}: the row states a rate, and the route's console document says ${literal(CONSOLE_NO_PRICING)} Contradicting pages are not ` +
        "catalogued: file the row as `unpriced` with that reason, or, where the owner has ruled that this route's rate stands, record the date as `decided`.",
    );
  }
  if (!contradicted && row.decided !== undefined) {
    throw new Error(`${where}: \`decided\` records an owner ruling on a contradicted rate, and this route's console document does not contradict it. Delete it.`);
  }
  return contradicted;
}

/**
 * What reaches `ModelInfo.cost`: a figure that is right for every request the
 * route takes, or — where the row says `catalog` — the default resolution's
 * figure, labelled as such above the row.
 *
 * `perVideoSecond` is a rate per second of GENERATED video, so only a rate
 * billed on the request's own `duration` qualifies; one billed on a source
 * clip or through a formula does not.
 */
function catalogCost(row: PricingRow): MediaCostInput | undefined {
  if ("unpriced" in row) return undefined;
  const usd = row.catalog !== undefined ? (row.usd as Record<string, number>)[row.catalog] : row.usd;
  if (typeof usd !== "number") return undefined;
  if (row.catalog === undefined) {
    const rateMoves = row.usdWithVideoInput !== undefined || row.multipliedBy !== undefined || (row.undefinedWhen ?? []).some((arm) => arm.changes === "rate");
    if (rateMoves) return undefined;
  }
  if (row.unit === "per_image") return { perImage: usd };
  return row.seconds === "request" ? { perVideoSecond: usd } : undefined;
}

function describeTable(table: number | Record<string, number>): string {
  if (typeof table === "number") return `$${table}`;
  return Object.entries(table)
    .map(([key, usd]) => `${key} $${usd}`)
    .join(", ");
}

/** The provenance block above a generated catalog row. Never a guess. */
function pricingComment(model: RouteModel, indent: string): string {
  const row = model.pricing;
  const lines: string[] = [];
  if ("unpriced" in row) {
    lines.push(`UNPRICED. ${row.unpriced}`);
  } else {
    const unit = row.unit === "per_image" ? "per image" : "per second";
    const selector = row.by !== undefined ? `, by \`${row.by}\`` : row.byUnpublished !== undefined ? ", by output resolution" : "";
    lines.push(`${describeTable(row.usd)} ${unit}${selector}.`);
    if (row.usdWithVideoInput !== undefined) lines.push(`With a video input: ${describeTable(row.usdWithVideoInput)}.`);
    if (row.byUnpublished !== undefined) lines.push(row.byUnpublished);
    const cost = catalogCost(row);
    if (row.catalog !== undefined) {
      lines.push(`\`cost\` carries the ${row.catalog} figure, the default \`${row.by}\`; the other rates are in HIGGSFIELD_RATES.`);
    } else if (cost === undefined) {
      lines.push("Not on `cost`: no single figure is right for every request this route takes. The rate is in HIGGSFIELD_RATES.");
    }
    if (model.contradicted) {
      lines.push(`CAVEAT: the same route's console document says “${CONSOLE_NO_PRICING}” (${model.snapshot.console?.url}).`);
    }
  }
  lines.push("");
  lines.push(`Source: ${row.source} — verified ${row.verified}.`);
  if (row.quote !== undefined) lines.push(`Quote: “${jsdocText(row.quote)}”`);
  return renderDoc(lines, indent);
}

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

export function generate(input: GenerateInput): Map<string, string> {
  const curation = curationSchema.parse(input.curation);
  const overlays = overlaysSchema.parse(input.overlays).overlays;
  const pricing = pricingSchema.parse(input.pricing).endpoints;

  const snapshots = sorted(Object.keys(input.routes)).map((id) => {
    const route = routeSnapshotSchema.parse(input.routes[id]);
    if (route.id !== id) throw new Error(`The snapshot filed under ${id} is for ${route.id}`);
    return route;
  });
  const known = new Set(snapshots.map((route) => route.id));
  const curated: Array<[string, readonly string[]]> = [
    ["handWritten", Object.keys(curation.handWritten)],
    ["views.imageEdit.exclude", Object.keys(curation.views.imageEdit.exclude)],
    ["excluded.routes", Object.keys(curation.excluded.routes)],
  ];
  for (const [block, ids] of curated) {
    for (const id of ids) {
      if (!known.has(id)) throw new Error(`curation.json: \`${block}\` names ${id}, which the snapshot no longer lists. Delete the entry.`);
    }
  }

  const book = new OverlayBook(overlays);
  const models: RouteModel[] = [];
  const typeNames = new Map<string, string>();
  for (const route of snapshots) {
    if (route.id in curation.excluded.routes) continue;
    const operations = route.console?.category.split(", ") ?? (route.page === null ? [] : [route.page.operation_type]);
    for (const operation of operations) {
      if (!OPERATION_TYPES.has(operation)) throw new Error(`${route.id}: the operation type ${operation} is not modelled`);
    }
    if (route.id in curation.handWritten) continue;
    if (operations.includes("character")) {
      throw new Error(`${route.id}: a \`character\` route is not a generation route. File it under \`handWritten\` in curation.json.`);
    }
    // The page states the output type; a route only the docs publish is filed
    // by which category index links its family.
    const output = route.page?.output_type ?? route.docs?.category;
    const verb = VERBS.find((candidate) => candidate === output);
    if (verb === undefined) throw new Error(`${route.id}: the output type ${literal(output)} is not modelled`);

    const viewExcluded = route.id in curation.views.imageEdit.exclude;
    const filedAsEdit = verb === "image" && operations.includes("image_edit");
    if (viewExcluded && !filedAsEdit) {
      throw new Error(`curation.json: \`views.imageEdit.exclude\` names ${route.id}, which the vendor does not file under image_edit. Delete the entry.`);
    }
    const lowered = lowerRoute(route, verb, filedAsEdit && !viewExcluded, book);
    const clash = typeNames.get(lowered.typeName);
    if (clash !== undefined) throw new Error(`${route.id} and ${clash} both render the type name ${lowered.typeName}`);
    typeNames.set(lowered.typeName, route.id);

    const row = pricing[route.id];
    if (row === undefined) {
      throw new Error(`pricing.json: ${route.id} has no row. Every generation route states a rate or an \`unpriced\` reason.`);
    }
    models.push({ ...lowered, pricing: row, contradicted: checkPricingRow(lowered, row) });
  }
  const generated = new Set(models.map((model) => model.id));
  for (const id of Object.keys(pricing)) {
    if (!generated.has(id)) throw new Error(`pricing.json: ${id} is not a generated route. Delete the row.`);
  }
  book.assertAllUsed(generated);

  const files = new Map<string, string>();
  files.set("endpoints.gen.ts", renderEndpointsFile(models, curation.excluded.routes));
  files.set("pricing.gen.ts", renderPricingFile(models));
  for (const verb of VERBS) {
    const slice = models.filter((model) => model.verb === verb);
    if (slice.length === 0) continue;
    files.set(`${verb}-wire.gen.ts`, renderWireFile(verb, slice));
    files.set(`${verb}-schema.gen.ts`, renderSchemaFile(verb, slice));
    files.set(`${verb}-check.gen.ts`, renderCheckFile(verb, slice));
    files.set(`${verb}-narrow.gen.ts`, renderNarrowFile(verb, slice));
    files.set(`models-${verb}.gen.ts`, renderModelsFile(verb, slice));
  }
  return new Map(sorted(files.keys()).map((name) => [name, files.get(name) as string]));
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

const HEADER = [
  "// Generated by scripts/codegen-higgsfield.ts — DO NOT EDIT.",
  `// Sources: ${CONSOLE_BASE_URL}/models/<id>/llms.txt, ${PAGE_BASE_URL}/models/<id>/api-reference,`,
  `//   ${DOCS_BASE_URL}/models/<family>/<workflow>.md — snapshotted at data/higgsfield/routes/.`,
  "// Hand inputs: data/higgsfield/curation.json, overlays.json, pricing.json.",
  "",
].join("\n");

/** The component namer the shared renderers ask for. This lowering inlines every `$ref`, so no node is one. */
function noComponents(hash: string): never {
  throw new Error(`The Higgsfield lowering inlines every \`$ref\`; nothing should name the component ${hash}`);
}

function verbConst(verb: Verb): string {
  return verb.toUpperCase();
}

function renderIdList(name: string, typeName: string, doc: readonly string[], ids: readonly string[]): string {
  return `${renderDoc(doc, "")}export const ${name} = [
${ids.map((id) => `  ${quote(id)},`).join("\n")}
] as const;

export type ${typeName} = (typeof ${name})[number];`;
}

function renderEndpointsFile(models: readonly RouteModel[], excluded: Readonly<Record<string, { reason: string }>>): string {
  function of(verb: Verb): string[] {
    return models.filter((model) => model.verb === verb).map((model) => model.id);
  }
  const edits = models.filter((model) => model.imageEdit).map((model) => model.id);
  const blocks = [
    renderIdList("HIGGSFIELD_IMAGE_ENDPOINTS", "HiggsfieldImageEndpointId", [`Every route that answers images — ${of("image").length} of them.`], of("image")),
    renderIdList(
      "HIGGSFIELD_IMAGE_EDIT_ENDPOINTS",
      "HiggsfieldImageEditEndpointId",
      [
        `The image routes that take a picture to edit — ${edits.length} of the ${of("image").length} above, not a separate roster.`,
        "",
        "A route is here when Higgsfield files it under `image_edit` and `data/higgsfield/curation.json` does not",
        "say the filing is something else. Several of them also generate from text alone.",
      ],
      edits,
    ),
    renderIdList("HIGGSFIELD_VIDEO_ENDPOINTS", "HiggsfieldVideoEndpointId", [`Every route that answers a video — ${of("video").length} of them.`], of("video")),
    renderIdList("HIGGSFIELD_ENDPOINTS", "HiggsfieldEndpointId", ["Every generated route id, across both output types, sorted."], models.map((model) => model.id)),
    `${renderDoc(
      [
        "The page that documents each route: its docs.higgsfield.ai page where one exists, otherwise its",
        "console API reference.",
      ],
      "",
    )}export const HIGGSFIELD_DOC_URLS = {
${models.map((model) => `  ${quote(model.id)}: ${quote(model.docUrl)},`).join("\n")}
} as const;`,
    `${renderDoc(
      [
        "Route ids Higgsfield's documents list that unmodel deliberately does not type, each with the recorded",
        "reason. The path is unaffected: an id is the URL, whichever address builds it.",
      ],
      "",
    )}export const HIGGSFIELD_EXCLUDED: Readonly<Record<string, string>> = {
${sorted(Object.keys(excluded))
  .map((id) => `  ${quote(id)}: ${quote((excluded[id] as { reason: string }).reason)},`)
  .join("\n")}
};`,
  ];
  return `${HEADER}
${renderDoc(
  [
    "The Higgsfield route roster.",
    "",
    "A route id is not a model name: it IS the URL path (`POST https://api.higgsfield.ai/<id>`), at any depth.",
    "Higgsfield's bodies carry no `model` field, so unmodel selects the route with an `endpoint` parameter that",
    "never reaches the wire.",
  ],
  "",
)}
${blocks.join("\n\n")}
`;
}

function propDoc(prop: Prop, indent: string): string {
  const lines: string[] = [];
  if (prop.description !== undefined) {
    const text = jsdocText(prop.description);
    lines.push(/[.!?:)\]]$/.test(text) ? text : `${text}.`);
  }
  // Only a default every source agrees on: the console and the docs disagree
  // on several, and unmodel injects none either way.
  if (prop.hasDefault) lines.push(`Default: \`${literal(prop.default)}\`.`);
  for (const line of namedMapNotes(prop.node, [])) lines.push("", line);
  return lines.length === 0 ? "" : renderDoc(lines, indent);
}

/**
 * The per-key vocabulary of every map with named keys under `node`. Its type
 * is the union of the lists (see {@link typeNode}): TypeScript cannot give one
 * key of a map values its other keys refuse without refusing them on that key
 * too, so the exact lists are said here, where the type cannot say them.
 */
function namedMapNotes(node: Node, path: readonly string[]): string[] {
  switch (node.k) {
    case "array":
      return namedMapNotes(node.items, [...path, "[]"]);
    case "nullable":
      return namedMapNotes(node.inner, path);
    case "object":
      return Object.entries(node.props).flatMap(([name, prop]) => namedMapNotes(prop.node, [...path, name]));
    case "record": {
      const notes = namedMapNotes(node.values, [...path, "*"]);
      if (node.named === undefined || node.values.k !== "prim") return notes;
      const vocabulary = (own: Node): string => (own.k === "prim" ? (own.enum ?? []).map((member) => literal(member)).join(", ") : "");
      const named = Object.entries(node.named).map(([name, own]) => `\`${name}\` takes ${vocabulary(own)}`);
      const where = path.length === 0 ? "This map" : `\`${path.join(".").replace(/\.\[\]/g, "[]")}\``;
      return [
        `${where}: ${named.join("; ")}; every other key takes ${vocabulary(node.values)}. The type admits every list on every key, ` +
          "and the check refuses a value outside the key's own list.",
        ...notes,
      ];
    }
    default:
      return [];
  }
}

function renderWireFile(verb: Verb, models: readonly RouteModel[]): string {
  const interfaces = models.map((model) => {
    const fields = model.order
      .map((name) => {
        const prop = model.props[name] as Prop;
        const type = tsType(typeNode(prop.node), noComponents) + (prop.nullable ? " | null" : "");
        return `${propDoc(prop, "  ")}  ${propKey(name)}${prop.required ? "" : "?"}: ${type};`;
      })
      .join("\n");
    const doc = [`${model.name} — the request body \`${model.id}\` accepts.`];
    for (const note of model.usageNotes) doc.push("", jsdocText(note));
    doc.push("", `Docs: ${model.docUrl}`);
    return `${renderDoc(doc, "")}export interface ${model.typeName} {
${fields}
}`;
  });
  const pascal = pascalCase(verb);
  const editView =
    verb !== "image"
      ? ""
      : `
${renderDoc(["The bodies of the picture-editing view: the same interfaces, picked by id."], "")}export type HiggsfieldImageEditBodyById = Pick<HiggsfieldImageBodyById, HiggsfieldImageEditEndpointId>;
`;
  return `${HEADER}
${renderDoc(
  [
    `Wire types for every Higgsfield route that answers ${verb === "image" ? "images" : "a video"} — TYPE ONLY.`,
    "",
    "One interface per route, lowered from that route's own published JSON Schema. Properties are in",
    "alphabetical order: both sources print them shortest key first, which is a storage order and not an",
    "authored one. A default is stated only where every source that declares the property agrees on it.",
  ],
  "",
)}${verb === "image" ? 'import type { HiggsfieldImageEditEndpointId } from "./endpoints.gen";\n\n' : ""}${interfaces.join("\n\n")}

${renderDoc(
  [
    "Route id → its request body type.",
    "",
    `A map and not a union: a union of ${models.length} object types re-instantiates at every comparison site, while a`,
    "keyed lookup resolves in one.",
  ],
  "",
)}export interface Higgsfield${pascal}BodyById {
${models.map((model) => `  ${quote(model.id)}: ${model.typeName};`).join("\n")}
}
${editView}`;
}

function bareZod(type: string): string {
  switch (type) {
    case "string":
      return "z.string()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "array":
      return "z.array(z.unknown())";
    case "object":
      return "z.looseObject({})";
    default:
      return "z.unknown()";
  }
}

function renderSchemaFile(verb: Verb, models: readonly RouteModel[]): string {
  const shapes = `HIGGSFIELD_${verbConst(verb)}_SHAPES`;
  const names = sorted(new Set(models.flatMap((model) => model.order)));
  const fields = names.map((name) => {
    const holders = models.filter((model) => model.props[name] !== undefined);
    const specs = holders.map((model) => model.props[name] as Prop);
    const nodes = specs.map((spec) => typeNode(spec.node));
    const distinct = new Set(nodes.map((node) => canonical(node)));
    const types = new Set(nodes.map((node) => mergeType(node)));

    let expr: string;
    let comment = "";
    if (distinct.size === 1) {
      expr = zodExpr(nodes[0] as Node, noComponents);
    } else if (types.size === 1) {
      const type = [...types][0] as string;
      expr = bareZod(type);
      comment = renderDoc(
        [
          `Every route that takes \`${name}\` types it as ${type}, and they disagree on the details, so the gate`,
          `takes the bare type and ${shapes} carries each route's own vocabulary and bounds.`,
        ],
        "  ",
      );
    } else {
      expr = "z.unknown()";
      comment = renderDoc(
        [
          `\`${name}\` is a different type at different routes —`,
          `${holders.map((model) => `${mergeType((model.props[name] as Prop).node)} at ${model.id}`).join(", ")}.`,
          "",
          "Typed `unknown` here on purpose: a union that accepted both would let a route's wrong-typed value",
          `through the gate. ${shapes} carries the real type per route.`,
        ],
        "  ",
      );
    }
    if (specs.some((spec) => spec.nullable)) expr += ".nullable()";
    return `${comment}  ${propKey(name)}: ${expr}.optional(),`;
  });

  return `${HEADER}
${renderDoc(
  [
    `The ONE request schema for every Higgsfield route that answers ${verb === "image" ? "images" : "a video"}.`,
    "",
    `One \`z.looseObject\` for the whole address, not ${models.length} per-route schemas: zod objects are built eagerly, and`,
    "a hundred of them would be constructed on import for the one the caller used.",
    "",
    "Every field is optional here and every bound is absent. This schema is the SHAPE gate (is `prompt` a",
    `string?); what each route requires, ranges and enumerates lives in \`${shapes}\`, where the check`,
    "battery can name the route and cite its documentation. A vocabulary is in the gate only where every",
    "route that takes the field publishes the same one.",
    "",
    "`looseObject` because whether a route refuses an undeclared key is a per-route fact",
    "(`additionalProperties`), which the shape rows carry as `closed`.",
  ],
  "",
)}
import { z } from "zod";

export const higgsfield${pascalCase(verb)}InputSchema = z.looseObject({
${renderDoc(
  [
    "The route to submit to — unmodel's selector, not a body field.",
    "",
    "Stripped into `.request.url`; Higgsfield never receives it. It is declared here so the pipeline does not",
    "report the one required parameter as an unknown one.",
  ],
  "  ",
)}  endpoint: z.string(),
${renderDoc(
  [
    "A completion webhook — the `hf_webhook` QUERY parameter of the submit URL, not a body field. Stripped into",
    "`.request.url` like `endpoint`.",
  ],
  "  ",
)}  hf_webhook: z.string().optional(),
${fields.join("\n")}
});
`;
}

function checkable(node: Node): boolean {
  switch (node.k) {
    case "prim":
      return true;
    case "nullable":
      return checkable(node.inner);
    case "array":
      return checkable(node.items);
    default:
      return false;
  }
}

function renderCheckFile(verb: Verb, models: readonly RouteModel[]): string {
  const gate = `higgsfield${pascalCase(verb)}InputSchema`;
  const lines: string[] = [];
  for (const model of models) {
    const names = model.order.filter((name) => checkable((model.props[name] as Prop).node));
    if (names.length === 0) continue;
    lines.push(`  // ${model.id}`);
    for (const name of names) lines.push(`  AssertExtends<wire.${model.typeName}[${quote(name)}], Gate[${quote(name)}]>,`);
  }
  return `${HEADER}
${renderDoc(
  [
    `Schema/wire agreement checks for every Higgsfield ${verb} route — TYPE ONLY, imported by nothing.`,
    "",
    `\`${verb}-wire.gen.ts\` and \`${verb}-schema.gen.ts\` render from the same IR through two emitters. This file is`,
    "the proof they still agree: for every primitive-shaped field, the wire type must be assignable to the",
    "gate's input, so a field the gate emits as `z.string()` while the wire interface says `number` fails",
    "`tsc` here instead of shipping a gate that refuses legal bodies. Object-shaped fields are interfaces on",
    "the wire side and are enforced at run time from the shape rows.",
  ],
  "",
)}
import type { z } from "zod";

import type { AssertExtends } from "../shape-types";
import type { ${gate} } from "./${verb}-schema.gen";
import type * as wire from "./${verb}-wire.gen";

type Gate = z.input<typeof ${gate}>;

export type Higgsfield${pascalCase(verb)}SchemaChecks = [
${lines.join("\n")}
];
`;
}

/** A plain value as a TypeScript literal: bare keys, one line. */
function tsLiteral(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(tsLiteral).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, own]) => own !== undefined);
    return entries.length === 0 ? "{}" : `{ ${entries.map(([key, own]) => `${propKey(key)}: ${tsLiteral(own)}`).join(", ")} }`;
  }
  return literal(value);
}

function renderNarrowFile(verb: Verb, models: readonly RouteModel[]): string {
  // Vocabularies are hoisted and shared by content: `aspect_ratio` alone
  // would otherwise be written once per route that carries it.
  const enums = new Map<string, readonly (string | number)[]>();
  function enumName(values: readonly (string | number)[]): string {
    const key = `E_${hash6(canonical(values))}`;
    enums.set(key, values);
    return key;
  }

  function specLiteral(node: Node, flags: { required: boolean; nullable: boolean; soft?: SoftBounds }): string {
    const inner = node.k === "nullable" ? node.inner : node;
    const fields: string[] = [`t: ${quote(irType(inner))}`];
    if (flags.required) fields.push("req: true");
    if (flags.nullable || node.k === "nullable") fields.push("nul: true");
    if (flags.soft?.nulWarn === true) fields.push("nulWarn: true");
    function number(key: string, value: number | undefined): void {
      if (value !== undefined) fields.push(`${key}: ${num(value)}`);
    }
    switch (inner.k) {
      case "prim":
        if (inner.enum !== undefined) fields.push(`enum: ${enumName(inner.enum)}`);
        if (inner.const !== undefined) fields.push(`const: ${literal(inner.const)}`);
        number("min", inner.min);
        number("max", inner.max);
        number("xmin", inner.xmin);
        number("xmax", inner.xmax);
        number("softMin", flags.soft?.softMin);
        number("softMax", flags.soft?.softMax);
        number("softXmin", flags.soft?.softXmin);
        number("minLen", inner.minLen);
        number("maxLen", inner.maxLen);
        number("softMaxLen", flags.soft?.softMaxLen);
        if (inner.pattern !== undefined) fields.push(`pat: ${quote(inner.pattern)}`);
        number("step", inner.step);
        if (inner.format !== undefined) fields.push(`fmt: ${quote(inner.format)}`);
        break;
      case "array":
        number("minItems", inner.minItems);
        number("maxItems", inner.maxItems);
        fields.push(`items: ${specLiteral(inner.items, { required: false, nullable: false })}`);
        break;
      case "object":
        fields.push(`props: ${propsLiteral(inner.props, inner.order)}`);
        if (inner.closed === true) fields.push("closed: true");
        break;
      case "record":
        if (inner.named !== undefined) {
          const named = Object.entries(inner.named).map(
            ([name, own]) => `${propKey(name)}: ${specLiteral(own, { required: false, nullable: false })}`,
          );
          fields.push(`props: { ${named.join(", ")} }`);
        }
        fields.push(`values: ${specLiteral(inner.values, { required: false, nullable: false })}`);
        number("maxProps", inner.maxProps);
        break;
      default:
        break;
    }
    return `{ ${fields.join(", ")} }`;
  }

  function propsLiteral(props: Record<string, Prop>, order: readonly string[]): string {
    return `{ ${order
      .map((name) => {
        const prop = props[name] as Prop;
        return `${propKey(name)}: ${specLiteral(prop.node, { required: prop.required, nullable: prop.nullable })}`;
      })
      .join(", ")} }`;
  }

  const rows = models
    .map((model) => {
      const props = model.order
        .map((name) => {
          const prop = model.props[name] as Prop;
          return `      ${propKey(name)}: ${specLiteral(prop.node, { required: prop.required, nullable: prop.nullable, soft: model.soft[name] })},`;
        })
        .join("\n");
      const lines = [`  ${quote(model.id)}: {`, `    order: ${renderStringArray(model.order)},`, "    props: {", props, "    },"];
      if (model.closed) lines.push("    closed: true,");
      if (model.rules.length > 0) {
        lines.push("    rules: [", ...model.rules.map((rule) => `      ${tsLiteral(rule)},`), "    ],");
      }
      lines.push("  },");
      return lines.join("\n");
    })
    .join("\n");

  const enumBlock = sorted(enums.keys())
    .map((name) => `const ${name} = [${(enums.get(name) as readonly (string | number)[]).map((value) => literal(value)).join(", ")}] as const;`)
    .join("\n");

  return `${HEADER}
${renderDoc(
  [
    `The per-route rows every Higgsfield ${verb} check reads.`,
    "",
    "The schema next door asks “is this the right shape?”; these rows carry what each route requires, ranges,",
    "enumerates, and demands across fields, so ONE hand-written check battery can narrow to the route at run",
    "time and name it. The `props` keys ARE the allow-list, and `closed` says whether the route refuses a key",
    "outside it (`additionalProperties: false`) — a per-route fact, published by the route.",
  ],
  "",
)}
import type { HiggsfieldEndpointShape } from "../shape-types";

// Vocabularies, hoisted and deduplicated by content.
${enumBlock}

export const HIGGSFIELD_${verbConst(verb)}_SHAPES = {
${rows}
} as const satisfies Record<string, HiggsfieldEndpointShape>;
`;
}

function renderPricingFile(models: readonly RouteModel[]): string {
  const rows = models
    .map((model) => {
      const row = model.pricing;
      if ("unpriced" in row) {
        return `  ${quote(model.id)}: ${tsLiteral({ unpriced: row.unpriced, source: row.source, verified: row.verified })},`;
      }
      return `  ${quote(model.id)}: ${tsLiteral({
        unit: row.unit,
        usd: row.usd,
        by: row.by,
        byUnpublished: row.byUnpublished,
        usdWithVideoInput: row.usdWithVideoInput,
        videoInputs: row.videoInputs,
        seconds: row.seconds,
        sourceParam: row.sourceParam,
        rounding: row.rounding,
        maxSeconds: row.maxSeconds,
        count: row.count,
        multipliedBy: row.multipliedBy,
        undefinedWhen: row.undefinedWhen?.map((arm) => ({ param: arm.param, in: arm.in, minItems: arm.minItems, reason: arm.reason })),
        contradicted: model.contradicted ? true : undefined,
        source: row.source,
        verified: row.verified,
      })},`;
    })
    .join("\n");
  return `${HEADER}
${renderDoc(
  [
    "Every generated Higgsfield route's published rate, as data.",
    "",
    "Transcribed from sentences — a console document's pricing paragraph, or a model page's price sentence —",
    "into `data/higgsfield/pricing.json`, quote, source URL and date included there. Higgsfield publishes no",
    "machine-readable rate in any document a person is pointed at.",
    "",
    "A rate here is NOT a cost. A table needs the request's value of `by`, a per-second rate needs the seconds",
    "it bills, and several quotes price some requests in ways a row cannot state (`undefinedWhen`). Where the",
    "request leaves any of that open the honest answer is `undefined`. `contradicted` marks a rate the same",
    `route's console document denies (“${CONSOLE_NO_PRICING}”).`,
  ],
  "",
)}
import type { HiggsfieldRate } from "../pricing-types";

/** What a console document's pricing paragraph says when it states no price. */
export const HIGGSFIELD_NO_PUBLIC_PRICING = ${quote(CONSOLE_NO_PRICING)};

export const HIGGSFIELD_RATES = {
${rows}
} as const satisfies Record<string, HiggsfieldRate>;
`;
}

function renderModelsFile(verb: Verb, models: readonly RouteModel[]): string {
  const rows = models
    .map((model) => {
      const fields = [
        `    id: ${quote(model.id)},`,
        `    name: ${quote(model.name)},`,
        `    attachment: ${model.attachment},`,
        "    reasoning: false,",
        "    toolCall: false,",
        "    openWeights: false,",
      ];
      if (model.releaseDate !== undefined) fields.push(`    releaseDate: ${quote(model.releaseDate)},`);
      fields.push(`    modalities: { input: ${renderStringArray(model.inputModalities)}, output: ${renderStringArray([verb])} },`);
      fields.push(`    limit: ${renderLimit({ context: 0 })},`);
      const cost = catalogCost(model.pricing);
      const rendered = cost === undefined ? undefined : renderMediaCost(cost);
      if (rendered !== undefined) fields.push(`    cost: ${rendered},`);
      return `${pricingComment(model, "  ")}  ${quote(model.id)}: {
${fields.join("\n")}
  },`;
    })
    .join("\n");
  return `${HEADER}
${renderDoc(
  [
    `The catalog slice for the Higgsfield routes that answer ${verb === "image" ? "images" : "a video"}.`,
    "",
    "Higgsfield is not in models.dev, so these rows follow src/providers/HAND_CATALOGS.md, with one",
    "difference: the SHAPE is generated from the route's own published documents, while the PRICING above",
    "each row is hand-transcribed from a published sentence, quote and date included.",
    "",
    "`limit.context: 0` throughout: none of these models has a token context window, and 0 is what tells the",
    "pipeline to skip the context check.",
  ],
  "",
)}
import type { ModelInfo } from "../../../core/catalog-types";

export const ${verb}Models = {
${rows}
} as const satisfies Record<string, ModelInfo>;
${verb === "image" ? renderImageEditModels(models) : ""}`;
}

/** The catalog of the image-edit view: the rows above by reference, so the view cannot drift from the roster it is a view of. */
function renderImageEditModels(models: readonly RouteModel[]): string {
  const edits = models.filter((model) => model.imageEdit);
  return `
${renderDoc(
  [
    `The ${edits.length} rows of \`imageModels\` that take a picture to edit (HIGGSFIELD_IMAGE_EDIT_ENDPOINTS) — the same`,
    "objects, not copies.",
  ],
  "",
)}export const imageEditModels = {
${edits.map((model) => `  ${quote(model.id)}: imageModels[${quote(model.id)}],`).join("\n")}
} as const satisfies Record<string, ModelInfo>;
`;
}

// ---------------------------------------------------------------------------
// Network: reading the three documented sources
//
// Everything below this banner and above "main()" runs only under --refresh
// and --check. `generate()` never reaches it.
// ---------------------------------------------------------------------------

const FETCH_CONCURRENCY = 4;
const FETCH_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One GET, retried on the answers that mean "later". `undefined` is a 404: a
 * route one source does not have is a fact the snapshot records, not a failure.
 */
async function fetchText(url: string): Promise<string | undefined> {
  let delayMs = 1_000;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": "codegen-snapshot/1.0" } });
    if (response.ok) return response.text();
    if (response.status === 404) return undefined;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= FETCH_ATTEMPTS) throw new Error(`GET ${url} answered ${response.status}`);
    const after = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1_000 : delayMs);
    delayMs *= 2;
  }
}

async function fetchRequired(url: string): Promise<string> {
  const text = await fetchText(url);
  if (text === undefined) throw new Error(`GET ${url} answered 404`);
  return text;
}

/** Maps with bounded concurrency, preserving input order. */
async function mapPooled<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function drain(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, drain));
  return results;
}

/**
 * Reads one value out of the data a page server-renders for its own hydration.
 *
 * `open.higgsfield.ai` streams its loader data into the HTML as a JavaScript
 * expression: object and array literals with bare keys, `!0` / `!1` for
 * booleans, and `$R[n]=` in front of every object so later positions can refer
 * back to it. This parses that expression as DATA — it never evaluates a byte
 * of the page — starting right after `marker`, and stops at the end of the one
 * value found there. Anything outside the literal grammar is an error, so a
 * page that changed shape stops the refresh instead of yielding half a row.
 */
export function readPageValue(html: string, marker: RegExp): unknown {
  const match = marker.exec(html);
  if (match === null) throw new Error(`page data: no ${marker} in the document`);
  const source = html;
  let at = match.index + match[0].length;
  const slots = new Map<number, unknown>();

  function fail(message: string): never {
    throw new Error(`page data: ${message} at offset ${at}: ${JSON.stringify(source.slice(at, at + 60))}`);
  }

  function readString(): string {
    let end = at + 1;
    while (source[end] !== '"') {
      if (end >= source.length) fail("unterminated string");
      end += source[end] === "\\" ? 2 : 1;
    }
    const raw = source.slice(at, end + 1);
    at = end + 1;
    // `\xNN` is the one escape this serialisation uses that JSON does not have.
    return JSON.parse(raw.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1")) as string;
  }

  function readObject(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    at += 1;
    while (source[at] !== "}") {
      let key: string;
      if (source[at] === '"') {
        key = readString();
      } else {
        const bare = /^[A-Za-z_$][\w$]*|^\d+/.exec(source.slice(at, at + 128));
        if (bare === null) fail("expected a property key");
        key = bare[0];
        at += key.length;
      }
      if (source[at] !== ":") fail("expected `:`");
      at += 1;
      out[key] = readValue();
      if (source[at] === ",") at += 1;
      else if (source[at] !== "}") fail("expected `,` or `}`");
    }
    at += 1;
    return out;
  }

  function readArray(): unknown[] {
    const out: unknown[] = [];
    at += 1;
    while (source[at] !== "]") {
      out.push(readValue());
      if (source[at] === ",") at += 1;
      else if (source[at] !== "]") fail("expected `,` or `]`");
    }
    at += 1;
    return out;
  }

  function readValue(): unknown {
    if (source.startsWith("$R[", at)) {
      const close = source.indexOf("]", at);
      const slot = Number(source.slice(at + 3, close));
      at = close + 1;
      if (source[at] === "=") {
        at += 1;
        const assigned = readValue();
        slots.set(slot, assigned);
        return assigned;
      }
      if (!slots.has(slot)) fail(`reference to slot ${slot}, which is outside the value being read`);
      return slots.get(slot);
    }
    const head = source[at];
    if (head === "{") return readObject();
    if (head === "[") return readArray();
    if (head === '"') return readString();
    if (source.startsWith("!0", at)) return (at += 2), true;
    if (source.startsWith("!1", at)) return (at += 2), false;
    if (source.startsWith("null", at)) return (at += 4), null;
    const number = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(at, at + 40));
    if (number === null) fail("unexpected token");
    at += number[0].length;
    return Number(number[0]);
  }

  return readValue();
}

/** Where a model page's loader data begins. */
const PAGE_MODEL_MARKER = /data:\$R\[\d+\]=\{model:/;
/** Where an explore listing's first page of rows begins. */
const PAGE_RESULTS_MARKER = /results:/;

const pageModelSchema = z.looseObject({
  catalog_type: z.string(),
  /** The path the page is served at. On a workflow page `slug` is the model row underneath instead. */
  route_slug: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  variant_title: z.string().nullable(),
  description: z.string(),
  input_schema: jsonSchemaSchema,
  operation_type: z.string().min(1),
  output_type: z.string().min(1),
  family: z.array(z.looseObject({ slug: z.string().min(1) })),
  /** Set on a `catalog_type: "workflow"` page: the playground preset's variants, each over a model row. */
  workflow: z
    .looseObject({ variants: z.array(z.looseObject({ route_slug: z.string().min(1), model_slug: z.string().min(1) })) })
    .nullable(),
  company: z.looseObject({ slug: z.string().min(1) }),
  overview: z.looseObject({
    input_types: z.array(z.string()),
    released_on: z.string().nullable(),
  }),
  pricing_description: z.string().nullable(),
  related_models: z.array(z.looseObject({ slug: z.string().min(1) })),
  related_models_description: z.string().nullable(),
  availability_state: z.string().min(1),
});

type PageModel = z.output<typeof pageModelSchema>;

const exploreRowSchema = z.looseObject({
  workflow_slug: z.string().nullable().optional(),
  default_mode_id: z.string().nullable().optional(),
  entry_points: z.array(z.looseObject({ mode_id: z.string().min(1) })).optional(),
});

async function fetchPageModel(id: string): Promise<PageModel | undefined> {
  const html = await fetchText(pageUrl(id));
  // A 404 is an id the console has no page for (a route only the docs
  // publish). A page that answers and carries no model is a page that changed
  // shape, and `readPageValue` stops on it.
  if (html === undefined) return undefined;
  return pageModelSchema.parse(readPageValue(html, PAGE_MODEL_MARKER));
}

/**
 * The console catalog's rows, walked from documented pages only.
 *
 * `/explore` and the sitemap name one entry route per FAMILY or playground
 * preset; a route's own page then names every sibling in its `family` and a
 * set of `related_models`, and a preset's page names the model row under each
 * of its variants. Following all three to a fixed point reached all 108 rows
 * of the console catalog on 2026-11-24, plus two legacy paths and seven presets
 * the catalog does not list (docs/research/higgsfield-api-2026-11-24.md §10).
 * `seeds` adds the ids the docs name, so a route nothing links to is still
 * asked for.
 */
async function crawlPages(seeds: readonly string[]): Promise<Map<string, PageModel>> {
  const queue = new Set<string>(seeds);
  for (const path of EXPLORE_PATHS) {
    const rows = z.array(exploreRowSchema).parse(readPageValue(await fetchRequired(`${PAGE_BASE_URL}${path}`), PAGE_RESULTS_MARKER));
    for (const row of rows) {
      if (typeof row.workflow_slug === "string") queue.add(row.workflow_slug);
      if (typeof row.default_mode_id === "string") queue.add(row.default_mode_id);
      for (const entry of row.entry_points ?? []) queue.add(entry.mode_id);
    }
  }
  for (const entry of (await fetchRequired(SITEMAP_URL)).matchAll(/\/models\/([^<]+?)\/playground</g)) queue.add(entry[1] as string);
  const visited = new Set<string>();
  const found = new Map<string, PageModel>();
  while (queue.size > 0) {
    const batch = sorted(queue).filter((id) => !visited.has(id));
    queue.clear();
    const models = await mapPooled(batch, fetchPageModel);
    batch.forEach((id, index) => {
      visited.add(id);
      const model = models[index];
      if (model === undefined) return;
      if (model.route_slug !== id) throw new Error(`${pageUrl(id)} renders the route ${model.route_slug}`);
      found.set(id, model);
      const linked = [...model.family, ...model.related_models].map((row) => row.slug);
      for (const variant of model.workflow?.variants ?? []) linked.push(variant.route_slug, variant.model_slug);
      for (const slug of linked) {
        if (!visited.has(slug)) queue.add(slug);
      }
    });
  }
  return found;
}

/** The text between a heading line and the next heading of the same or a higher level. */
function markdownSection(markdown: string, heading: string): string | undefined {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start < 0) return undefined;
  const level = heading.split(" ")[0] as string;
  const rest = markdown.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level.length}} `, "m"));
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function firstJsonFence(markdown: string, where: string): Schema {
  const open = /```json[^\n]*\n/.exec(markdown);
  if (open === null) throw new Error(`${where}: no \`\`\`json block`);
  const close = markdown.indexOf("\n```", open.index + open[0].length);
  if (close < 0) throw new Error(`${where}: unterminated \`\`\`json block`);
  return jsonSchemaSchema.parse(JSON.parse(markdown.slice(open.index + open[0].length, close)));
}

type ConsoleSource = z.output<typeof consoleSourceSchema>;

/** Parses one console document. Every part read is a part `generate()` needs, so a missing one stops the refresh. */
export function parseConsoleDocument(id: string, text: string): ConsoleSource {
  const url = consoleUrl(id);
  const title = /^# (.+)$/m.exec(text)?.[1];
  const category = /^- \*\*Category\*\*: (.+)$/m.exec(text)?.[1];
  const pricing = markdownSection(text, "## Pricing");
  const schemaSection = markdownSection(text, "### Input JSON Schema");
  if (title === undefined || category === undefined || pricing === undefined || pricing === "" || schemaSection === undefined) {
    throw new Error(`${url}: missing one of the H1, "Category", "## Pricing" or "### Input JSON Schema"`);
  }
  return { url, title: title.trim(), category: category.trim(), input_schema: firstJsonFence(schemaSection, url), pricing };
}

type DocsSource = z.output<typeof docsSourceSchema>;

/**
 * Parses one docs workflow page into its route id and its `docs` block.
 *
 * The schema sits in an accordion, so the page prints it as a quoted block
 * (`> ` in front of every line); the prefix is stripped before parsing.
 */
export function parseDocsPage(url: string, category: "image" | "video", text: string): { id: string; docs: DocsSource } {
  const endpoint = /\*\*Endpoint:\*\* `(\w+) https:\/\/api\.higgsfield\.ai\/([^`]+)`/.exec(text);
  const title = /^# (.+?)(?: API)?$/m.exec(text)?.[1];
  const accordion = text.indexOf("Complete JSON schema");
  if (endpoint === null || title === undefined || accordion < 0) {
    throw new Error(`${url}: missing one of the H1, "**Endpoint:**" or "Complete JSON schema"`);
  }
  const unquoted = text
    .slice(accordion)
    .split("\n")
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n");
  const notes = markdownSection(text, "## Usage notes") ?? "";
  return {
    id: endpoint[2] as string,
    docs: docsSourceSchema.parse({
      url,
      category,
      title,
      method: endpoint[1],
      catalog_id: /\*\*Catalog ID:\*\* `([^`]+)`/.exec(text)?.[1] ?? null,
      schema: firstJsonFence(unquoted, url),
      usage_notes: notes
        .split("\n")
        .filter((line) => line.startsWith("* "))
        .map((line) => line.slice(2).trim()),
    }),
  };
}

/**
 * Every docs workflow page, by route id.
 *
 * `docs/llms.txt` lists every page; a workflow page is one two levels under
 * `models/`. Each category index states how many "catalog entries" it has, and
 * the pages found must add up to exactly that, so a page the index stopped
 * listing cannot go missing quietly.
 */
async function fetchDocs(): Promise<Map<string, DocsSource>> {
  const index = await fetchRequired(DOCS_INDEX_URL);
  const workflowPages = sorted(new Set(index.match(/https:\/\/docs\.higgsfield\.ai\/docs\/models\/[^/)\s]+\/[^/)\s]+\.md/g) ?? []));
  const familyCategory = new Map<string, "image" | "video">();
  let stated = 0;
  for (const [category, page] of Object.entries(DOCS_CATEGORY_PAGES) as Array<["image" | "video", string]>) {
    const text = await fetchRequired(`${DOCS_BASE_URL}/models/${page}.md`);
    const entries = /\*\*(\d+) catalog entries\*\*/.exec(text);
    if (entries === null) throw new Error(`${page}.md no longer states its catalog entry count`);
    stated += Number(entries[1]);
    for (const link of text.match(/https:\/\/docs\.higgsfield\.ai\/docs\/models\/[^/)\s]+\.md/g) ?? []) {
      const family = link.slice(`${DOCS_BASE_URL}/models/`.length, -".md".length);
      if (family !== page) familyCategory.set(family, category);
    }
  }
  if (workflowPages.length !== stated) {
    throw new Error(`docs: llms.txt lists ${workflowPages.length} workflow pages, the category indexes state ${stated} catalog entries`);
  }
  const found = new Map<string, DocsSource>();
  const parsed = await mapPooled(workflowPages, async (url) => {
    const family = url.slice(`${DOCS_BASE_URL}/models/`.length).split("/")[0] as string;
    const category = familyCategory.get(family);
    if (category === undefined) throw new Error(`${url}: its family is on neither category index`);
    return parseDocsPage(url, category, await fetchRequired(url));
  });
  for (const { id, docs } of parsed) {
    if (found.has(id)) throw new Error(`docs: two pages document ${id}`);
    found.set(id, docs);
  }
  return found;
}

interface FetchedSnapshot {
  /** file name under `routes/` → exact bytes. */
  routes: Map<string, string>;
  manifest: string;
  openapi: string;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/**
 * Fetches the three sources and joins them by route id.
 *
 * A console row whose docs page states a different path as its endpoint
 * ("**Catalog ID:** `soul-id`" on the `v1/custom-references` page) is joined
 * under the PATH: an id is something a caller can POST to. Page rows that are
 * `catalog_type: "workflow"` are playground presets over a model row and are
 * listed in the manifest, not snapshotted.
 */
async function fetchSnapshot(): Promise<FetchedSnapshot> {
  const docs = await fetchDocs();
  const catalogIdToRoute = new Map<string, string>();
  for (const [id, source] of docs) {
    if (source.catalog_id !== null) catalogIdToRoute.set(source.catalog_id, id);
  }
  const pages = await crawlPages([...docs.keys(), ...catalogIdToRoute.keys()]);

  const workflows: string[] = [];
  const merged = new Map<string, RouteSnapshot>();
  for (const [id, source] of docs) merged.set(id, { id, console: null, page: null, docs: source });

  const modelPages = [...pages].filter(([slug, model]) => {
    if (model.catalog_type === "workflow") workflows.push(slug);
    else if (model.catalog_type !== "model") throw new Error(`${pageUrl(slug)}: unknown catalog_type ${model.catalog_type}`);
    return model.catalog_type === "model";
  });
  const consoleTexts = await mapPooled(modelPages, ([slug]) => fetchText(consoleUrl(slug)));
  modelPages.forEach(([slug, model], index) => {
    const id = catalogIdToRoute.get(slug) ?? slug;
    const text = consoleTexts[index];
    const consoleSource = text === undefined ? null : parseConsoleDocument(slug, text);
    if (consoleSource !== null) {
      // The page renders the schema the console document prints. Two copies
      // that disagree are a third source nobody has reconciled.
      if (canonical(consoleSource.input_schema) !== canonical(model.input_schema)) {
        throw new Error(`${slug}: ${consoleUrl(slug)} and ${pageUrl(slug)} publish different input schemas`);
      }
      if ((model.pricing_description ?? CONSOLE_NO_PRICING) !== consoleSource.pricing) {
        throw new Error(`${slug}: ${consoleUrl(slug)} and ${pageUrl(slug)} publish different pricing paragraphs`);
      }
    }
    const row = merged.get(id) ?? { id, console: null, page: null, docs: null };
    row.console = consoleSource;
    row.page = {
      url: pageUrl(slug),
      title: model.title,
      variant_title: model.variant_title,
      description: model.description,
      company: model.company.slug,
      output_type: model.output_type,
      operation_type: model.operation_type,
      input_types: model.overview.input_types,
      availability_state: model.availability_state,
      released_on: model.overview.released_on,
      related_models_description: model.related_models_description,
    };
    merged.set(id, row);
  });

  const routes = new Map<string, string>();
  const manifestRows: Record<string, unknown> = {};
  for (const id of sorted(merged.keys())) {
    const row = routeSnapshotSchema.parse(merged.get(id));
    const body = serialize(row);
    const file = snapshotFileName(id);
    routes.set(file, body);
    manifestRows[id] = {
      file: `routes/${file}`,
      console: row.console !== null,
      page: row.page !== null,
      docs: row.docs !== null,
      sha256: sha256(body),
    };
  }
  const manifest = serialize({
    $comment: [
      "GENERATED by `bun scripts/codegen-higgsfield.ts --refresh` — DO NOT EDIT.",
      "One row per route: where its snapshot lives, which of the three documented sources publish it, and the",
      "sha256 of the exact snapshot bytes. `workflows` are the console's playground presets: each is a page over a",
      "model row, not a route of its own, so it is listed here and not snapshotted.",
    ],
    routes: manifestRows,
    workflows: sorted(workflows),
  });
  const openapi = serialize(JSON.parse(await fetchRequired(OPENAPI_URL)));
  return { routes, manifest, openapi };
}

async function committedRouteFiles(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    return (await readdir(ROUTES_DIR)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function refresh(): Promise<void> {
  const snapshot = await fetchSnapshot();
  const { mkdir, rm } = await import("node:fs/promises");
  await mkdir(ROUTES_DIR, { recursive: true });
  for (const name of await committedRouteFiles()) {
    if (!snapshot.routes.has(name)) {
      await rm(`${ROUTES_DIR}${name}`);
      console.log(`Removed ${name}: no documented source lists the route any more`);
    }
  }
  for (const [name, body] of snapshot.routes) await Bun.write(`${ROUTES_DIR}${name}`, body);
  await Bun.write(MANIFEST_PATH, snapshot.manifest);
  await Bun.write(OPENAPI_PATH, snapshot.openapi);
  console.log(`Wrote ${snapshot.routes.size} route snapshots, manifest.json and openapi.json into data/higgsfield/`);
}

/**
 * Re-fetches everything and compares it with what is committed, writing
 * nothing. Scheduled, never per-commit: it needs the network, and a provider
 * outage must not be able to fail an unrelated pull request.
 */
async function check(): Promise<void> {
  const snapshot = await fetchSnapshot();
  const committed = new Set(await committedRouteFiles());
  const problems: string[] = [];
  for (const [name, body] of snapshot.routes) {
    if (!committed.has(name)) problems.push(`added: routes/${name}`);
    else if ((await Bun.file(`${ROUTES_DIR}${name}`).text()) !== body) problems.push(`changed: routes/${name}`);
  }
  for (const name of committed) {
    if (!snapshot.routes.has(name)) problems.push(`removed: routes/${name}`);
  }
  if ((await Bun.file(MANIFEST_PATH).text()) !== snapshot.manifest) problems.push("changed: manifest.json");
  if ((await Bun.file(OPENAPI_PATH).text()) !== snapshot.openapi) problems.push("changed: openapi.json");
  if (problems.length === 0) {
    console.log("Higgsfield's documented sources match the committed snapshot.");
    return;
  }
  console.error(`Drifted from the live documents:\n  ${problems.join("\n  ")}`);
  console.error("Run `bun scripts/codegen-higgsfield.ts --refresh` and review the diff.");
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Missing ${path}`);
  return file.json();
}

/** Every committed route snapshot, keyed by the id its file name encodes. */
async function loadRoutes(): Promise<Record<string, unknown>> {
  const routes: Record<string, unknown> = {};
  for (const name of await committedRouteFiles()) {
    routes[name.slice(0, -".json".length).replace(/__/g, "/")] = await readJson(`${ROUTES_DIR}${name}`);
  }
  return routes;
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) return check();
  if (process.argv.includes("--refresh")) await refresh();

  const files = generate({
    routes: await loadRoutes(),
    curation: await readJson(CURATION_PATH),
    overlays: await readJson(OVERLAYS_PATH),
    pricing: await readJson(PRICING_PATH),
  });
  const bytes = [...files.values()].reduce((total, content) => total + content.length, 0);
  console.log(`data/higgsfield/ lowers to ${files.size} files (${Math.round(bytes / 1024)} KiB): ${[...files.keys()].join(", ")}`);
}

if (import.meta.main) {
  await main();
}
