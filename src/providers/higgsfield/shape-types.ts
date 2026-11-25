/**
 * The row contract `scripts/codegen-higgsfield.ts` targets, and `./checks.ts`
 * reads.
 *
 * Its own leaf, type only and import-free: the generated `gen/*-narrow.gen.ts`
 * files declare `satisfies Record<string, HiggsfieldEndpointShape>`, so a field
 * renamed here fails `tsc` in the generated file instead of drifting into two
 * vocabularies. The generator declares the same shapes privately (it imports
 * nothing from `src/`, so that it can run against a tree whose provider
 * directory is broken); THIS module is the canonical one.
 *
 * Field names are terse (`req`, `nul`, `xmin`) because these rows are the bulk
 * of what `unmodel/higgsfield` ships. Each is documented here, once.
 */

/** A parameter's JSON type, as its route's schema states it. */
export type HiggsfieldPropType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "union" | "unknown";

/** One parameter, as one route declares it. */
export interface HiggsfieldPropSpec {
  readonly t: HiggsfieldPropType;
  /** In the route's `required` list. */
  readonly req?: true;
  /** An explicit `null` is accepted. */
  readonly nul?: true;
  /**
   * `nul` was granted by an overlay because Higgsfield's two publications of
   * the route contradict each other on it: `null` is accepted, and reported.
   */
  readonly nulWarn?: true;
  /** The closed vocabulary (`enum`, or a string / number `const`). */
  readonly enum?: readonly (string | number)[];
  /** A boolean `const`: the one accepted value. */
  readonly const?: boolean;
  /** `minimum` / `maximum` — inclusive. */
  readonly min?: number;
  readonly max?: number;
  /** `exclusiveMinimum` / `exclusiveMaximum`, as numbers. */
  readonly xmin?: number;
  readonly xmax?: number;
  /**
   * Advisory bounds from `data/higgsfield/overlays.json`: a tighter limit one
   * source states and the route's schema does not. A warning, never a refusal.
   */
  readonly softMin?: number;
  readonly softMax?: number;
  readonly softXmin?: number;
  readonly softMaxLen?: number;
  /** `minLength` / `maxLength`. */
  readonly minLen?: number;
  readonly maxLen?: number;
  /** `minItems` / `maxItems`. */
  readonly minItems?: number;
  readonly maxItems?: number;
  /** `pattern`, as the schema spells it. Asserted at codegen to compile as a JavaScript `RegExp`. */
  readonly pat?: string;
  /** `multipleOf`. */
  readonly step?: number;
  /** `format`. `uuid` is a format only: membership in a live preset list is the API's to check. */
  readonly fmt?: "uri" | "uuid";
  /** The element spec of an array. */
  readonly items?: HiggsfieldPropSpec;
  /**
   * An object's own properties. With `values` beside it, these are the keys
   * the schema types apart from the rest of a map.
   */
  readonly props?: Readonly<Record<string, HiggsfieldPropSpec>>;
  /** A nested object that is `additionalProperties: false`. */
  readonly closed?: true;
  /** A map's value spec (`additionalProperties: <schema>`) and its `maxProperties`. */
  readonly values?: HiggsfieldPropSpec;
  readonly maxProps?: number;
}

/** What a rule compares a parameter against. */
export type HiggsfieldScalar = string | number | boolean;

/** One clause of a `when` rule's condition: the parameter is one of these values. */
export interface HiggsfieldCondition {
  readonly name: string;
  readonly in: readonly HiggsfieldScalar[];
}

/** What a `when` rule's branch holds a parameter to. It applies to a value that is present. */
export interface HiggsfieldConstraint {
  readonly in?: readonly HiggsfieldScalar[];
  readonly minItems?: number;
  readonly maxItems?: number;
  /** The value must be `null`, or absent. */
  readonly null?: true;
  readonly props?: Readonly<Record<string, HiggsfieldConstraint>>;
}

/** One branch of a `when` rule. */
export interface HiggsfieldConsequence {
  readonly required?: readonly string[];
  /**
   * Parameters the branch requires whose default — the one every source that
   * declares the parameter agrees on, given here — already satisfies the
   * branch. The schema's strict reading refuses a request that omits one; a
   * server that fills defaults first fulfils it. Reported, never refused.
   */
  readonly defaulted?: Readonly<Record<string, HiggsfieldScalar>>;
  readonly props?: Readonly<Record<string, HiggsfieldConstraint>>;
}

/**
 * A cross-field requirement, lowered from a route's `if` / `then` / `else`,
 * `allOf`, `anyOf` or `not` — or, for `tokens`, from a usage note recorded in
 * `data/higgsfield/overlays.json`.
 */
export type HiggsfieldRule =
  /**
   * At least one of these must be sent — and be non-empty where `nonEmpty`.
   * Not JSON Schema's `oneOf`: sending several is fine.
   */
  | { readonly kind: "atLeastOne"; readonly params: readonly { readonly name: string; readonly nonEmpty?: true }[] }
  /**
   * When every `if` clause holds, `then` applies; otherwise `else` does.
   *
   * `absent` says which branch a request that OMITS the `if` parameter is held
   * to. `"either"`: the schema's strict reading (`then`) and the reading in
   * which the server fills its default first (`else`) disagree, so the request
   * is refused only when it satisfies neither branch.
   */
  | {
      readonly kind: "when";
      readonly if: readonly HiggsfieldCondition[];
      readonly absent: "then" | "else" | "either";
      readonly then: HiggsfieldConsequence;
      readonly else?: HiggsfieldConsequence;
    }
  /**
   * `<<<kind_N>>>` tokens in the `prompt` parameter index an item of that
   * kind's array, one-based.
   */
  | { readonly kind: "tokens"; readonly prompt: string; readonly arrays: Readonly<Record<string, string>> };

/** One route's whole input surface. */
export interface HiggsfieldEndpointShape {
  /** Every parameter name, sorted. */
  readonly order: readonly string[];
  /** Every parameter the route declares. The keys ARE the allow-list. */
  readonly props: Readonly<Record<string, HiggsfieldPropSpec>>;
  /** `additionalProperties: false`: the API refuses a key outside `props`. */
  readonly closed?: true;
  readonly rules?: readonly HiggsfieldRule[];
}
