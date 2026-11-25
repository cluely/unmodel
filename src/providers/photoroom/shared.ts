/**
 * What both Photoroom validators share: the schema that routes a form key to
 * its generated zod leaf, and the unknown-field check. `toFormData` lives on
 * `./form.ts`, which imports nothing — this module's signatures name zod types,
 * and a public entry's declarations must not (docs/decisions.md §5).
 *
 * ## Why the schema is not a `z.object`
 *
 * Photoroom's forms are flat — every key is one form field — but three groups
 * of keys on `/v2/edit` carry a slot the caller fills in
 * (`editWithAI.additionalImages.<name>.imageFile`, `layers.<id>.text.content`,
 * `virtualModel.additionalProductImages[…].imageFile`). A `z.looseObject` can
 * only list fixed keys, so every one of those documented fields would be an
 * unknown key to it: unvalidated, and reported by the pipeline's generic
 * unknown-key warning as "It may be new — or a typo."
 *
 * So the leaves are zod (`./gen/*-schema.gen.ts`, one per field) and the thing
 * around them is a `z.custom` that looks each key up — fixed table first, then
 * the families by prefix and suffix. Because that wrapper is not a `ZodObject`,
 * the pipeline's own unknown-key pass stands down, and
 * {@link checkUnknownFields} below reports unknown keys with a message that
 * says what Photoroom actually does with them.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { PhotoroomFamilySpec } from "./field-types";

/** One route's generated leaves, as `fieldTableSchema` and the checks read them. */
export interface FieldTable {
  /** A zod leaf per fixed form key. */
  readonly fields: Readonly<Record<string, z.ZodType>>;
  /** How each family's slot is written, keyed by the family's documented spelling. */
  readonly families?: Readonly<Record<string, PhotoroomFamilySpec>>;
  /** A zod leaf per family, keyed like `families`. */
  readonly familySchemas?: Readonly<Record<string, z.ZodType>>;
  /** The keys the route refuses a request without. */
  readonly required?: readonly string[];
}

/** `.name`, as a family written with a name of the caller's choosing spells its slot. */
const MAP_SLOT = /^\.(.+)$/;
/** `[0]` or `.0`, the two documented spellings of an array position. */
const INDEX_SLOT = /^(?:\[(\d+)\]|\.(\d+))$/;
/**
 * A slot whose spelling is not documented: it still has to OPEN like one — a
 * bracket or a dot, then something. `[]`, `[0]` and `.0` all do;
 * `additionalProductImagesX` does not, and stays an unknown field.
 */
const ANY_SLOT = /^(?:\[|\.).+$/;

/**
 * The caller's slot in `key` if it belongs to `family`, else `undefined`.
 *
 * The slot is returned NORMALISED — `[0]` and `.0` both answer `"0"` — so two
 * spellings of one entry count as one entry.
 */
export function familySlot(family: PhotoroomFamilySpec, key: string): string | undefined {
  if (key.length <= family.prefix.length + family.suffix.length) return undefined;
  if (!key.startsWith(family.prefix) || !key.endsWith(family.suffix)) return undefined;
  const middle = key.slice(family.prefix.length, key.length - family.suffix.length);
  if (family.notations.includes("index")) {
    const index = INDEX_SLOT.exec(middle);
    if (index !== null) return index[1] ?? index[2];
  }
  if (family.notations.includes("map")) {
    const name = MAP_SLOT.exec(middle);
    if (name !== null) return name[1];
  }
  if (!family.notations.includes("any") || !ANY_SLOT.test(middle)) return undefined;
  const index = INDEX_SLOT.exec(middle);
  return index === null ? middle : (index[1] ?? index[2]);
}

/** The zod leaf for one form key — fixed first, then the families — or `undefined`. */
export function fieldSchemaFor(table: FieldTable, key: string): z.ZodType | undefined {
  if (Object.hasOwn(table.fields, key)) return table.fields[key];
  for (const [id, family] of Object.entries(table.families ?? {})) {
    if (familySlot(family, key) !== undefined) return table.familySchemas?.[id];
  }
  return undefined;
}

function isFormFields(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A short rendering of a refused value, for the end of a message. */
function show(value: unknown): string {
  if (value instanceof Blob) return "a Blob";
  if (typeof value === "string") {
    const MAX_SHOWN = 40;
    return JSON.stringify(value.length > MAX_SHOWN ? `${value.slice(0, MAX_SHOWN)}…` : value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return Array.isArray(value) ? "an array" : `a value of type ${typeof value}`;
}

/**
 * The wire schema for one Photoroom form: every present key is validated by
 * its own generated leaf, and a key with no leaf is not an issue (the schema is
 * loose by law — {@link checkUnknownFields} owns those).
 *
 * `undefined` and `null` are skipped: `toFormData` omits them, so they never
 * reach the wire.
 */
export function fieldTableSchema(table: FieldTable): z.ZodType {
  return z
    .custom<Record<string, unknown>>(isFormFields, {
      error: "params must be an object whose keys are the form's field names",
    })
    .superRefine((params, ctx) => {
      if (!isFormFields(params)) return;
      for (const key of table.required ?? []) {
        if (params[key] === undefined || params[key] === null) {
          ctx.addIssue({ code: "custom", path: [key], message: `\`${key}\` is required` });
        }
      }
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        const leaf = fieldSchemaFor(table, key);
        if (leaf === undefined) continue;
        const result = leaf.safeParse(value);
        if (result.success) continue;
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `\`${key}\` ${issue.message}; got ${show(value)}`,
          });
        }
      }
    });
}

/**
 * Reports every key the route does not document, as an `unknown_param`
 * warning. `describe` supplies the sentence, because what happens to an unknown
 * field is a fact about the route.
 */
export function checkUnknownFields(
  table: FieldTable,
  source: string,
  describe: (key: string) => string,
) {
  return (params: object, _info: unknown, ctx: PipelineContext): void => {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (fieldSchemaFor(table, key) !== undefined) continue;
      ctx.report({ code: "unknown_param", path: [key], message: describe(key), meta: { source } });
    }
  };
}
