/**
 * The ONE check battery every generated `higgsfield.*` address runs.
 *
 * ## Why there is only one
 *
 * Higgsfield is one URL template in front of more than a hundred routes, each
 * with its own parameters, bounds, vocabularies and cross-field rules. A zod
 * schema per route would be built on import for the one the caller used, and
 * a check per route would be a hundred places for a message to be phrased
 * differently. So the generated `gen/input-schema.gen.ts` is one object for
 * every route that types the two URL parameters and names every body key,
 * the generated `HIGGSFIELD_<VERB>_SHAPES` rows say what each route types,
 * requires, ranges, enumerates and demands across fields, and everything in
 * this file turns a violation of a row into a sentence. There is no table keyed by
 * endpoint id anywhere in it: a rule Higgsfield states only in prose enters as
 * data, through `data/higgsfield/overlays.json`.
 *
 * ## Every message cites the route's own documentation
 *
 * `meta.source` is `HIGGSFIELD_DOC_URLS[endpoint]`: the route's docs page
 * where it has one, otherwise its console API reference.
 *
 * ## Strictness is per route, and published
 *
 * A route whose schema says `additionalProperties: false` (`closed` on its
 * row) refuses an undeclared key, so that is an ERROR here. On every other
 * route an undeclared key is sent as written, with a warning. The one place a
 * stale snapshot can therefore refuse a request the API fulfils is a new
 * field on a closed route or on a closed nested object, and both messages
 * name the per-call override.
 *
 * ## What is a warning and not an error
 *
 * Anything the published schema does not itself refuse: a soft bound one
 * source states and the other does not, a `null` the two sources contradict
 * each other on, a `multipleOf` step (a float remainder is not safe to refuse
 * on), and a media reference that is a URI of some other scheme than `http(s)`
 * — `format: "uri"` admits it, and nothing here was probed against a live key.
 * So is a parameter a conditional requires when the request omits it and its
 * published default already satisfies the conditional: a server that fills
 * defaults before validating fulfils that request.
 *
 * ## An id this address does not serve
 *
 * Every route is `POST https://api.higgsfield.ai/<endpoint>` with that
 * route's own body, so an image route's id handed to `higgsfield.video`
 * still builds a request the API fulfils. It gets a warning naming the
 * address that types it, and no checks: a body key's type is a fact of a
 * route's row, so without the row nothing about the body is refused. Only the picture-editing VIEW
 * refuses, because refusing what is not an edit is what makes it a view; an
 * id unmodel deliberately does not type gets its recorded reason, as a
 * warning; and an id no row knows gets an `unknown_model` warning at
 * `endpoint`, the parameter it was written in.
 *
 * A value that cannot be a route id at all — a pasted URL, a leading slash —
 * is an error that names the id it should have been: the URL it builds is
 * not one of Higgsfield's.
 */

import type { IssueInput } from "../../core/issue-sink";
import type { PipelineContext } from "../../core/pipeline";
import { HIGGSFIELD_DOC_URLS, HIGGSFIELD_EXCLUDED } from "./gen/endpoints.gen";
import type {
  HiggsfieldConsequence,
  HiggsfieldConstraint,
  HiggsfieldEndpointShape,
  HiggsfieldPropSpec,
  HiggsfieldRule,
  HiggsfieldScalar,
} from "./shape-types";
import { HF_WEBHOOK_PARAM, HIGGSFIELD_BASE_URL, HIGGSFIELD_UPLOAD_HINT, HIGGSFIELD_UPLOAD_SOURCE } from "./urls";

/**
 * The route selector: unmodel's own parameter, stripped into `.request.url`.
 *
 * Not `model`: Higgsfield's bodies have no such field today, and a hosted
 * vendor's can grow one (Kling's `mode` is one letter away). The generator
 * stops if a route ever declares `endpoint`.
 */
export const HIGGSFIELD_ROUTE_PARAM = "endpoint";

/** Where the webhook rule is documented. */
export const HIGGSFIELD_WEBHOOK_SOURCE = "https://docs.higgsfield.ai/docs/how-to/webhooks.md";

/** A narrower address over a wide one's tables. */
export interface HiggsfieldView {
  /** What the view's routes do, to finish "serves the Higgsfield routes that …". */
  readonly does: string;
  /** The wide address that validates everything the view refuses. */
  readonly wide: string;
  /** The request must carry one of these to be the view's kind of request. */
  readonly needsOneOf: readonly string[];
}

/** What the battery needs to know about the address it runs for. */
export interface HiggsfieldCheckSpec {
  /** The rows of the address's output type. Wider than `ids` on a view. */
  readonly shapes: Readonly<Record<string, HiggsfieldEndpointShape>>;
  /** The ids this address serves. */
  readonly ids: readonly string[];
  readonly view?: HiggsfieldView;
  /** The other wide addresses' ids, for the signpost on a foreign id. */
  readonly elsewhere: Readonly<Record<string, readonly string[]>>;
  /**
   * Every key the gate declares. The pipeline warns about a key outside it; a
   * key inside it that this route does not declare is this file's to report.
   */
  readonly gateKeys: ReadonlySet<string>;
}

type Params = Readonly<Record<string, unknown>>;
type Path = Array<string | number>;

interface Target {
  readonly endpoint: string;
  readonly shape: HiggsfieldEndpointShape;
  readonly source: string | undefined;
  readonly ctx: PipelineContext;
}

/**
 * Runs every route-dependent rule for one request. `params` has passed the
 * gate, which settles that `endpoint` and `hf_webhook` are strings and
 * nothing about a body key.
 */
export function runSubmitChecks(spec: HiggsfieldCheckSpec, params: Params, ctx: PipelineContext): void {
  const endpoint = params[HIGGSFIELD_ROUTE_PARAM] as string;
  const webhook = params[HF_WEBHOOK_PARAM];
  if (typeof webhook === "string") checkWebhook(webhook, endpoint, ctx);

  if (!checkAddress(spec, endpoint, params, ctx)) return;
  const target: Target = {
    endpoint,
    shape: spec.shapes[endpoint] as HiggsfieldEndpointShape,
    source: sourceOf(endpoint),
    ctx,
  };
  checkRequired(target, params);
  checkValues(target, params);
  checkRules(target, params);
  checkKnownParams(target, params, spec);
}

function sourceOf(endpoint: string): string | undefined {
  return Object.hasOwn(HIGGSFIELD_DOC_URLS, endpoint)
    ? HIGGSFIELD_DOC_URLS[endpoint as keyof typeof HIGGSFIELD_DOC_URLS]
    : undefined;
}

// ---------------------------------------------------------------------------
// checkAddress
// ---------------------------------------------------------------------------

/** Whether `endpoint` is one of this address's routes, reporting what it is when it is not. */
function checkAddress(spec: HiggsfieldCheckSpec, endpoint: string, params: Params, ctx: PipelineContext): boolean {
  const view = spec.view;
  if (spec.ids.includes(endpoint)) {
    if (view !== undefined && !view.needsOneOf.some((name) => carriesMedia(params[name]))) {
      ctx.report({
        code: "invalid_shape",
        path: [view.needsOneOf[0] as string],
        model: endpoint,
        message:
          `${ctx.endpoint} is for requests that ${view.does}: send ${view.needsOneOf.map((name) => `\`${name}\``).join(" or ")}. ` +
          `Without one this is a plain generation on ${endpoint}, which \`${view.wide}\` validates.`,
        meta: { source: sourceOf(endpoint) },
      });
    }
    return true;
  }
  const malformed = routeIdFault(endpoint);
  if (malformed !== undefined) {
    const repaired = repairedRouteId(endpoint);
    ctx.report({
      code: "invalid_shape",
      path: [HIGGSFIELD_ROUTE_PARAM],
      message:
        `\`${HIGGSFIELD_ROUTE_PARAM}\` is a route id, the path after \`${HIGGSFIELD_BASE_URL}/\` with no slash at either end ` +
        `(\`higgsfield-ai/soul/standard\`); got ${JSON.stringify(excerpt(endpoint))}, which ${malformed}.` +
        (repaired === undefined ? "" : ` Send \`${repaired}\`.`),
      meta: { value: endpoint, ...(repaired !== undefined && { suggestion: repaired }) },
    });
    return false;
  }
  if (view !== undefined && Object.hasOwn(spec.shapes, endpoint)) {
    ctx.report({
      code: "unsupported_capability",
      path: [HIGGSFIELD_ROUTE_PARAM],
      model: endpoint,
      message:
        `${ctx.endpoint} serves the Higgsfield routes that ${view.does}, and \`${endpoint}\` is not one of them. ` +
        `\`${view.wide}\` validates it.`,
      meta: { source: sourceOf(endpoint) },
    });
    return false;
  }
  for (const [address, ids] of Object.entries(spec.elsewhere)) {
    if (!ids.includes(endpoint)) continue;
    ctx.report({
      code: "unsupported_capability",
      severity: "warning",
      path: [HIGGSFIELD_ROUTE_PARAM],
      model: endpoint,
      message:
        `\`${endpoint}\` is a Higgsfield route that \`${address}\` validates; ${ctx.endpoint} did not check the body. ` +
        "The request itself is unaffected — the route id is the path, whichever address builds it.",
      meta: { address, source: sourceOf(endpoint) },
    });
    return false;
  }
  const reason = Object.hasOwn(HIGGSFIELD_EXCLUDED, endpoint) ? HIGGSFIELD_EXCLUDED[endpoint] : undefined;
  if (reason !== undefined) {
    ctx.report({
      code: "unknown_model",
      path: [HIGGSFIELD_ROUTE_PARAM],
      model: endpoint,
      message:
        `unmodel deliberately does not type \`${endpoint}\`: ${reason} The request is routed and sent as written all ` +
        "the same, but nothing validated it — this is a recorded decision, not catalog lag.",
      meta: { excluded: true, reason },
    });
    return false;
  }
  ctx.report({
    code: "unknown_model",
    path: [HIGGSFIELD_ROUTE_PARAM],
    model: endpoint,
    message:
      `\`${endpoint}\` is not a Higgsfield route unmodel has a row for, so ${ctx.endpoint} checked nothing about its body. ` +
      "The request is routed and sent as written. If the route is newer than this version's snapshot that is expected; otherwise check the id's spelling.",
  });
  return false;
}

/** What makes `endpoint` something no route id can be, to finish "which …". */
function routeIdFault(endpoint: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) return "is a whole URL";
  if (/[?#]/.test(endpoint)) return "carries a query string or a fragment";
  if (/\s/.test(endpoint)) return "contains whitespace";
  const segments = endpoint.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return "has a relative path segment";
  if (segments.some((segment) => segment === "")) return endpoint === "" ? "is empty" : "has an empty path segment";
  return undefined;
}

/** The route id a malformed `endpoint` most plainly meant, when stripping the base URL and stray slashes leaves one. */
function repairedRouteId(endpoint: string): string | undefined {
  const path = endpoint.startsWith(`${HIGGSFIELD_BASE_URL}/`) ? endpoint.slice(HIGGSFIELD_BASE_URL.length) : endpoint;
  const repaired = path.replace(/^\/+|\/+$/g, "");
  return repaired !== "" && repaired !== endpoint && routeIdFault(repaired) === undefined ? repaired : undefined;
}

/** Whether a media parameter names a file: an empty list names none, so it is a plain generation. */
function carriesMedia(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

// ---------------------------------------------------------------------------
// checkRequired
// ---------------------------------------------------------------------------

function checkRequired(target: Target, params: Params): void {
  const { shape, endpoint, source, ctx } = target;
  for (const name of shape.order) {
    if ((shape.props[name] as HiggsfieldPropSpec).req !== true || params[name] !== undefined) continue;
    ctx.report({
      code: "invalid_shape",
      path: [name],
      model: endpoint,
      message: `\`${name}\` is required by ${endpoint}.`,
      meta: { source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkValues — type, vocabulary, bounds, pattern and format, at any depth
// ---------------------------------------------------------------------------

/** The article-correct name of a type, for a message that reads like English. */
const TYPE_WORD: Readonly<Record<string, string>> = {
  string: "a string",
  number: "a number",
  integer: "a whole number",
  boolean: "a boolean",
  array: "an array",
  object: "an object",
};

/** A float `multipleOf` test needs a tolerance: `0.07 / 0.01` is `7.000000000000001`. */
const STEP_TOLERANCE = 1e-9;

/** Canonical 8-4-4-4-12 hexadecimal, any version. Format only: membership in a live list is the API's to check. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PATTERNS = new Map<string, RegExp>();

/** The schema's `pattern`, compiled once. Codegen asserts every one compiles, with this flag. */
function patternOf(source: string): RegExp {
  let compiled = PATTERNS.get(source);
  if (compiled === undefined) {
    compiled = new RegExp(source, "u");
    PATTERNS.set(source, compiled);
  }
  return compiled;
}

function checkValues(target: Target, params: Params): void {
  for (const [name, value] of Object.entries(params)) {
    if (name === HIGGSFIELD_ROUTE_PARAM || name === HF_WEBHOOK_PARAM || value === undefined) continue;
    const spec = target.shape.props[name];
    if (spec === undefined) continue; // checkKnownParams owns this one.
    checkValue(target, spec, value, [name]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(path: Path): string {
  return path.map((segment, index) => (typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`)).join("");
}

function list(values: readonly (string | number | boolean)[], conjunction = "or"): string {
  const quoted = values.map((value) => JSON.stringify(value));
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} ${conjunction} ${quoted[quoted.length - 1] as string}`;
}

function typeMatches(spec: HiggsfieldPropSpec, value: unknown): boolean {
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
    case "union":
    case "unknown":
      return true;
  }
}

function checkValue(target: Target, spec: HiggsfieldPropSpec, value: unknown, path: Path): void {
  const { endpoint, source, ctx } = target;
  const name = label(path);
  function fail(message: string, meta: Record<string, unknown> = {}): void {
    ctx.report({ code: "invalid_shape", path, model: endpoint, message, meta: { ...meta, source } });
  }
  function warn(message: string, meta: Record<string, unknown> = {}): void {
    ctx.report({ code: "invalid_shape", severity: "warning", path, model: endpoint, message, meta: { ...meta, source } });
  }

  if (value === null) {
    if (spec.nulWarn === true) {
      warn(
        `\`${name}\` is \`null\` on ${endpoint}, and Higgsfield's publications of this route contradict each other on ` +
          "whether an explicit `null` is accepted here. It is sent as written; omit the field to be safe.",
        { value: null },
      );
    } else if (spec.nul !== true) {
      fail(`\`${name}\` does not accept \`null\` on ${endpoint}; omit it instead.`, { value: null });
    }
    return;
  }

  if (spec.fmt === "uri" && typeof value !== "string") {
    fail(`\`${name}\` must be the URL of a file, as a string, on ${endpoint}; got ${typeof value === "object" ? "an object" : JSON.stringify(value)}. ${HIGGSFIELD_UPLOAD_HINT}`, {
      hint: HIGGSFIELD_UPLOAD_SOURCE,
    });
    return;
  }
  if (!typeMatches(spec, value)) {
    fail(`\`${name}\` must be ${TYPE_WORD[spec.t] ?? "a value"} on ${endpoint}; got ${JSON.stringify(value)}.`, { expected: spec.t, value });
    return;
  }

  if (spec.enum !== undefined && (typeof value === "string" || typeof value === "number") && !spec.enum.includes(value)) {
    ctx.report({
      code: "invalid_enum_value",
      path,
      model: endpoint,
      message:
        `\`${name}\` must be ${list(spec.enum)} on ${endpoint}; got ${JSON.stringify(value)}.` +
        (spec.enum.length === 1 ? " That is the only value this route's schema declares for it." : ""),
      meta: { allowed: [...spec.enum], value, source },
    });
  }
  if (spec.const !== undefined && value !== spec.const) {
    ctx.report({
      code: "invalid_enum_value",
      path,
      model: endpoint,
      message: `\`${name}\` must be ${JSON.stringify(spec.const)} on ${endpoint}, the only value this route's schema declares for it; got ${JSON.stringify(value)}.`,
      meta: { allowed: [spec.const], value, source },
    });
  }

  if (typeof value === "number") checkNumber(spec, value, name, endpoint, fail, warn);
  if (typeof value === "string") checkString(spec, value, name, endpoint, fail, warn);
  if (Array.isArray(value)) {
    if (spec.minItems !== undefined && value.length < spec.minItems) {
      fail(`\`${name}\` needs at least ${spec.minItems} ${spec.minItems === 1 ? "entry" : "entries"} on ${endpoint}; got ${value.length}.`, {
        minItems: spec.minItems,
        count: value.length,
      });
    }
    if (spec.maxItems !== undefined && value.length > spec.maxItems) {
      fail(`\`${name}\` accepts at most ${spec.maxItems} ${spec.maxItems === 1 ? "entry" : "entries"} on ${endpoint}; got ${value.length}.`, {
        maxItems: spec.maxItems,
        count: value.length,
      });
    }
    const items = spec.items;
    if (items !== undefined) {
      value.forEach((item, index) => {
        if (item !== undefined) checkValue(target, items, item, [...path, index]);
      });
    }
  }
  if (isRecord(value)) checkObject(target, spec, value, path);
}

type Report = (message: string, meta?: Record<string, unknown>) => void;

function checkNumber(spec: HiggsfieldPropSpec, value: number, name: string, endpoint: string, fail: Report, warn: Report): void {
  function bound(limit: number | undefined, ok: (limit: number) => boolean, phrase: string, key: string, report: Report, suffix = ""): void {
    if (limit === undefined || ok(limit)) return;
    report(`\`${name}\` must be ${phrase} ${limit} on ${endpoint}; got ${value}.${suffix}`, { [key]: limit, value });
  }
  const soft = " The route's schema accepts it and another of its published documents does not, so it is sent as written.";
  bound(spec.min, (limit) => value >= limit, "at least", "min", fail);
  bound(spec.max, (limit) => value <= limit, "at most", "max", fail);
  bound(spec.xmin, (limit) => value > limit, "greater than", "exclusiveMinimum", fail);
  bound(spec.xmax, (limit) => value < limit, "less than", "exclusiveMaximum", fail);
  bound(spec.softMin, (limit) => value >= limit, "at least", "min", warn, soft);
  bound(spec.softMax, (limit) => value <= limit, "at most", "max", warn, soft);
  bound(spec.softXmin, (limit) => value > limit, "greater than", "exclusiveMinimum", warn, soft);
  if (spec.step !== undefined) {
    const steps = value / spec.step;
    if (Math.abs(steps - Math.round(steps)) > STEP_TOLERANCE) {
      warn(`\`${name}\` is documented as a multiple of ${spec.step} on ${endpoint}; got ${value}. It is sent as written.`, {
        multipleOf: spec.step,
        value,
      });
    }
  }
}

function checkString(spec: HiggsfieldPropSpec, value: string, name: string, endpoint: string, fail: Report, warn: Report): void {
  // Code points, as JSON Schema's `minLength`/`maxLength` count them: an emoji is one character, not two UTF-16 units.
  const length = [...value].length;
  if (spec.minLen !== undefined && length < spec.minLen) {
    fail(`\`${name}\` must be at least ${spec.minLen} ${spec.minLen === 1 ? "character" : "characters"} on ${endpoint}; got ${length}.`, {
      minLength: spec.minLen,
      length,
    });
  }
  if (spec.maxLen !== undefined && length > spec.maxLen) {
    fail(`\`${name}\` must be at most ${spec.maxLen} characters on ${endpoint}; got ${length}.`, { maxLength: spec.maxLen, length });
  }
  if (spec.softMaxLen !== undefined && length > spec.softMaxLen && (spec.maxLen === undefined || length <= spec.maxLen)) {
    warn(
      `\`${name}\` is ${length} characters, and ${endpoint}'s published documents disagree on the limit: one says ` +
        `${spec.softMaxLen}${spec.maxLen === undefined ? "" : `, another ${spec.maxLen}`}. It is sent as written.`,
      { maxLength: spec.softMaxLen, length },
    );
  }

  if (spec.fmt === "uri") {
    const scheme = uriScheme(value);
    if (scheme === undefined) {
      fail(
        `\`${name}\` must be a URL Higgsfield can fetch on ${endpoint}; got ${JSON.stringify(excerpt(value))}, which is not a URL ` +
          `(it reads like a local path or a bare id). ${HIGGSFIELD_UPLOAD_HINT}`,
        { hint: HIGGSFIELD_UPLOAD_SOURCE },
      );
      return;
    }
    if (scheme !== "https:" && scheme !== "http:") {
      warn(
        `\`${name}\` is a \`${scheme}\` URI on ${endpoint}. Higgsfield documents its inputs as public HTTPS URLs it fetches; the ` +
          `route's schema (\`format: "uri"\`) does not refuse this one, so it is sent as written. ${HIGGSFIELD_UPLOAD_HINT}`,
        { scheme, hint: HIGGSFIELD_UPLOAD_SOURCE },
      );
    }
  }
  if (spec.fmt === "uuid" && !UUID.test(value)) {
    fail(`\`${name}\` must be a UUID on ${endpoint}; got ${JSON.stringify(excerpt(value))}. Send the id from the route's own list, not a name.`, { format: "uuid" });
  }
  if (spec.pat !== undefined && !patternOf(spec.pat).test(value)) {
    fail(`\`${name}\` must match the pattern ${endpoint} publishes for it, \`${spec.pat}\`; got ${JSON.stringify(excerpt(value))}.`, { pattern: spec.pat });
  }
}

const EXCERPT_LENGTH = 60;

function excerpt(value: string): string {
  return value.length > EXCERPT_LENGTH ? `${value.slice(0, EXCERPT_LENGTH)}…` : value;
}

/**
 * The scheme of a `format: "uri"` value, or `undefined` when it is not an
 * absolute URI at all (a bare path or identifier), which the published format
 * refuses.
 *
 * A URI of another scheme than `http(s)` — a `data:` URI most of all — passes
 * `format: "uri"`, and Higgsfield's pages say inputs are "a public HTTPS URL"
 * without a schema that enforces it. So that is reported and sent, never
 * refused.
 */
function uriScheme(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}

function checkObject(target: Target, spec: HiggsfieldPropSpec, value: Record<string, unknown>, path: Path): void {
  const { endpoint, source, ctx } = target;
  const name = label(path);
  const declared = spec.props ?? {};
  for (const [key, own] of Object.entries(declared)) {
    if (own.req === true && value[key] === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: [...path, key],
        model: endpoint,
        message: `\`${label([...path, key])}\` is required by ${endpoint}.`,
        meta: { source },
      });
    }
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  for (const key of keys) {
    const own = Object.hasOwn(declared, key) ? declared[key] : spec.values;
    if (own !== undefined) {
      checkValue(target, own, value[key], [...path, key]);
    } else if (spec.closed === true) {
      ctx.report({
        code: "unsupported_param",
        path: [...path, key],
        model: endpoint,
        message:
          `\`${label([...path, key])}\` is not a key ${endpoint} declares on \`${name}\`, which takes ${list(Object.keys(declared), "and")} ` +
          "and nothing else (`additionalProperties: false`). If this key is newer than unmodel's snapshot, pass " +
          '`{ severity: { unsupported_param: "warning" } }` for this call.',
        meta: { declared: Object.keys(declared), source },
      });
    }
  }
  if (spec.maxProps !== undefined && keys.length > spec.maxProps) {
    ctx.report({
      code: "invalid_shape",
      path,
      model: endpoint,
      message: `\`${name}\` accepts at most ${spec.maxProps} keys on ${endpoint}; got ${keys.length}.`,
      meta: { maxProperties: spec.maxProps, count: keys.length, source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkRules
// ---------------------------------------------------------------------------

function checkRules(target: Target, params: Params): void {
  for (const rule of target.shape.rules ?? []) {
    if (rule.kind === "atLeastOne") checkAtLeastOne(target, rule, params);
    else if (rule.kind === "when") checkWhen(target, rule, params);
    else checkTokens(target, rule, params);
  }
}

function checkAtLeastOne(target: Target, rule: Extract<HiggsfieldRule, { kind: "atLeastOne" }>, params: Params): void {
  const satisfied = rule.params.some(({ name, nonEmpty }) => {
    const value = params[name];
    if (value === undefined || value === null) return false;
    return nonEmpty === true ? Array.isArray(value) && value.length > 0 : true;
  });
  if (satisfied) return;
  const { endpoint, source, ctx } = target;
  ctx.report({
    code: "invalid_shape",
    path: [(rule.params[0] as { name: string }).name],
    model: endpoint,
    message:
      `${endpoint} needs at least one of ` +
      `${rule.params.map(({ name, nonEmpty }) => `\`${name}\`${nonEmpty === true ? " (non-empty)" : ""}`).join(", ")}; the request sends none.`,
    meta: { oneOf: rule.params.map(({ name }) => name), source },
  });
}

function checkWhen(target: Target, rule: Extract<HiggsfieldRule, { kind: "when" }>, params: Params): void {
  let holds = true;
  for (const clause of rule.if) {
    const value = params[clause.name];
    if (value === undefined) {
      if (rule.absent === "either") return checkEither(target, rule, params);
      if (rule.absent === "else") holds = false;
      continue;
    }
    if (!clause.in.includes(value as HiggsfieldScalar)) holds = false;
  }
  const branch = holds ? rule.then : rule.else;
  if (branch === undefined) return;
  const condition = rule.if.map((clause) => `\`${clause.name}\` is ${holds ? "" : "not "}${list(clause.in)}`).join(" and ");
  checkConsequence(target, branch, params, [], `when ${condition}`);
}

/**
 * A request that omits the `if` parameter where the two readings disagree: the
 * strict one holds it to `then`, the one in which the server fills its default
 * first holds it to `else`. It must satisfy one of them, and is refused only
 * when it satisfies neither — then every reading refuses it.
 */
function checkEither(target: Target, rule: Extract<HiggsfieldRule, { kind: "when" }>, params: Params): void {
  if (rule.else === undefined) return;
  const failures: IssueInput[][] = [];
  for (const [branch, holds] of [[rule.then, true], [rule.else, false]] as const) {
    const issues: IssueInput[] = [];
    const condition = rule.if.map((clause) => `\`${clause.name}\` is ${holds ? "" : "not "}${list(clause.in)}`).join(" and ");
    checkConsequence({ ...target, ctx: { ...target.ctx, report: (issue) => issues.push(issue) } }, branch, params, [], `when ${condition}`);
    const errors = issues.filter((issue) => issue.severity !== "warning");
    if (errors.length === 0) return;
    failures.push(errors);
  }
  const [first] = failures.flat() as [IssueInput, ...IssueInput[]];
  target.ctx.report({
    code: "invalid_shape",
    path: first.path ?? [],
    model: target.endpoint,
    message:
      `${target.endpoint} omits ${rule.if.map((clause) => `\`${clause.name}\``).join(" and ")}, and the request satisfies neither branch ` +
      `its schema takes on that: ${failures.map((errors) => errors.map((issue) => issue.message.replace(/\.$/, "")).join("; ")).join("; or ")}.`,
    meta: { source: target.source },
  });
}

function checkConsequence(target: Target, branch: HiggsfieldConsequence, value: Readonly<Record<string, unknown>>, path: Path, condition: string): void {
  const { endpoint, source, ctx } = target;
  for (const name of branch.required ?? []) {
    if (value[name] !== undefined) continue;
    ctx.report({
      code: "invalid_shape",
      path: [...path, name],
      model: endpoint,
      message: `\`${label([...path, name])}\` is required by ${endpoint} ${condition}.`,
      meta: { source },
    });
  }
  for (const [name, fallback] of Object.entries(branch.defaulted ?? {})) {
    if (value[name] !== undefined) continue;
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path: [...path, name],
      model: endpoint,
      message:
        `${endpoint}'s schema requires \`${label([...path, name])}\` ${condition}, and the request omits it. Its published default, ` +
        `${JSON.stringify(fallback)}, satisfies that requirement, so a server that fills defaults first fulfils this request; ` +
        "whether Higgsfield's does was not probed. It is sent as written — state the value to be safe.",
      meta: { default: fallback, source },
    });
  }
  for (const [name, constraint] of Object.entries(branch.props ?? {})) {
    if (value[name] !== undefined) checkConstraint(target, constraint, value[name], [...path, name], condition);
  }
}

function checkConstraint(target: Target, constraint: HiggsfieldConstraint, value: unknown, path: Path, condition: string): void {
  const { endpoint, source, ctx } = target;
  const name = label(path);
  if (constraint.null === true) {
    if (value !== null) {
      ctx.report({
        code: "invalid_shape",
        path,
        model: endpoint,
        message: `\`${name}\` must be \`null\` or left out on ${endpoint} ${condition}; got ${JSON.stringify(value)}.`,
        meta: { value, source },
      });
    }
    return;
  }
  if (value === null) return;
  if (constraint.in !== undefined && !constraint.in.includes(value as HiggsfieldScalar)) {
    ctx.report({
      code: "invalid_enum_value",
      path,
      model: endpoint,
      message: `\`${name}\` must be ${list(constraint.in)} on ${endpoint} ${condition}; got ${JSON.stringify(value)}.`,
      meta: { allowed: [...constraint.in], value, source },
    });
  }
  if (Array.isArray(value)) {
    if (constraint.minItems !== undefined && value.length < constraint.minItems) {
      ctx.report({
        code: "invalid_shape",
        path,
        model: endpoint,
        message: `\`${name}\` needs at least ${constraint.minItems} ${constraint.minItems === 1 ? "entry" : "entries"} on ${endpoint} ${condition}; got ${value.length}.`,
        meta: { minItems: constraint.minItems, count: value.length, source },
      });
    }
    if (constraint.maxItems !== undefined && value.length > constraint.maxItems) {
      ctx.report({
        code: "invalid_shape",
        path,
        model: endpoint,
        message: `\`${name}\` accepts at most ${constraint.maxItems} ${constraint.maxItems === 1 ? "entry" : "entries"} on ${endpoint} ${condition}; got ${value.length}.`,
        meta: { maxItems: constraint.maxItems, count: value.length, source },
      });
    }
  }
  if (constraint.props !== undefined && isRecord(value)) {
    checkConsequence(target, { props: constraint.props }, value, path, condition);
  }
}

function checkTokens(target: Target, rule: Extract<HiggsfieldRule, { kind: "tokens" }>, params: Params): void {
  const prompt = params[rule.prompt];
  if (typeof prompt !== "string") return;
  const { endpoint, source, ctx } = target;
  const kinds = Object.keys(rule.arrays);
  for (const match of prompt.matchAll(/<<<([a-z]+)_(\d+)>>>/g)) {
    const kind = match[1] as string;
    if (!kinds.includes(kind)) continue;
    const array = rule.arrays[kind] as string;
    const attached = params[array];
    const count = Array.isArray(attached) ? attached.length : 0;
    const index = Number(match[2]);
    if (index >= 1 && index <= count) continue;
    ctx.report({
      code: "invalid_shape",
      path: [rule.prompt],
      model: endpoint,
      message:
        `\`${rule.prompt}\` names ${match[0]}, and \`${array}\` has ${count} ${count === 1 ? "item" : "items"} on this request. ` +
        `Tokens are one-based on ${endpoint} and each must refer to an attached item of the same media type.`,
      meta: { token: match[0], array, count, source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkKnownParams
// ---------------------------------------------------------------------------

/** Parameter name → the routes among `shapes` that declare it, built once per table. */
const PARAM_TAKERS = new WeakMap<object, ReadonlyMap<string, readonly string[]>>();

function takersOf(shapes: Readonly<Record<string, HiggsfieldEndpointShape>>): ReadonlyMap<string, readonly string[]> {
  const cached = PARAM_TAKERS.get(shapes);
  if (cached !== undefined) return cached;
  const index = new Map<string, string[]>();
  for (const [id, shape] of Object.entries(shapes)) {
    for (const name of shape.order) {
      const takers = index.get(name);
      if (takers === undefined) index.set(name, [id]);
      else takers.push(id);
    }
  }
  PARAM_TAKERS.set(shapes, index);
  return index;
}

/** How many sibling routes a message names before it only counts them. */
const NAMED_TAKERS = 3;

function checkKnownParams(target: Target, params: Params, spec: HiggsfieldCheckSpec): void {
  const { shape, endpoint, source, ctx } = target;
  const undeclared = Object.keys(params).filter(
    (name) => name !== HIGGSFIELD_ROUTE_PARAM && name !== HF_WEBHOOK_PARAM && params[name] !== undefined && shape.props[name] === undefined,
  );
  if (shape.closed === true) {
    for (const name of undeclared) {
      ctx.report({
        code: "unsupported_param",
        path: [name],
        model: endpoint,
        message:
          `\`${name}\` is not a parameter ${endpoint} declares, and its published schema refuses undeclared keys ` +
          `(\`additionalProperties: false\`). It takes ${list(shape.order, "and")}. If this field is newer than unmodel's ` +
          'snapshot, pass `{ severity: { unsupported_param: "warning" } }` for this call.',
        meta: { declared: [...shape.order], source },
      });
    }
    return;
  }
  // On an open route the pipeline has already warned about a key no route
  // declares; the ones left are keys some other route does.
  const takers = takersOf(spec.shapes);
  for (const name of undeclared) {
    if (!spec.gateKeys.has(name)) continue;
    const others = takers.get(name) ?? [];
    ctx.report({
      code: "unknown_param",
      path: [name],
      model: endpoint,
      message:
        `\`${name}\` is not a parameter ${endpoint} declares — it takes ${list(shape.order, "and")}. ` +
        (others.length === 0
          ? "Other Higgsfield routes do take it, "
          : `${others.length === 1 ? "One other route" : `${others.length} other routes`} at ${ctx.endpoint} ${others.length === 1 ? "does" : "do"} take it` +
            `${others.length <= NAMED_TAKERS ? ` (${others.map((id) => `\`${id}\``).join(", ")})` : ""}, `) +
        "so this reads like a request written for a different one. It is sent as written: this route's schema does not refuse undeclared keys.",
      meta: { declared: [...shape.order], ...(others.length > 0 && { takenBy: [...others] }), source },
    });
  }
}

// ---------------------------------------------------------------------------
// checkWebhook
// ---------------------------------------------------------------------------

/** Loopback, link-local and the three private IPv4 blocks, as dotted quads. */
const PRIVATE_IPV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Loopback, unspecified, unique-local (`fc00::/7`) and link-local (`fe80::/10`), as `URL` prints a literal. */
const PRIVATE_IPV6 = /^\[(::1?|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*)\]$/i;

/**
 * `hf_webhook` — "The webhook URL must use HTTPS and resolve only to public IP
 * addresses, without credentials in the URL. Other URLs are rejected when the
 * request is submitted."
 *
 * What the string alone settles is checked here: the scheme, credentials, and
 * a host that is literally loopback, link-local or private. That a name
 * resolves, and resolves to a public address, is the API's to find out.
 */
function checkWebhook(webhook: string, endpoint: string, ctx: PipelineContext): void {
  const fault = webhookFault(webhook);
  if (fault === undefined) return;
  ctx.report({
    code: "invalid_shape",
    path: [HF_WEBHOOK_PARAM],
    model: endpoint,
    message:
      `\`${HF_WEBHOOK_PARAM}\` ${fault}. Higgsfield rejects the submit: "The webhook URL must use HTTPS and resolve only to ` +
      'public IP addresses, without credentials in the URL."',
    meta: { value: webhook, source: HIGGSFIELD_WEBHOOK_SOURCE },
  });
}

function webhookFault(webhook: string): string | undefined {
  let url: URL;
  try {
    url = new URL(webhook);
  } catch {
    return "is not a URL";
  }
  if (url.protocol !== "https:") return "must be an `https:` URL";
  if (url.username !== "" || url.password !== "") return "must not carry credentials";
  const host = url.hostname;
  if (host === "localhost" || (IPV4.test(host) && PRIVATE_IPV4.test(host)) || PRIVATE_IPV6.test(host)) {
    return "must be a public address";
  }
  return undefined;
}
