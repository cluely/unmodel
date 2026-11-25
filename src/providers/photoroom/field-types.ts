/**
 * The row shapes `scripts/codegen-photoroom.ts` emits against — types only.
 *
 * Photoroom's two routes are flat multipart forms, so a "field" is one form
 * key and its value is a scalar or a file. That is the whole type space: there
 * is no nesting on the wire to describe, only dotted names
 * (`background.blur.radius`) and, for three groups, names with a slot the
 * caller fills in (`layers.<id>.text.content`).
 */

/** What one form field carries. */
export type PhotoroomFieldType =
  | "string"
  | "number"
  | "boolean"
  /** A file part. */
  | "blob"
  /** `padding` / `margin`: a ratio, or a `"30%"` / `"100px"` string. */
  | "numberOrString"
  /** The shadow overrides: an angle in degrees, or one of the named presets in `enum`. */
  | "numberOrEnum";

/** One form field, as Photoroom's OpenAPI document constrains it. */
export interface PhotoroomFieldSpec {
  readonly t: PhotoroomFieldType;
  /** The route refuses a request without it. */
  readonly req?: true;
  /** The closed vocabulary — the spec's `enum`, or its `const` as a one-member list. */
  readonly enum?: readonly string[];
  /** Inclusive lower bound. */
  readonly min?: number;
  /** Inclusive upper bound. */
  readonly max?: number;
  /** EXCLUSIVE lower bound — `background.blur.radius` must be greater than 0. */
  readonly xmin?: number;
  /** Minimum length of a string. */
  readonly minLen?: number;
  /** A regular-expression source the string must match (`outputSize`). */
  readonly pattern?: string;
  /** The spec's `format`, where it constrains the text (`templateId`). */
  readonly format?: "uuid";
  /** What the server uses when the field is absent. */
  readonly def?: string | number | boolean;
  /** Photoroom has retired the field; it is typed because it is still accepted. */
  readonly deprecated?: true;
  /** Members of `enum` Photoroom has retired; still accepted. */
  readonly deprecatedValues?: readonly string[];
  /** A preview feature: "there could be breaking changes with a 2-week notice period". */
  readonly preview?: true;
}

/**
 * How a family's slot is written in a form key.
 *
 * - `"map"` — a name of the caller's choosing, as a path segment:
 *   `<prefix>.<name><suffix>`.
 * - `"index"` — an array position: `<prefix>[<n>]<suffix>` or
 *   `<prefix>.<n><suffix>`.
 * - `"any"` — the slot's spelling is not documented, so anything that opens
 *   like a slot is accepted: `<prefix>[…<suffix>` or `<prefix>.…<suffix>`
 *   (`[0]`, `.0`, a literal `[]`). A key that runs straight on from the prefix
 *   (`<prefix>X<suffix>`) is not a member.
 */
export type PhotoroomFamilyNotation = "map" | "index" | "any";

/** One member of an open-keyed family: `<prefix><the caller's slot><suffix>`. */
export interface PhotoroomFamilySpec extends PhotoroomFieldSpec {
  /** Everything before the slot — `"editWithAI.additionalImages"`. */
  readonly prefix: string;
  /** Everything after it — `".imageFile"`. */
  readonly suffix: string;
  readonly notations: readonly PhotoroomFamilyNotation[];
  /** The most entries the family takes, where the spec caps it. */
  readonly maxItems?: number;
}
