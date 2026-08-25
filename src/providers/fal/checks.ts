/**
 * The ONE check battery every `fal.*` validator runs.
 *
 * ## Why there is only one
 *
 * fal serves a curated slice of ~1,500 endpoints across nine verbs, and every
 * one of them is a different set of parameters, bounds and vocabularies. The
 * two obvious ways to validate that both fail:
 *
 * - **A schema per endpoint.** zod objects are constructed eagerly, so
 *   importing `unmodel/fal` would build a hundred of them to use one.
 * - **A check per endpoint.** A hundred hand-written check functions is a
 *   hundred places for a message to be phrased differently, and the phrasing
 *   is the whole product here.
 *
 * So the split is: the generated `<v>-schema.gen.ts` answers "is this the
 * right SHAPE?" for a whole category, the generated `FAL_<V>_SHAPES` rows say
 * what each endpoint requires, ranges and enumerates, and everything in this
 * file turns a violation of those rows into a sentence. The rows are data —
 * no zod, no closures, no strings — which is exactly what lets one battery
 * serve every endpoint and every message be written once, here, by hand.
 *
 * ## Every message cites the endpoint's own documentation
 *
 * `meta.source` is `FAL_DOC_URLS[endpointId]` — the URL fal itself publishes
 * for that endpoint in `info.x-fal-metadata.documentationUrl`. A caller who
 * gets "`num_inference_steps` must be at most 12" can follow the link and read
 * the same 12. A generic provider doc could not do that, because the ceiling
 * is 50 one endpoint over.
 *
 * ## The `props` keys ARE the allow-list
 *
 * There is no per-endpoint deny table anywhere in this provider. An endpoint's
 * `props` names everything it accepts, so everything else is unknown by
 * definition, and {@link checkKnownParams} composes the message from the keys
 * at run time. The alternative — an O(endpoints x parameters) table of
 * everything each endpoint refuses — would be hundreds of kilobytes restating
 * what the keys already say.
 *
 * ## Unknown endpoints degrade, they do not fail
 *
 * A request naming an endpoint that is not in the generated rows gets no
 * checks from this file at all. That is not a gap: the pipeline has already
 * warned `unknown_model`, and a curated roster is a snapshot of a catalog that
 * grows weekly. Refusing an endpoint fal added last Tuesday would make unmodel
 * the reason a valid request failed.
 */

import type { PipelineContext } from "../../core/pipeline";
import type { FalEndpointShape, FalPropSpec, FalSizeSpec } from "./shape-types";

/**
 * The route selector, and the one key that is never a wire parameter.
 *
 * `endpoint` is unmodel's pseudo-param: it picks the URL and is stripped in
 * `finalize`, so it must never be reported as an unknown parameter even though
 * no fal schema declares it. `model` is NOT exempt — it is a real wire field on
 * several fal endpoints, which is the whole reason the router is called
 * `endpoint` in the first place.
 */
export const FAL_ROUTE_PARAM = "endpoint";

/** What every check needs: who to blame, and where it is written down. */
export interface FalCheckTarget {
  /** The curated endpoint id — the URL path, and the catalog key. */
  readonly endpointId: string;
  /** That endpoint's generated row, or `undefined` for an uncurated id. */
  readonly shape: FalEndpointShape | undefined;
  /** `FAL_DOC_URLS[endpointId]` — the page the message points at. */
  readonly source: string | undefined;
  /**
   * Every parameter name anywhere in this category → the endpoints that take
   * it. Both halves are used: the KEYS mark the boundary between this file's
   * warnings and the pipeline's, and the values let a message say which
   * endpoint the caller probably meant. See {@link checkKnownParams}.
   */
  readonly categoryParams: ReadonlyMap<string, readonly string[]>;
}

type Params = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `["a", "b", "c"]` → `` `a`, `b` or `c` `` — used in several messages. */
function list(values: readonly (string | number)[], conjunction = "or"): string {
  const quoted = values.map((value) => JSON.stringify(value));
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} ${conjunction} ${quoted[quoted.length - 1] as string}`;
}

/**
 * The article-correct name of a type, for a message that reads like English.
 * `"integer"` is kept apart from `"number"` because "must be a whole number"
 * is worth being able to say.
 */
const TYPE_WORD: Readonly<Record<string, string>> = {
  string: "a string",
  number: "a number",
  integer: "a whole number",
  boolean: "a boolean",
  array: "an array",
  object: "an object",
  union: "one of the accepted shapes",
  unknown: "a value",
};

// ---------------------------------------------------------------------------
// checkRequired
// ---------------------------------------------------------------------------

/**
 * Parameters the endpoint requires and the request did not send.
 *
 * "Requires" here means fal's OpenAPI `required` list MINUS everything fal
 * supplies a default for. That subtraction is not a nicety: fal marks
 * defaulted fields required on plenty of endpoints, so demanding the raw list
 * would refuse bodies fal itself fills in and accepts.
 */
export function checkRequired(target: FalCheckTarget, params: Params, ctx: PipelineContext): void {
  const { shape, endpointId, source } = target;
  if (shape === undefined) return;
  for (const name of shape.order) {
    const spec = shape.props[name] as FalPropSpec;
    if (spec.req !== true || spec.def === true) continue;
    const value = params[name];
    if (value !== undefined) continue;
    ctx.report({
      code: "invalid_shape",
      path: [name],
      model: endpointId,
      message:
        `\`${name}\` is required by ${endpointId} and fal supplies no default for it — ` +
        `the request has nothing to ${name === "prompt" || name === "text" ? "generate from" : "work on"}.`,
      meta: { source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkTypes — the coarse type, and the closed vocabulary where there is one
// ---------------------------------------------------------------------------

/** Does `value` satisfy the IR's coarse type tag? */
function typeMatches(spec: FalPropSpec, value: unknown): boolean {
  switch (spec.t) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    // A union parameter (`image_size`) and an untyped one are both checked
    // elsewhere or not at all — `checkImageSize` owns the first, and fal
    // declaring no type is not something to hold a caller to.
    case "union":
    case "unknown":
      return true;
  }
}

/**
 * The declared type, and the vocabulary when the parameter has one.
 *
 * The enum half draws a line the generated schema cannot: an enum fal spells
 * `anyOf: [{enum: [...]}, {type: "string"}]` is OPEN — a suggestion, not a
 * limit — and an unlisted value there is a warning, because refusing it would
 * reject a request fal accepts. A closed enum is an error. The `open` flag on
 * the row is what tells the two apart; see `FalPropSpec.open`.
 */
export function checkTypes(target: FalCheckTarget, params: Params, ctx: PipelineContext): void {
  const { shape, endpointId, source } = target;
  if (shape === undefined) return;
  for (const [name, value] of Object.entries(params)) {
    if (name === FAL_ROUTE_PARAM || value === undefined) continue;
    const spec = shape.props[name];
    if (spec === undefined) continue; // checkKnownParams owns this one.
    if (value === null) {
      if (spec.nul === true) continue;
      ctx.report({
        code: "invalid_shape",
        path: [name],
        model: endpointId,
        message: `\`${name}\` does not accept \`null\` on ${endpointId}; omit it instead to take fal's own default.`,
        meta: { source },
      });
      continue;
    }
    if (!typeMatches(spec, value)) {
      ctx.report({
        code: "invalid_shape",
        path: [name],
        model: endpointId,
        message:
          `\`${name}\` must be ${TYPE_WORD[spec.t] ?? "a value"} on ${endpointId}; got ` +
          `${JSON.stringify(value)}.`,
        meta: { expected: spec.t, value, source },
      });
      continue;
    }
    checkEnum(target, name, spec, value, ctx);
    if (spec.t === "array" && Array.isArray(value)) {
      checkArrayLength(target, name, spec, value, ctx);
      const items = spec.items;
      if (items !== undefined) {
        value.forEach((item, index) => {
          if (item === undefined || item === null) return;
          if (!typeMatches(items, item)) {
            ctx.report({
              code: "invalid_shape",
              path: [name, index],
              model: endpointId,
              message:
                `\`${name}[${index}]\` must be ${TYPE_WORD[items.t] ?? "a value"} on ${endpointId}; ` +
                `got ${JSON.stringify(item)}.`,
              meta: { expected: items.t, value: item, source },
            });
            return;
          }
          checkEnum(target, `${name}[${index}]`, items, item, ctx, [name, index]);
        });
      }
    }
  }
}

function checkEnum(
  target: FalCheckTarget,
  label: string,
  spec: FalPropSpec,
  value: unknown,
  ctx: PipelineContext,
  path: Array<string | number> = [label],
): void {
  const allowed = spec.enum;
  if (allowed === undefined) return;
  if (typeof value !== "string" && typeof value !== "number") return;
  if (allowed.includes(value)) return;
  const { endpointId, source } = target;
  if (spec.open === true) {
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path,
      model: endpointId,
      message:
        `\`${label}\` is ${JSON.stringify(value)}, which is not one of the values ${endpointId} documents ` +
        `(${list(allowed)}). fal declares this parameter as an open enum — those values plus any other ` +
        "string — so the request is sent as written; check the spelling if you meant one of the listed ones.",
      meta: { allowed: [...allowed], value, open: true, source },
    });
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    path,
    model: endpointId,
    message:
      `\`${label}\` must be ${list(allowed)} on ${endpointId}; got ${JSON.stringify(value)}.` +
      (allowed.length === 1
        ? " That is the only value this endpoint's schema declares for it."
        : ""),
    meta: { allowed: [...allowed], value, source },
  });
}

function checkArrayLength(
  target: FalCheckTarget,
  name: string,
  spec: FalPropSpec,
  value: readonly unknown[],
  ctx: PipelineContext,
): void {
  const { endpointId, source } = target;
  if (spec.minItems !== undefined && value.length < spec.minItems) {
    ctx.report({
      code: "invalid_shape",
      path: [name],
      model: endpointId,
      message: `\`${name}\` needs at least ${spec.minItems} ${spec.minItems === 1 ? "entry" : "entries"} on ${endpointId}; got ${value.length}.`,
      meta: { minItems: spec.minItems, count: value.length, source },
    });
  }
  if (spec.maxItems !== undefined && value.length > spec.maxItems) {
    ctx.report({
      code: "invalid_shape",
      path: [name],
      model: endpointId,
      message: `\`${name}\` accepts at most ${spec.maxItems} ${spec.maxItems === 1 ? "entry" : "entries"} on ${endpointId}; got ${value.length}.`,
      meta: { maxItems: spec.maxItems, count: value.length, source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkRanges
// ---------------------------------------------------------------------------

/**
 * Numeric bounds and string lengths, per endpoint.
 *
 * This is the check the whole IR exists for. `num_inference_steps` tops out at
 * 50 on `fal-ai/flux/dev` and at 12 on `fal-ai/flux/schnell` — two endpoints,
 * one category, one schema — so a bound can only ever be stated per endpoint,
 * and the message has to name which endpoint's bound it is or the caller will
 * go read the wrong page.
 *
 * `exclusiveMinimum` / `exclusiveMaximum` are NUMBERS here (2020-12 semantics
 * under an "openapi: 3.0.4" label — fal's own spelling), so `xmin: 0` means
 * "greater than 0", not "0 is excluded from some other bound".
 */
export function checkRanges(target: FalCheckTarget, params: Params, ctx: PipelineContext): void {
  const { shape, endpointId, source } = target;
  if (shape === undefined) return;
  for (const [name, value] of Object.entries(params)) {
    if (name === FAL_ROUTE_PARAM || value === undefined || value === null) continue;
    const spec = shape.props[name];
    if (spec === undefined) continue;

    if (typeof value === "number" && Number.isFinite(value)) {
      const bound = (
        limit: number | undefined,
        ok: (v: number, l: number) => boolean,
        phrase: string,
        key: string,
      ): void => {
        if (limit === undefined || ok(value, limit)) return;
        ctx.report({
          code: "invalid_shape",
          path: [name],
          model: endpointId,
          message: `\`${name}\` must be ${phrase} ${limit} on ${endpointId}; got ${value}.`,
          meta: { [key]: limit, value, source },
        });
      };
      bound(spec.min, (v, l) => v >= l, "at least", "min");
      bound(spec.max, (v, l) => v <= l, "at most", "max");
      bound(spec.xmin, (v, l) => v > l, "greater than", "exclusiveMinimum");
      bound(spec.xmax, (v, l) => v < l, "less than", "exclusiveMaximum");
    }

    if (typeof value === "string") {
      if (spec.minLen !== undefined && value.length < spec.minLen) {
        ctx.report({
          code: "invalid_shape",
          path: [name],
          model: endpointId,
          message: `\`${name}\` must be at least ${spec.minLen} characters on ${endpointId}; got ${value.length}.`,
          meta: { minLength: spec.minLen, length: value.length, source },
        });
      }
      if (spec.maxLen !== undefined && value.length > spec.maxLen) {
        ctx.report({
          code: "invalid_shape",
          path: [name],
          model: endpointId,
          message: `\`${name}\` must be at most ${spec.maxLen} characters on ${endpointId}; got ${value.length}.`,
          meta: { maxLength: spec.maxLen, length: value.length, source },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// checkKnownParams
// ---------------------------------------------------------------------------

/**
 * Parameters this endpoint does not declare, but a SIBLING endpoint does.
 *
 * A **warning**, not an error, and deliberately so: fal ships new parameters
 * between snapshot refreshes, and a caller who read the release notes before
 * we did should not be blocked by a catalog that is a week behind. The request
 * goes out as written; the warning says this endpoint has not got the key.
 *
 * ## Why "but a sibling does"
 *
 * The pipeline already warns about a key that is in no schema at all — it
 * compares the body against the category's union schema, which is exactly the
 * union of every endpoint's parameters. What it CANNOT see is the interesting
 * case: `aspect_ratio` is a real `fal.image` parameter, on eleven of the 32
 * endpoints, and sending it to `fal-ai/flux/dev` is a mistake the union schema
 * is structurally unable to notice.
 *
 * So the two checks split the space rather than overlapping it, and every key
 * draws exactly one warning: the pipeline's generic one for a name no fal
 * endpoint in this category has, and this one — which names the endpoint,
 * lists what it DOES take, and links its documentation — for a name that
 * belongs to a sibling. Reporting both would give one mistake two voices, in
 * two different vocabularies.
 */
export function checkKnownParams(target: FalCheckTarget, params: Params, ctx: PipelineContext): void {
  const { shape, endpointId, source, categoryParams } = target;
  if (shape === undefined) return;
  const unknown = Object.keys(params).filter(
    (name) =>
      name !== FAL_ROUTE_PARAM &&
      params[name] !== undefined &&
      shape.props[name] === undefined &&
      // The pipeline owns this one; see above.
      categoryParams.has(name),
  );
  if (unknown.length === 0) return;
  const takers = (name: string): string[] =>
    unknown.length > 1 ? [] : [...(categoryParams.get(name) ?? [])];
  const others = takers(unknown[0] as string);
  ctx.report({
    code: "unknown_param",
    path: [unknown[0] as string],
    model: endpointId,
    message:
      `${list(unknown, "and")} ${unknown.length === 1 ? "is not a parameter" : "are not parameters"} ` +
      `${endpointId} declares — it takes ${list(shape.order, "and")}. ` +
      (others.length === 0
        ? ""
        : `${others.length === 1 ? "One other endpoint" : `${others.length} other endpoints`} in this ` +
          `category ${others.length === 1 ? "does" : "do"} take it` +
          `${others.length <= 3 ? ` (${others.map((id) => `\`${id}\``).join(", ")})` : ""}, ` +
          "so this reads like a request written for a different one. ") +
      "The request is sent as written all the same — fal adds parameters between snapshot refreshes.",
    meta: { unknown, declared: [...shape.order], ...(others.length > 0 && { takenBy: others }), source },
  });
}

// ---------------------------------------------------------------------------
// checkImageSize
// ---------------------------------------------------------------------------

/**
 * `image_size`, which is two parameters wearing one name.
 *
 * fal spells it `anyOf: [$ref ImageSize, string enum]` — either a named preset
 * (`"landscape_4_3"`) or an explicit `{ width, height }`. Both arms are
 * flattened onto the row's `size` spec so one check can answer "is that a
 * preset this endpoint knows?" and "is 20000 px inside its ceiling?" without
 * re-reading a schema.
 *
 * The ceiling is per endpoint and per dimension, which is why it is not a
 * constant in this file.
 */
export function checkImageSize(target: FalCheckTarget, params: Params, ctx: PipelineContext): void {
  const { shape, endpointId, source } = target;
  if (shape === undefined) return;
  for (const [name, spec] of Object.entries(shape.props)) {
    const size = spec.size;
    if (size === undefined) continue;
    const value = params[name];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (!size.presets.includes(value)) {
        ctx.report({
          code: "invalid_enum_value",
          path: [name],
          model: endpointId,
          message:
            `\`${name}\` must be ${list(size.presets)} on ${endpointId}, or an explicit ` +
            `\`{ width, height }\`; got ${JSON.stringify(value)}.`,
          meta: { allowed: [...size.presets], value, source },
        });
      }
      continue;
    }
    if (!isRecord(value)) {
      ctx.report({
        code: "invalid_shape",
        path: [name],
        model: endpointId,
        message:
          `\`${name}\` must be one of ${endpointId}'s presets (${list(size.presets)}) or an object with ` +
          `\`width\` and \`height\`; got ${JSON.stringify(value)}.`,
        meta: { allowed: [...size.presets], value, source },
      });
      continue;
    }
    checkDimension(target, name, "width", size, value.width, ctx);
    checkDimension(target, name, "height", size, value.height, ctx);
  }
}

function checkDimension(
  target: FalCheckTarget,
  param: string,
  axis: "width" | "height",
  size: FalSizeSpec,
  value: unknown,
  ctx: PipelineContext,
): void {
  if (value === undefined || value === null) return;
  const { endpointId, source } = target;
  const path = [param, axis];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    ctx.report({
      code: "invalid_shape",
      path,
      model: endpointId,
      message: `\`${param}.${axis}\` must be a number on ${endpointId}; got ${JSON.stringify(value)}.`,
      meta: { value, source },
    });
    return;
  }
  const bounds = size[axis];
  if (bounds.xmin !== undefined && value <= bounds.xmin) {
    ctx.report({
      code: "invalid_shape",
      path,
      model: endpointId,
      message: `\`${param}.${axis}\` must be greater than ${bounds.xmin} on ${endpointId}; got ${value}.`,
      meta: { exclusiveMinimum: bounds.xmin, value, source },
    });
  }
  if (bounds.min !== undefined && value < bounds.min) {
    ctx.report({
      code: "invalid_shape",
      path,
      model: endpointId,
      message: `\`${param}.${axis}\` must be at least ${bounds.min} on ${endpointId}; got ${value}.`,
      meta: { min: bounds.min, value, source },
    });
  }
  if (bounds.max !== undefined && value > bounds.max) {
    ctx.report({
      code: "invalid_shape",
      path,
      model: endpointId,
      message: `\`${param}.${axis}\` must be at most ${bounds.max} on ${endpointId}; got ${value}.`,
      meta: { max: bounds.max, value, source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkMediaRefs
// ---------------------------------------------------------------------------

/**
 * Media parameters, which at fal are always a reference and never bytes.
 *
 * Every file input on every fal endpoint is a STRING: an `https:` URL fal will
 * fetch, or a `data:` URI carrying small inline bytes. A caller who hands one
 * of these a `Buffer`, a `Blob`, a bare filesystem path or a `File` object has
 * made a mistake that the coarse type check would report as "must be a string"
 * — true, but not the sentence that helps. This one names the two things fal
 * actually accepts and, for a path, says what to do instead.
 *
 * Which parameters are media is decided at codegen time from fal's `ui.field`
 * hint where it exists and from the parameter's own name where it does not —
 * `image_url`, `image_urls`, `mask_url`, `audio_url`. fal publishes the hint
 * on almost nothing (once across the wave-1a snapshots), so the name is what
 * does the work; see `mediaFromName` in scripts/codegen-fal.ts.
 */
export function checkMediaRefs(target: FalCheckTarget, params: Params, ctx: PipelineContext): void {
  const { shape, endpointId, source } = target;
  if (shape === undefined) return;
  for (const [name, spec] of Object.entries(shape.props)) {
    const kind = spec.media ?? spec.items?.media;
    if (kind === undefined) continue;
    const value = params[name];
    if (value === undefined || value === null) continue;
    const entries: Array<[unknown, Array<string | number>]> = Array.isArray(value)
      ? value.map((item, index) => [item, [name, index]])
      : [[value, [name]]];
    for (const [item, path] of entries) {
      if (item === undefined || item === null) continue;
      if (typeof item !== "string") {
        ctx.report({
          code: "invalid_shape",
          path,
          model: endpointId,
          message:
            `\`${path.join(".")}\` must be a string — fal takes ${kind} inputs as a reference, either an ` +
            "`https:` URL it fetches or a `data:` URI carrying the bytes inline. unmodel does not upload " +
            `files; got ${typeof item === "object" ? "an object" : JSON.stringify(item)}.`,
          meta: { media: kind, source },
        });
        continue;
      }
      if (/^(https?|data):/i.test(item)) continue;
      ctx.report({
        code: "invalid_shape",
        path,
        model: endpointId,
        message:
          `\`${path.join(".")}\` must be an \`https:\` URL or a \`data:\` URI; got ${JSON.stringify(
            item.length > 60 ? `${item.slice(0, 60)}…` : item,
          )}. ` +
          (item.startsWith("/") || /^[a-z]:\\/i.test(item) || item.startsWith("./")
            ? "That looks like a local path — fal fetches its inputs over the network, so upload the file " +
              "somewhere reachable (or inline it as a `data:` URI if it is small) and pass that."
            : `fal fetches ${kind} inputs over the network and cannot resolve a bare identifier.`),
        meta: { media: kind, source },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

/**
 * Every check above, in the order whose messages compose best.
 *
 * Order matters more than it looks. Types run before ranges so a `"4"` string
 * is reported as the wrong type rather than as a number outside its bounds;
 * required runs first so a missing `prompt` is not buried under six notes
 * about optional parameters. Known-params runs last because it is the only
 * warning in the set, and a caller reading top to bottom should hit the errors
 * that stop the request first.
 */
const CATEGORY_PARAMS = new WeakMap<object, ReadonlyMap<string, readonly string[]>>();

/**
 * Parameter name → the endpoints in this category that declare it.
 *
 * Built once per category table and cached against the table itself, so the
 * cost is paid by the first request rather than on import — the same reason
 * the generated rows are plain data in the first place.
 */
function categoryParamsOf(
  shapes: Readonly<Record<string, FalEndpointShape>>,
): ReadonlyMap<string, readonly string[]> {
  const cached = CATEGORY_PARAMS.get(shapes);
  if (cached !== undefined) return cached;
  const index = new Map<string, string[]>();
  for (const [id, shape] of Object.entries(shapes)) {
    for (const name of shape.order) {
      const takers = index.get(name);
      if (takers === undefined) index.set(name, [id]);
      else takers.push(id);
    }
  }
  CATEGORY_PARAMS.set(shapes, index);
  return index;
}

export function runFalChecks(
  endpointId: string,
  shapes: Readonly<Record<string, FalEndpointShape>>,
  docUrls: Readonly<Record<string, string>>,
  params: Params,
  ctx: PipelineContext,
): void {
  const target: FalCheckTarget = {
    endpointId,
    shape: shapes[endpointId],
    source: docUrls[endpointId],
    categoryParams: categoryParamsOf(shapes),
  };
  // An id the roster has never seen gets the pipeline's `unknown_model`
  // warning and nothing from here. See the module header.
  if (target.shape === undefined) return;
  checkRequired(target, params, ctx);
  checkTypes(target, params, ctx);
  checkRanges(target, params, ctx);
  checkImageSize(target, params, ctx);
  checkMediaRefs(target, params, ctx);
  checkKnownParams(target, params, ctx);
}
