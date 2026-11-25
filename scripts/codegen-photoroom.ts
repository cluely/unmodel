/**
 * Generates Photoroom's form-field tables from Photoroom's OWN published
 * OpenAPI document, plus one hand-maintained input for what the document
 * cannot say.
 *
 *   bun run codegen:photoroom           regenerate src/providers/photoroom/gen/** from data/photoroom/
 *   bun run codegen:photoroom:refresh   re-fetch the keyless snapshot first, then regenerate
 *   bun run codegen:photoroom:check     re-fetch and compare against the committed snapshot (network; no writes)
 *
 * ## Why two endpoints get a generator
 *
 * Not for their number — for where their facts live. `POST /v2/edit` is one
 * route with 86 multipart properties, and the document types those properties
 * with `type` and `description` only: every enum, range, default and pattern
 * is on the 87 query parameters of `GET /v2/edit` instead ("Both endpoints
 * accept the same parameters"). Typing the POST body is therefore a JOIN of two
 * lists, and five of the parameters are objects or arrays on paper and dotted
 * leaves on the wire, so the join yields well over a hundred form keys. A hand
 * transcription of that is ~400 facts nobody would re-derive at a refresh.
 *
 * And the surface is promised to move: three features ship under "breaking
 * changes with a 2-week notice period", and an unknown field is today ignored
 * with a 200 — which makes a stale hand table invisible. A committed snapshot
 * turns the next change into a diff.
 *
 * ## The thesis, the same one `scripts/codegen-fal.ts` states
 *
 * **The generator emits DATA and TYPES-AS-DATA; hand code owns BEHAVIOUR.**
 * Three files per route, and none contains a check, a message about two fields
 * at once, an estimate or a `createValidator`:
 *
 *   • `<route>-wire.gen.ts`   — the form's TypeScript interfaces (type-only).
 *   • `<route>-fields.gen.ts` — the same rows as data: enums, ranges, defaults.
 *   • `<route>-schema.gen.ts` — one zod LEAF per field. Not a `z.object`: the
 *     form has open-keyed families, so `src/providers/photoroom/shared.ts`
 *     routes each key to its leaf.
 *
 * ## Lowering — the whole logic
 *
 * A schema becomes one or more LEAVES, each a form key:
 *
 *   • an object with `properties`            → `<name>.<property>`, recursively
 *   • an object with schema-valued
 *     `additionalProperties`                 → the family `<name>.{key}`, recursively
 *   • an array                               → the family `<name>[]`, recursing into `items`
 *   • a parameter NAME carrying `{key}`      → a family, split at the placeholder
 *   • `anyOf` of objects                     → every arm's leaves
 *   • `anyOf` of string constants + objects  → an enum leaf at `<name>` AND the objects' leaves
 *   • `anyOf [number, string enum]`          → one `numberOrEnum` leaf
 *   • `type: ["number", "string"]`           → one `numberOrString` leaf
 *   • `const`                                → a one-member enum
 *
 * **Nested `required` is dropped, on purpose.** The document marks members
 * required inside eleven nested objects (`virtualModel.model.preset` requires
 * `name`; a layer's `imageFromPrompt` requires `prompt`). On a flat form there
 * is no object whose presence could trigger the requirement — only sibling
 * keys — so the constraint has no faithful leaf-level form, and inventing one
 * ("`….seed` needs `….prompt`") would be a rule Photoroom never wrote. A
 * `required` at the level of a whole parameter or of the form itself IS
 * modelled: on `/v1/segment` it becomes `req`, and on `/v2/edit`, where the
 * document has none, it stops the generator.
 *
 * ## Loud failure
 *
 * Output is a pure function of the two committed inputs: no clock, no network,
 * everything sorted. Every construct this script does not model is a HARD
 * ERROR naming the parameter — a schema keyword outside the list above, a
 * `format` it has not seen, a name on one of the two operations and not the
 * other with no recorded decision, an array family whose index spelling
 * nobody wrote down, two families a key could match at once, and an overlay
 * entry that no longer matches anything. A spec change must fail codegen, never
 * fall through to a default.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { num, quote, renderStringArray, sortKeysDeep } from "./emit";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** Keyless. `openapi: 3.1.0`; it is also what the rendered reference embeds, lossily. */
const OPENAPI_URL = "https://image-api.photoroom.com/openapi";

const DATA_DIR = new URL("../data/photoroom/", import.meta.url).pathname;
const OPENAPI_PATH = `${DATA_DIR}openapi.json`;
const SNAPSHOT_PATH = `${DATA_DIR}snapshot.json`;
const OVERLAYS_PATH = `${DATA_DIR}overlays.json`;
const GEN_DIR = new URL("../src/providers/photoroom/gen/", import.meta.url).pathname;

const EDIT_PATH = "/v2/edit";
const SEGMENT_PATH = "/v1/segment";
const SEGMENT_SCHEMA = "remove-background-post-params";

// ---------------------------------------------------------------------------
// The hand input
// ---------------------------------------------------------------------------

const provenance = {
  reason: z.string().min(1),
  source: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

const provenanceSchema = z.strictObject(provenance);

const overlaysSchema = z.strictObject({
  $comment: z.array(z.string()).optional(),
  getOnly: z.record(
    z.string(),
    z.strictObject({ typed: z.boolean(), unverified: z.string().min(1).optional(), ...provenance }),
  ),
  families: z.record(
    z.string(),
    z.strictObject({
      notations: z.array(z.enum(["map", "index", "any"])).min(1),
      unverified: z.string().min(1).optional(),
      ...provenance,
    }),
  ),
  booleans: z.strictObject({ acceptStrings: z.boolean(), ...provenance }),
  deprecated: z.record(z.string(), provenanceSchema),
  deprecatedValues: z.record(
    z.string(),
    z.strictObject({ values: z.array(z.string().min(1)).min(1), ...provenance }),
  ),
  preview: z.record(z.string(), provenanceSchema),
});

type Overlays = z.infer<typeof overlaysSchema>;

export interface GenerateInput {
  openapi: unknown;
  overlays: unknown;
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

type FieldType = "string" | "number" | "boolean" | "blob" | "numberOrString" | "numberOrEnum";
type Notation = "map" | "index" | "any";

/** The two ways the document marks a slot the caller fills in. */
const KEY_SLOT = "{key}";
const INDEX_SLOT = "[]";

/** One form key, or — when `path` carries a slot — one member of a family. */
export interface Leaf {
  /** The wire key; a family keeps the document's own spelling of its slot. */
  path: string;
  t: FieldType;
  req?: true;
  enum?: string[];
  min?: number;
  max?: number;
  xmin?: number;
  minLen?: number;
  pattern?: string;
  format?: "uuid";
  def?: string | number | boolean;
  maxItems?: number;
  description?: string;
  /** The retirement notice, from overlays. */
  deprecated?: string;
  /** Members of `enum` Photoroom has retired, and the notice — from overlays. */
  deprecatedValues?: { values: string[]; reason: string };
  /** Where the preview notice is published, from overlays. */
  preview?: string;
  /** What has not been confirmed against a live key, from overlays. */
  unverified?: string;
  /** Family only. */
  prefix?: string;
  suffix?: string;
  notations?: Notation[];
}

export interface Lowered {
  /** Leaves with a fixed key, sorted by key. */
  fixed: Leaf[];
  /** Family members, sorted by path. */
  families: Leaf[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Json {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return value;
}

/** Every keyword a schema in the two modelled routes may carry. Anything else stops the generator. */
const SCHEMA_KEYWORDS = new Set([
  "type",
  "enum",
  "const",
  "anyOf",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "required",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "minLength",
  "pattern",
  "format",
  "default",
  // Documentation only.
  "description",
  "examples",
  "title",
]);

function assertKeywords(schema: Json, where: string): void {
  for (const keyword of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.has(keyword)) {
      throw new Error(`${where}: schema keyword \`${keyword}\` is not modelled by codegen-photoroom`);
    }
  }
}

function slotCount(path: string): number {
  return path.split(KEY_SLOT).length - 1 + (path.split(INDEX_SLOT).length - 1);
}

function optionalNumber(schema: Json, keyword: string, where: string): number | undefined {
  const value = schema[keyword];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error(`${where}: \`${keyword}\` is not a number`);
  return value;
}

function stringEnum(schema: Json, where: string): string[] | undefined {
  if (schema.const !== undefined) {
    if (typeof schema.const !== "string") throw new Error(`${where}: a non-string \`const\``);
    return [schema.const];
  }
  if (schema.enum === undefined) return undefined;
  if (!Array.isArray(schema.enum) || schema.enum.some((v) => typeof v !== "string")) {
    throw new Error(`${where}: \`enum\` is not a list of strings`);
  }
  return [...(schema.enum as string[])];
}

function describe(schema: Json, inherited: string | undefined): string | undefined {
  return typeof schema.description === "string" ? schema.description : inherited;
}

/** Lowers one scalar schema to a leaf. */
function lowerScalar(path: string, schema: Json, description: string | undefined): Leaf {
  const where = `\`${path}\``;
  const leaf: Leaf = { path, t: "string" };
  const doc = describe(schema, description);
  if (doc !== undefined) leaf.description = doc;

  const type = schema.type;
  if (Array.isArray(type)) {
    if ([...type].sort().join("|") !== "number|string") {
      throw new Error(`${where}: the type union [${type.join(", ")}] is not modelled`);
    }
    leaf.t = "numberOrString";
  } else if (type === "boolean") {
    leaf.t = "boolean";
  } else if (type === "number") {
    leaf.t = "number";
    const min = optionalNumber(schema, "minimum", where);
    const max = optionalNumber(schema, "maximum", where);
    const xmin = optionalNumber(schema, "exclusiveMinimum", where);
    if (min !== undefined) leaf.min = min;
    if (max !== undefined) leaf.max = max;
    if (xmin !== undefined) leaf.xmin = xmin;
  } else if (type === "string") {
    const values = stringEnum(schema, where);
    if (values !== undefined) leaf.enum = values;
    if (schema.format === "binary") leaf.t = "blob";
    else if (schema.format === "uuid") leaf.format = "uuid";
    else if (schema.format !== undefined) {
      throw new Error(`${where}: the string format \`${String(schema.format)}\` is not modelled`);
    }
    const minLen = optionalNumber(schema, "minLength", where);
    if (minLen !== undefined) leaf.minLen = minLen;
    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== "string") throw new Error(`${where}: \`pattern\` is not a string`);
      leaf.pattern = schema.pattern;
    }
  } else {
    throw new Error(`${where}: the schema type \`${JSON.stringify(type)}\` is not modelled`);
  }

  const fallback = schema.default;
  if (fallback !== undefined) {
    if (typeof fallback !== "string" && typeof fallback !== "number" && typeof fallback !== "boolean") {
      throw new Error(`${where}: a non-scalar \`default\` on a scalar field`);
    }
    leaf.def = fallback;
  }
  return leaf;
}

function isObjectSchema(schema: Json): boolean {
  return schema.type === "object";
}

/** `{ preset: { name: "avery" } }` → `[["<path>.preset.name", "avery"]]`. */
function flattenDefault(path: string, value: unknown): Array<[string, unknown]> {
  if (!isRecord(value)) return [[path, value]];
  return Object.entries(value).flatMap(([key, inner]) => flattenDefault(`${path}.${key}`, inner));
}

/**
 * Lowers one schema to its leaves, appending to `out`.
 *
 * `description` is what a leaf inherits when its own schema carries none — the
 * parameter-level description, for a parameter that IS a scalar.
 */
export function lowerSchema(
  path: string,
  schemaInput: unknown,
  description: string | undefined,
  out: Leaf[],
): void {
  const where = `\`${path}\``;
  const schema = record(schemaInput, where);
  assertKeywords(schema, where);
  const first = out.length;

  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      throw new Error(`${where}: \`anyOf\` is not a non-empty list`);
    }
    const arms = schema.anyOf.map((arm, i) => record(arm, `${where} anyOf[${i}]`));
    const objects = arms.filter(isObjectSchema);
    const scalars = arms.filter((arm) => !isObjectSchema(arm));
    const [left, right] = scalars;

    if (
      objects.length === 0 &&
      scalars.length === 2 &&
      left?.type === "number" &&
      right?.type === "string" &&
      stringEnum(right, where) !== undefined
    ) {
      // `anyOf [number, string enum]` — an angle, or a named preset.
      assertKeywords(left, where);
      assertKeywords(right, where);
      const leaf: Leaf = { path, t: "numberOrEnum", enum: stringEnum(right, where) as string[] };
      const doc = describe(schema, description);
      if (doc !== undefined) leaf.description = doc;
      out.push(leaf);
    } else if (objects.length > 0 && scalars.every((arm) => typeof arm.const === "string")) {
      if (scalars.length > 0) {
        for (const arm of scalars) assertKeywords(arm, where);
        const leaf: Leaf = { path, t: "string", enum: scalars.map((arm) => arm.const as string) };
        const doc = describe(schema, description);
        if (doc !== undefined) leaf.description = doc;
        out.push(leaf);
      }
      for (const arm of objects) lowerSchema(path, arm, undefined, out);
    } else {
      throw new Error(`${where}: this \`anyOf\` shape is not modelled`);
    }
  } else if (schema.type === "object") {
    const properties = schema.properties;
    const additional = schema.additionalProperties;
    if (properties === undefined && !isRecord(additional)) {
      throw new Error(`${where}: an object with neither \`properties\` nor a schema for its keys`);
    }
    if (properties !== undefined) {
      for (const [name, inner] of Object.entries(record(properties, where))) {
        lowerSchema(`${path}.${name}`, inner, undefined, out);
      }
    }
    if (isRecord(additional)) lowerSchema(`${path}.${KEY_SLOT}`, additional, undefined, out);
  } else if (schema.type === "array") {
    if (!isRecord(schema.items)) throw new Error(`${where}: an array without an \`items\` schema`);
    const maxItems = optionalNumber(schema, "maxItems", where);
    const before = out.length;
    lowerSchema(`${path}${INDEX_SLOT}`, schema.items, undefined, out);
    if (maxItems !== undefined) for (const leaf of out.slice(before)) leaf.maxItems = maxItems;
  } else {
    out.push(lowerScalar(path, schema, description));
    return;
  }

  // A default on a composite is an object; it belongs to the leaves it names.
  if (schema.default !== undefined) {
    for (const [target, value] of flattenDefault(path, schema.default)) {
      const leaf = out.slice(first).find((candidate) => candidate.path === target);
      if (leaf === undefined) throw new Error(`${where}: its \`default\` names \`${target}\`, which is not a field`);
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error(`${where}: its \`default\` for \`${target}\` is not a scalar`);
      }
      leaf.def = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/** Splits a slotted path into the family's prefix and suffix. */
function splitFamily(path: string): { prefix: string; suffix: string; slot: string } {
  if (slotCount(path) !== 1) {
    throw new Error(`\`${path}\`: a field with more than one caller-filled slot is not modelled`);
  }
  const slot = path.includes(KEY_SLOT) ? KEY_SLOT : INDEX_SLOT;
  const at = path.indexOf(slot);
  const head = path.slice(0, at);
  return {
    // `a.{key}.b` → prefix `a`; `a[].b` → prefix `a`.
    prefix: slot === KEY_SLOT ? head.replace(/\.$/, "") : head,
    suffix: path.slice(at + slot.length),
    slot,
  };
}

/** The same rule `src/providers/photoroom/shared.ts` applies at run time, for the collision checks. */
function familyAccepts(leaf: Leaf, key: string): boolean {
  const { prefix, suffix, notations } = leaf as Required<Pick<Leaf, "prefix" | "suffix" | "notations">>;
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return false;
  const middle = key.slice(prefix.length, key.length - suffix.length);
  if (middle.length + prefix.length + suffix.length !== key.length) return false;
  return notations.some((notation) =>
    notation === "map"
      ? /^\..+$/.test(middle)
      : notation === "index"
        ? /^(\[\d+\]|\.\d+)$/.test(middle)
        : /^(?:\[|\.).+$/.test(middle),
  );
}

/** One key for each notation a family takes, to probe for a second family that would also claim it. */
function sampleKeys(leaf: Leaf): string[] {
  const { prefix, suffix, notations } = leaf as Required<Pick<Leaf, "prefix" | "suffix" | "notations">>;
  return notations.flatMap((notation) =>
    notation === "map"
      ? [`${prefix}.name${suffix}`]
      : notation === "index"
        ? [`${prefix}[0]${suffix}`, `${prefix}.0${suffix}`]
        : [`${prefix}[0]${suffix}`, `${prefix}.0${suffix}`, `${prefix}[]${suffix}`],
  );
}

function assignFamilies(leaves: Leaf[], overlays: Overlays, used: Set<string>): Lowered {
  const fixed: Leaf[] = [];
  const families: Leaf[] = [];
  for (const leaf of leaves) {
    if (slotCount(leaf.path) === 0) {
      fixed.push(leaf);
      continue;
    }
    const { prefix, suffix, slot } = splitFamily(leaf.path);
    const overlay = overlays.families[prefix];
    if (overlay !== undefined) used.add(`families.${prefix}`);
    if (overlay === undefined && slot === INDEX_SLOT) {
      throw new Error(
        `\`${leaf.path}\`: an array family, and the OpenAPI document does not say how an index is ` +
          "written in a form key. Record its notations (with reason, source and date) under " +
          "`families` in data/photoroom/overlays.json.",
      );
    }
    leaf.prefix = prefix;
    leaf.suffix = suffix;
    leaf.notations = overlay?.notations ?? ["map"];
    if (overlay?.unverified !== undefined) leaf.unverified = overlay.unverified;
    families.push(leaf);
  }

  for (const family of families) {
    for (const key of sampleKeys(family)) {
      const claimants = families.filter((other) => familyAccepts(other, key));
      if (claimants.length > 1) {
        throw new Error(
          `the form key \`${key}\` would match ${claimants.map((c) => `\`${c.path}\``).join(" and ")}; ` +
            "two families a key can belong to at once cannot be routed",
        );
      }
    }
  }
  for (const leaf of fixed) {
    const claimant = families.find((family) => familyAccepts(family, leaf.path));
    if (claimant !== undefined) {
      throw new Error(`the fixed field \`${leaf.path}\` also matches the family \`${claimant.path}\``);
    }
  }

  const byPath = (a: Leaf, b: Leaf): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { fixed: fixed.sort(byPath), families: families.sort(byPath) };
}

function assertNoDuplicates(leaves: Leaf[]): void {
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (seen.has(leaf.path)) throw new Error(`\`${leaf.path}\` was lowered twice`);
    seen.add(leaf.path);
  }
}

// ---------------------------------------------------------------------------
// POST /v2/edit
// ---------------------------------------------------------------------------

/** `upscale.*` names a dotted group; any other key names one field. */
function overlayMatches(key: string, path: string): boolean {
  return key.endsWith(".*") ? path.startsWith(key.slice(0, -1)) : path === key;
}

interface EditOperations {
  get: Map<string, Json>;
  post: Map<string, Json>;
}

function readEditOperations(openapi: Json): EditOperations {
  const paths = record(openapi.paths, "paths");
  const edit = record(paths[EDIT_PATH], `paths["${EDIT_PATH}"]`);

  const getOp = record(edit.get, `GET ${EDIT_PATH}`);
  if (!Array.isArray(getOp.parameters)) throw new Error(`GET ${EDIT_PATH}: no \`parameters\` list`);
  const get = new Map<string, Json>();
  for (const raw of getOp.parameters) {
    const parameter = record(raw, `GET ${EDIT_PATH} parameter`);
    const name = parameter.name;
    if (typeof name !== "string") throw new Error(`GET ${EDIT_PATH}: a parameter without a name`);
    if (parameter.in !== "query") {
      throw new Error(`GET ${EDIT_PATH} \`${name}\`: expected a query parameter, got \`in: ${String(parameter.in)}\``);
    }
    if (parameter.required === true) {
      throw new Error(
        `GET ${EDIT_PATH} \`${name}\` is now \`required\`. Nothing on this route has been required before, ` +
          "so the generated table has no way to say so — model it before regenerating.",
      );
    }
    get.set(name, parameter);
  }

  const postOp = record(edit.post, `POST ${EDIT_PATH}`);
  const content = record(record(postOp.requestBody, `POST ${EDIT_PATH} requestBody`).content, "content");
  const types = Object.keys(content);
  if (types.length !== 1 || types[0] !== "multipart/form-data") {
    throw new Error(
      `POST ${EDIT_PATH} now declares the content types [${types.join(", ")}]; this generator models ` +
        "`multipart/form-data` and nothing else",
    );
  }
  const form = record(record(content["multipart/form-data"], "multipart/form-data").schema, "form schema");
  for (const keyword of Object.keys(form)) {
    if (keyword !== "type" && keyword !== "properties" && keyword !== "required") {
      throw new Error(`POST ${EDIT_PATH}: form schema keyword \`${keyword}\` is not modelled`);
    }
  }
  if (Array.isArray(form.required) && form.required.length > 0) {
    throw new Error(
      `POST ${EDIT_PATH} now marks [${(form.required as unknown[]).join(", ")}] required. Nothing on this ` +
        "route has been required before — model it before regenerating.",
    );
  }
  const post = new Map<string, Json>();
  for (const [name, schema] of Object.entries(record(form.properties, "form properties"))) {
    post.set(name, record(schema, `POST ${EDIT_PATH} \`${name}\``));
  }
  return { get, post };
}

/**
 * The POST property and the GET parameter of one name must not disagree about
 * the scalar they describe — the GET schema is used for the POST field on the
 * strength of "the same parameters", and this is where that would stop being
 * true.
 */
function assertSameScalar(name: string, post: Json, get: Json): void {
  if (post.type === undefined || get.type === undefined) return;
  const same =
    JSON.stringify(post.type) === JSON.stringify(get.type) && post.format === get.format;
  if (!same) {
    throw new Error(
      `\`${name}\`: POST ${EDIT_PATH} types it ${JSON.stringify({ type: post.type, format: post.format })} ` +
        `and GET types it ${JSON.stringify({ type: get.type, format: get.format })}`,
    );
  }
}

export function lowerEdit(openapi: Json, overlays: Overlays, used: Set<string>): Lowered {
  const { get, post } = readEditOperations(openapi);

  const names = new Set(post.keys());
  for (const name of get.keys()) {
    if (post.has(name)) continue;
    const decision = overlays.getOnly[name];
    if (decision === undefined) {
      throw new Error(
        `\`${name}\` is listed on GET ${EDIT_PATH} and not on POST. Decide whether POST types it and ` +
          "record the decision (with reason, source and date) under `getOnly` in data/photoroom/overlays.json.",
      );
    }
    used.add(`getOnly.${name}`);
    if (decision.typed) names.add(name);
  }

  const leaves: Leaf[] = [];
  for (const name of [...names].sort()) {
    const parameter = get.get(name);
    const property = post.get(name);
    if (parameter !== undefined && property !== undefined) {
      assertSameScalar(name, property, record(parameter.schema, `GET \`${name}\` schema`));
    }
    const schema = parameter !== undefined ? parameter.schema : property;
    const description =
      typeof parameter?.description === "string"
        ? parameter.description
        : typeof property?.description === "string"
          ? property.description
          : undefined;
    const before = leaves.length;
    lowerSchema(name, schema, description, leaves);
    const unverified = overlays.getOnly[name]?.unverified;
    if (unverified !== undefined) for (const leaf of leaves.slice(before)) leaf.unverified = unverified;
  }
  assertNoDuplicates(leaves);

  for (const [key, entry] of Object.entries(overlays.deprecated)) {
    for (const leaf of leaves) {
      if (!overlayMatches(key, leaf.path)) continue;
      leaf.deprecated = entry.reason;
      used.add(`deprecated.${key}`);
    }
  }
  for (const [key, entry] of Object.entries(overlays.deprecatedValues)) {
    const leaf = leaves.find((candidate) => candidate.path === key);
    if (leaf === undefined) continue;
    const unknown = entry.values.filter((value) => !(leaf.enum ?? []).includes(value));
    if (unknown.length > 0) {
      throw new Error(
        `data/photoroom/overlays.json: \`deprecatedValues.${key}\` names ${unknown.map((v) => `"${v}"`).join(", ")}, ` +
          "which the snapshot no longer lists as a value of that field",
      );
    }
    leaf.deprecatedValues = { values: entry.values, reason: entry.reason };
    used.add(`deprecatedValues.${key}`);
  }
  for (const [key, entry] of Object.entries(overlays.preview)) {
    for (const leaf of leaves) {
      if (!overlayMatches(key, leaf.path)) continue;
      leaf.preview = entry.source;
      used.add(`preview.${key}`);
    }
  }
  return assignFamilies(leaves, overlays, used);
}

// ---------------------------------------------------------------------------
// POST /v1/segment
// ---------------------------------------------------------------------------

export function lowerSegment(openapi: Json): Lowered {
  const paths = record(openapi.paths, "paths");
  const postOp = record(record(paths[SEGMENT_PATH], `paths["${SEGMENT_PATH}"]`).post, `POST ${SEGMENT_PATH}`);
  const content = record(record(postOp.requestBody, "requestBody").content, "content");
  const form = record(content["multipart/form-data"], `POST ${SEGMENT_PATH} multipart/form-data`);
  const ref = record(form.schema, "form schema").$ref;
  if (ref !== `#/components/schemas/${SEGMENT_SCHEMA}`) {
    throw new Error(`POST ${SEGMENT_PATH}: its form schema is now \`${String(ref)}\`, not \`${SEGMENT_SCHEMA}\``);
  }
  const schemas = record(record(openapi.components, "components").schemas, "components.schemas");
  const schema = record(schemas[SEGMENT_SCHEMA], SEGMENT_SCHEMA);
  for (const keyword of Object.keys(schema)) {
    if (!["type", "title", "properties", "required"].includes(keyword)) {
      throw new Error(`${SEGMENT_SCHEMA}: schema keyword \`${keyword}\` is not modelled`);
    }
  }

  const leaves: Leaf[] = [];
  for (const [name, inner] of Object.entries(record(schema.properties, `${SEGMENT_SCHEMA}.properties`))) {
    lowerSchema(name, inner, undefined, leaves);
  }
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  for (const name of required) {
    const leaf = leaves.find((candidate) => candidate.path === name);
    if (leaf === undefined) throw new Error(`${SEGMENT_SCHEMA}: \`required\` names \`${String(name)}\`, which is not a field`);
    leaf.req = true;
  }
  assertNoDuplicates(leaves);
  const slotted = leaves.find((leaf) => slotCount(leaf.path) > 0);
  if (slotted !== undefined) throw new Error(`\`${slotted.path}\`: POST ${SEGMENT_PATH} has grown a family`);
  return { fixed: leaves.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), families: [] };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const HEADER = "// GENERATED by scripts/codegen-photoroom.ts from data/photoroom/ — do not edit.\n";

interface RouteSpec {
  /** File stem — the endpoint module's own name, so the three files sit beside what reads them. */
  stem: string;
  /** `Edit` / `Segment` — the wire's own word, for the generated identifiers. */
  wireName: string;
  constName: string;
  route: string;
  /** Whether a boolean field also takes `"true"` / `"false"`. */
  booleanStrings: boolean;
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name);
}

function literalUnion(values: readonly string[]): string {
  return values.map(quote).join(" | ");
}

/**
 * A field the document types as the string enum `"true" | "false"` — the two
 * switches of `/v1/segment`. It takes the JS boolean as well: `String(true)`
 * is the exact text the enum names, so the two are one form part.
 */
function isBooleanText(leaf: Leaf): boolean {
  return leaf.t === "string" && leaf.enum !== undefined && [...leaf.enum].sort().join("|") === "false|true";
}

/**
 * The type of a number written as text. A form part is text, and the
 * document's own `examples` write numbers quoted (`maxWidth: ["200"]`,
 * `background.guidance.scale: ["0.6"]`), so a numeric field takes both.
 */
const NUMBER_TEXT_TYPE = "`${number}`";

function tsType(leaf: Leaf, route: RouteSpec): string {
  switch (leaf.t) {
    case "blob":
      return "Blob";
    case "boolean":
      return route.booleanStrings ? 'boolean | "true" | "false"' : "boolean";
    case "number":
      return `number | ${NUMBER_TEXT_TYPE}`;
    case "numberOrString":
      return "number | string";
    case "numberOrEnum":
      return `number | ${NUMBER_TEXT_TYPE} | ${literalUnion(leaf.enum ?? [])}`;
    case "string":
      if (isBooleanText(leaf)) return `boolean | ${literalUnion(leaf.enum ?? [])}`;
      return leaf.enum === undefined ? "string" : literalUnion(leaf.enum);
  }
}

/** The first paragraph, on one line. Declaration weight is budgeted, and some descriptions run to 600 characters. */
function firstParagraph(description: string): string {
  const paragraph = description.trim().split(/\n\s*\n/)[0] ?? "";
  return paragraph.replace(/\s+/g, " ").trim();
}

function rangeText(leaf: Leaf): string | undefined {
  const parts: string[] = [];
  if (leaf.xmin !== undefined) parts.push(`greater than ${num(leaf.xmin)}`);
  if (leaf.min !== undefined) parts.push(`at least ${num(leaf.min)}`);
  if (leaf.max !== undefined) parts.push(`at most ${num(leaf.max)}`);
  if (leaf.minLen !== undefined) parts.push(`at least ${num(leaf.minLen)} character${leaf.minLen === 1 ? "" : "s"}`);
  if (leaf.maxItems !== undefined) parts.push(`at most ${num(leaf.maxItems)} entries`);
  return parts.length === 0 ? undefined : `Must be ${parts.join(", ")}.`;
}

function jsDoc(leaf: Leaf, indent: string): string[] {
  const lines: string[] = [];
  if (leaf.description !== undefined) {
    const text = firstParagraph(leaf.description);
    if (text.length > 0) lines.push(text);
  }
  if (leaf.req) lines.push("REQUIRED.");
  const range = rangeText(leaf);
  if (range !== undefined) lines.push(range);
  if (leaf.pattern !== undefined) lines.push(`Must match \`${leaf.pattern}\`.`);
  if (leaf.def !== undefined) lines.push(`Default \`${JSON.stringify(leaf.def)}\`.`);
  if (leaf.deprecatedValues !== undefined) {
    const { values, reason } = leaf.deprecatedValues;
    lines.push(`Deprecated ${values.length === 1 ? "value" : "values"} ${values.map((v) => `\`"${v}"\``).join(", ")}: ${reason}`);
  }
  if (leaf.preview !== undefined) lines.push(`Preview feature — ${leaf.preview}`);
  if (leaf.unverified !== undefined) lines.push(`Unverified: ${leaf.unverified}`);
  if (leaf.deprecated !== undefined) lines.push(`@deprecated ${leaf.deprecated}`);
  if (lines.length === 0) return [];
  const safe = lines.map((line) => line.replace(/\*\//g, "*\\/"));
  if (safe.length === 1) return [`${indent}/** ${safe[0]} */`];
  return [`${indent}/**`, ...safe.flatMap((line, i) => (i === 0 ? [`${indent} * ${line}`] : [`${indent} *`, `${indent} * ${line}`])), `${indent} */`];
}

/** The template-literal key patterns one family member is typed by. */
function familyPatterns(leaf: Leaf): string[] {
  const { prefix, suffix, notations } = leaf as Required<Pick<Leaf, "prefix" | "suffix" | "notations">>;
  const patterns: string[] = [];
  // `.<n>` is a `.<name>` as far as a template literal can tell, so "map" covers it.
  if (notations.includes("any")) {
    return [`\`${prefix}[\${string}${suffix}\``, `\`${prefix}.\${string}${suffix}\``];
  }
  if (notations.includes("map")) patterns.push(`\`${prefix}.\${string}${suffix}\``);
  if (notations.includes("index")) {
    patterns.push(`\`${prefix}[\${number}]${suffix}\``);
    if (!notations.includes("map")) patterns.push(`\`${prefix}.\${number}${suffix}\``);
  }
  return patterns;
}

function renderWire(route: RouteSpec, lowered: Lowered): string {
  const out: string[] = [HEADER];
  out.push(
    "/**",
    ` * \`${route.route}\` — the multipart form fields with a fixed name. Mirror the wire`,
    " * exactly: every key is the form field's own name, dots included.",
    " */",
    `export interface Photoroom${route.wireName}FixedFields {`,
  );
  for (const leaf of lowered.fixed) {
    out.push(...jsDoc(leaf, "  "));
    out.push(`  ${propertyKey(leaf.path)}${leaf.req ? "" : "?"}: ${tsType(leaf, route)};`);
  }
  out.push("}", "");

  if (lowered.families.length > 0) {
    out.push(
      "/**",
      ` * \`${route.route}\` — the open-keyed families: form fields whose name carries a`,
      " * slot the caller fills in. Mirror the wire exactly.",
      " *",
      " * A computed key in an object LITERAL widens to `string` and is refused; build",
      " * run-time keys by assignment onto a value already typed as the params.",
      " */",
      `export interface Photoroom${route.wireName}FamilyFields {`,
    );
    for (const leaf of lowered.families) {
      out.push(...jsDoc(leaf, "  "));
      for (const pattern of familyPatterns(leaf)) {
        out.push(`  [key: ${pattern}]: ${tsType(leaf, route)} | undefined;`);
      }
    }
    out.push("}", "");
  }
  return out.join("\n");
}

function renderSpecFields(leaf: Leaf): string[] {
  const fields = [`t: ${quote(leaf.t)}`];
  if (leaf.req) fields.push("req: true");
  if (leaf.enum !== undefined) fields.push(`enum: ${renderStringArray(leaf.enum)}`);
  if (leaf.xmin !== undefined) fields.push(`xmin: ${num(leaf.xmin)}`);
  if (leaf.min !== undefined) fields.push(`min: ${num(leaf.min)}`);
  if (leaf.max !== undefined) fields.push(`max: ${num(leaf.max)}`);
  if (leaf.minLen !== undefined) fields.push(`minLen: ${num(leaf.minLen)}`);
  if (leaf.pattern !== undefined) fields.push(`pattern: ${quote(leaf.pattern)}`);
  if (leaf.format !== undefined) fields.push(`format: ${quote(leaf.format)}`);
  if (leaf.def !== undefined) fields.push(`def: ${JSON.stringify(leaf.def)}`);
  if (leaf.deprecated !== undefined) fields.push("deprecated: true");
  if (leaf.deprecatedValues !== undefined) {
    fields.push(`deprecatedValues: ${renderStringArray(leaf.deprecatedValues.values)}`);
  }
  if (leaf.preview !== undefined) fields.push("preview: true");
  return fields;
}

function renderFields(route: RouteSpec, lowered: Lowered): string {
  const hasFamilies = lowered.families.length > 0;
  const out: string[] = [
    HEADER,
    `import type { ${hasFamilies ? "PhotoroomFamilySpec, " : ""}PhotoroomFieldSpec } from "../field-types";`,
    "",
    `/** \`${route.route}\` — every fixed form field, as the OpenAPI document constrains it. */`,
    `export const PHOTOROOM_${route.constName}_FIELDS = {`,
  ];
  for (const leaf of lowered.fixed) {
    out.push(`  ${propertyKey(leaf.path)}: { ${renderSpecFields(leaf).join(", ")} },`);
  }
  out.push("} as const satisfies Readonly<Record<string, PhotoroomFieldSpec>>;", "");

  if (hasFamilies) {
    out.push(
      "/**",
      ` * \`${route.route}\` — the open-keyed families, keyed by the document's own spelling`,
      " * of each (`{key}` for a name of the caller's choosing, `[]` for an array).",
      " */",
      `export const PHOTOROOM_${route.constName}_FAMILIES = {`,
    );
    for (const leaf of lowered.families) {
      const fields = [
        `prefix: ${quote(leaf.prefix as string)}`,
        `suffix: ${quote(leaf.suffix as string)}`,
        `notations: ${renderStringArray(leaf.notations as string[])}`,
        ...renderSpecFields(leaf),
      ];
      if (leaf.maxItems !== undefined) fields.push(`maxItems: ${num(leaf.maxItems)}`);
      out.push(`  ${quote(leaf.path)}: { ${fields.join(", ")} },`);
    }
    out.push("} as const satisfies Readonly<Record<string, PhotoroomFamilySpec>>;", "");
  }
  return out.join("\n");
}

/** `"a", "b"` — the allowed values, for a message. */
function listValues(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function errorOption(message: string): string {
  return `{ error: ${quote(message)} }`;
}

/** The zod expression for one leaf. Bare primitives are hoisted and named. */
function zodExpression(leaf: Leaf, route: RouteSpec): string {
  switch (leaf.t) {
    case "blob":
      return "blob";
    case "boolean":
      return route.booleanStrings ? "booleanOrString" : "boolean";
    case "numberOrString":
      return "numberOrString";
    case "numberOrEnum": {
      const values = leaf.enum ?? [];
      return `numeric(z.union([z.number(), z.enum(${renderStringArray(values)})], ${errorOption(`must be a number or one of ${listValues(values)}`)}))`;
    }
    case "number": {
      let expression = "number";
      if (leaf.xmin !== undefined) expression += `.gt(${num(leaf.xmin)}, ${errorOption(`must be greater than ${num(leaf.xmin)}`)})`;
      if (leaf.min !== undefined) expression += `.min(${num(leaf.min)}, ${errorOption(`must be at least ${num(leaf.min)}`)})`;
      if (leaf.max !== undefined) expression += `.max(${num(leaf.max)}, ${errorOption(`must be at most ${num(leaf.max)}`)})`;
      return `numeric(${expression})`;
    }
    case "string": {
      if (isBooleanText(leaf)) return "booleanOrString";
      if (leaf.enum !== undefined) {
        return `z.enum(${renderStringArray(leaf.enum)}, ${errorOption(`must be one of ${listValues(leaf.enum)}`)})`;
      }
      // `z.guid`, not `z.uuid`: the document says `format: uuid` and nothing
      // about a version or variant, which `z.uuid` would enforce.
      if (leaf.format === "uuid") return `z.guid(${errorOption("must be a UUID")})`;
      let expression = "string";
      if (leaf.minLen !== undefined) {
        expression += `.min(${num(leaf.minLen)}, ${errorOption(leaf.minLen === 1 ? "must not be empty" : `must be at least ${num(leaf.minLen)} characters`)})`;
      }
      if (leaf.pattern !== undefined) {
        expression += `.regex(new RegExp(${quote(leaf.pattern)}), ${errorOption(`must match ${leaf.pattern}`)})`;
      }
      return expression;
    }
  }
}

const PRIMITIVES: ReadonlyArray<readonly [string, string]> = [
  ["string", `z.string(${errorOption("must be a string")})`],
  ["number", `z.number(${errorOption("must be a finite number, or one written as text")})`],
  ["boolean", `z.boolean(${errorOption("must be a boolean")})`],
  ["blob", `z.instanceof(Blob, ${errorOption("must be a Blob — it is a file part of the multipart form")})`],
  [
    "booleanOrString",
    `z.union([z.boolean(), z.enum(["true", "false"])], ${errorOption('must be a boolean or the string "true" or "false"')})`,
  ],
  ["numberOrString", `z.union([z.number(), z.string()], ${errorOption("must be a number or a string")})`],
];

function renderSchema(route: RouteSpec, lowered: Lowered): string {
  const fixed = lowered.fixed.map((leaf) => [leaf, zodExpression(leaf, route)] as const);
  const families = lowered.families.map((leaf) => [leaf, zodExpression(leaf, route)] as const);
  const expressions = [...fixed, ...families].map(([, expression]) => expression);
  const usedPrimitives = PRIMITIVES.filter(([name]) =>
    expressions.some((expression) => new RegExp(String.raw`(^|\()${name}($|[.)])`).test(expression)),
  );
  const numericHelper = expressions.some((expression) => expression.startsWith("numeric("))
    ? [
        "",
        "// A numeric field takes the number, or the number written as text: a form part is text, and the",
        "// OpenAPI document's own `examples` write numbers quoted (`maxWidth: \"200\"`). The text is read as",
        "// the number it spells, so a bound applies to both; anything else falls through to the leaf's own",
        "// refusal. Decimal digits with an optional sign, fraction and exponent — what `String(number)` writes.",
        "const NUMBER_TEXT = /^[+-]?(\\d+\\.?\\d*|\\.\\d+)(e[+-]?\\d+)?$/i;",
        "function numeric(leaf: z.ZodType): z.ZodType {",
        '  return z.preprocess((value) => (typeof value === "string" && NUMBER_TEXT.test(value) ? Number(value) : value), leaf);',
        "}",
      ]
    : [];

  const out: string[] = [
    HEADER,
    'import { z } from "zod";',
    "",
    "// One zod LEAF per form field, and deliberately no `z.object` around them: the",
    "// form has open-keyed families, so `../shared.ts` routes each key to its leaf.",
    "// Each message completes the sentence \"`<field>` …\".",
    "",
    ...usedPrimitives.map(([name, expression]) => `const ${name} = ${expression};`),
    ...numericHelper,
    "",
    `export const PHOTOROOM_${route.constName}_FIELD_SCHEMAS = {`,
    ...fixed.map(([leaf, expression]) => `  ${propertyKey(leaf.path)}: ${expression},`),
    "};",
    "",
  ];
  if (families.length > 0) {
    out.push(
      `/** Keyed like \`PHOTOROOM_${route.constName}_FAMILIES\`, which says how each key's slot is written. */`,
      `export const PHOTOROOM_${route.constName}_FAMILY_SCHEMAS = {`,
      ...families.map(([leaf, expression]) => `  ${quote(leaf.path)}: ${expression},`),
      "};",
      "",
    );
  }
  const required = lowered.fixed.filter((leaf) => leaf.req).map((leaf) => leaf.path);
  if (required.length > 0) {
    out.push(
      "/** The fields the route refuses a request without. */",
      `export const PHOTOROOM_${route.constName}_REQUIRED = ${renderStringArray(required)} as const;`,
      "",
    );
  }
  return out.join("\n");
}

const EDIT_ROUTE: RouteSpec = {
  stem: "image-edit",
  wireName: "Edit",
  constName: "EDIT",
  route: `POST ${EDIT_PATH}`,
  booleanStrings: false,
};

const SEGMENT_ROUTE: RouteSpec = {
  stem: "image-edit-remove-background",
  wireName: "Segment",
  constName: "SEGMENT",
  route: `POST ${SEGMENT_PATH}`,
  booleanStrings: false,
};

/** Both routes, lowered — exported for the census the test pins. */
export function lower(input: GenerateInput): { edit: Lowered; segment: Lowered } {
  const openapi = record(input.openapi, "the OpenAPI document");
  const overlays = overlaysSchema.parse(input.overlays);
  const used = new Set<string>();
  const edit = lowerEdit(openapi, overlays, used);
  const segment = lowerSegment(openapi);

  // Anti-rot: an overlay that matches nothing is a claim about a wire that no longer exists.
  const declared = [
    ...Object.keys(overlays.getOnly).map((key) => `getOnly.${key}`),
    ...Object.keys(overlays.families).map((key) => `families.${key}`),
    ...Object.keys(overlays.deprecated).map((key) => `deprecated.${key}`),
    ...Object.keys(overlays.deprecatedValues).map((key) => `deprecatedValues.${key}`),
    ...Object.keys(overlays.preview).map((key) => `preview.${key}`),
  ];
  const stale = declared.filter((key) => !used.has(key));
  if (stale.length > 0) {
    throw new Error(
      `data/photoroom/overlays.json: ${stale.map((key) => `\`${key}\``).join(", ")} ` +
        `${stale.length === 1 ? "matches" : "match"} nothing in the snapshot. Remove the entry, or find out what moved.`,
    );
  }
  return { edit, segment };
}

/** Every generated file, by name. A pure function of its two inputs. */
export function generate(input: GenerateInput): Map<string, string> {
  const overlays = overlaysSchema.parse(input.overlays);
  const { edit, segment } = lower(input);
  const editRoute: RouteSpec = { ...EDIT_ROUTE, booleanStrings: overlays.booleans.acceptStrings };

  const files = new Map<string, string>();
  for (const [route, lowered] of [
    [editRoute, edit],
    [SEGMENT_ROUTE, segment],
  ] as const) {
    files.set(`${route.stem}-wire.gen.ts`, renderWire(route, lowered));
    files.set(`${route.stem}-fields.gen.ts`, renderFields(route, lowered));
    files.set(`${route.stem}-schema.gen.ts`, renderSchema(route, lowered));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text());
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The live document: the bytes' own hash, and the normalised form that is
 * committed. Keys are sorted so a refresh diffs on content — which is also why
 * the committed file's hash is not the one Photoroom serves, and why the raw
 * hash is recorded beside it.
 */
async function fetchSnapshot(): Promise<{ sha256: string; openapi: string }> {
  const response = await fetch(OPENAPI_URL);
  if (!response.ok) throw new Error(`GET ${OPENAPI_URL} answered ${response.status}`);
  const raw = await response.text();
  return {
    sha256: createHash("sha256").update(raw).digest("hex"),
    openapi: serialize(sortKeysDeep(JSON.parse(raw))),
  };
}

async function refresh(): Promise<void> {
  const { sha256, openapi } = await fetchSnapshot();
  await Bun.write(OPENAPI_PATH, openapi);
  const file = Bun.file(SNAPSHOT_PATH);
  const previous = (await file.exists()) ? record(await file.json(), "snapshot.json") : {};
  // `fetchedUTC` is the UTC date the document was first seen with this hash:
  // it moves only when the document does, so an unchanged week is an empty
  // diff. The key says UTC because the date can be a day ahead of the local
  // "read" dates written beside the quotes this snapshot backs.
  if (previous.sha256 !== sha256) {
    const fetchedUTC = new Date().toISOString().slice(0, 10);
    await Bun.write(SNAPSHOT_PATH, serialize({ fetchedUTC, sha256, url: OPENAPI_URL }));
  }
  console.log("Refreshed data/photoroom/openapi.json");
}

async function check(): Promise<void> {
  const { openapi } = await fetchSnapshot();
  if (openapi === (await Bun.file(OPENAPI_PATH).text())) {
    console.log("Photoroom's OpenAPI document matches the committed snapshot.");
    return;
  }
  console.error("Drifted from the live API: data/photoroom/openapi.json");
  console.error(
    "Run `bun run codegen:photoroom:refresh` and review the diff. The generator stops on anything it " +
      "does not model, and the cross-field checks in src/providers/photoroom/image-edit.ts are hand-written " +
      "from the descriptions in this document.",
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) return check();
  if (process.argv.includes("--refresh")) await refresh();

  const files = generate({
    openapi: await readJson(OPENAPI_PATH),
    overlays: await readJson(OVERLAYS_PATH),
  });

  const { mkdir, readdir, rm } = await import("node:fs/promises");
  await mkdir(GEN_DIR, { recursive: true });
  // Stale sweep, scoped to this provider's `gen/` and nothing else.
  for (const existing of await readdir(GEN_DIR)) {
    if (existing.endsWith(".gen.ts") && !files.has(existing)) {
      await rm(`${GEN_DIR}${existing}`);
      console.log(`Removed stale ${existing}`);
    }
  }
  for (const [name, content] of files) await Bun.write(`${GEN_DIR}${name}`, content);
  console.log(`Generated ${files.size} files into src/providers/photoroom/gen/`);
}

if (import.meta.main) {
  await main();
}
