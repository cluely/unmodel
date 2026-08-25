/**
 * The Standard Schema v1 interface (https://standardschema.dev), vendored.
 *
 * Vendored rather than depended on for the same reason `issue-sink.ts` is a
 * leaf: the spec package (`@standard-schema/spec`) is type-only, so shipping
 * it would add a `dependencies` entry that installs nothing but still shows up
 * in every consumer's lockfile and in attw/publint surface. The interface is
 * ~40 lines, MIT, and frozen at version 1 by design — structural typing is the
 * whole point of the spec, so any conforming validator (zod ≥ 3.24, arktype,
 * valibot, …) is assignable to this copy without either side importing the
 * other.
 *
 * This is what lets `PipelineSpec.schema` stop naming zod: the pipeline needs
 * exactly one thing from a schema — "does this value match, and if not, where
 * and why" — and `~standard.validate` is that operation, vendor-neutrally.
 * Everything zod-specific that remains (the `ZodObject.shape` introspection in
 * `reportUnknownTopLevelKeys`) degrades gracefully for non-zod schemas.
 */

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

/** One layer-1 shape failure: where in the params object, and what was wrong. */
export interface ShapeIssue {
  path: Array<string | number>;
  message: string;
}

/**
 * Runs a Standard Schema validator over `value`; failures in the shape the
 * issue sinks consume, `undefined` on success. Validation-only: callers keep
 * their original `value`, never the validator's output. A Promise result
 * throws synchronously — this pipeline is sync end to end, and zod's
 * `~standard.validate` goes async when the VALUE throws mid-read (hostile
 * getter/proxy), so the sync throw is what keeps `safeUnknown` total.
 */
export function shapeIssues(schema: StandardSchemaV1, value: unknown): ShapeIssue[] | undefined {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    // Un-awaited forever; without this its rejection crashes as unhandled.
    result.catch(() => {});
    throw new TypeError(
      "unmodel: schema validation must complete synchronously; the validator returned a Promise (an async schema, or a value whose property reads throw)",
    );
  }
  if (result.issues === undefined) return undefined;
  return result.issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) =>
        typeof segment === "object" && segment !== null ? segment.key : segment,
      )
      .filter((key): key is string | number => typeof key === "string" || typeof key === "number"),
    message: issue.message,
  }));
}
