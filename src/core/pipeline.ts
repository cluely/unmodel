import { z } from "zod";
import type { Issue } from "./issues";
import { formatIssuePath, UnmodelValidationError } from "./issues";
import type { ValidateEstimate, ValidateResult } from "./result";
import type { ValidateOptions } from "./options";
import type { ModelInfo } from "./catalog-types";
import type { EndpointConstraints, FamilyRule } from "./constraint-types";
import { heuristicTokenizer, type Tokenizer } from "./tokens";
import { createIssueSink, partition } from "./issue-sink";

/**
 * The severity table and the collector now live in `./issue-sink.ts`, a leaf
 * that imports no zod and no catalog.
 *
 * They moved because two pipelines want them without wanting *this* module:
 * `unmodel/chat` and the `unmodel/<media>` unified kernel both run their own
 * layers over a compiled body and delegate the rest, so making them import
 * `createIssueSink` from here charged every one of those entries ~9 KiB of
 * four-layer engine they never call. Re-exported so the import site never had
 * to change.
 */
export { DEFAULT_SEVERITY, createIssueSink, partition } from "./issue-sink";
export type { IssueInput, IssueSink } from "./issue-sink";
import type { IssueInput } from "./issue-sink";

export interface PipelineContext {
  readonly endpoint: string;
  readonly options: ValidateOptions;
  readonly tokenizer: Tokenizer;
  /** Records an issue; severity comes from defaults + the user's overrides. */
  report(issue: IssueInput): void;
}

export interface PipelineSpec<P, V = P> {
  /** Qualified endpoint name used in error messages, e.g. "openai.chat". */
  endpoint: string;
  /** Loose zod schema for wire shape; unknown keys must pass through. */
  schema: z.ZodType;
  modelId: (params: P) => string | undefined;
  /** Generated catalog for this provider (models.gen.ts `models`). */
  catalog: Record<string, ModelInfo>;
  /** Hand-written per-model constraint table for this endpoint. */
  constraints?: Readonly<Partial<Record<string, EndpointConstraints>>>;
  /** Pattern rules for chat-scale endpoints (reasoning families etc.). */
  familyRules?: readonly FamilyRule[];
  /** Endpoint-specific checks: capabilities, media, output limits, pairing rules. */
  checks?: ReadonlyArray<(params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void>;
  /** Token/cost estimation; drives context-window and budget enforcement. */
  estimate?: (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => ValidateEstimate;
  /**
   * Where a context-window finding is addressed — the param the input-token
   * estimate was drawn from (`["messages"]` on a chat body, `["contents"]` on
   * Gemini's). An issue that reports no path renders as `(root)`, which tells
   * a caller nothing about what to shorten; endpoints that know their own
   * prompt-bearing param say so here rather than each re-reporting the
   * finding. Omitted → the finding keeps the empty path it always had.
   */
  promptPath?: readonly (string | number)[];
  /**
   * Media coordinates this endpoint accepts that are **not fields of the
   * params object** — the multipart file part on an upload route
   * (`speechmatics.stt`'s `data_file`, `revai.stt`'s `media`).
   *
   * `reportUnresolvedMedia` treats a declaration that names nothing as a
   * silently-inert declaration, which is right everywhere the body and the
   * declaration share one coordinate system. On these two routes they do not:
   * the audio arrives as a form part alongside the JSON config, and the
   * endpoint's own lookup table already names the coordinate. Listing it here
   * is what keeps the check from inventing a warning for a declaration the
   * endpoint does read — and the same fact is why those two validators keep
   * the un-parameterized `ValidateOptions` on their public signature.
   */
  mediaPaths?: ReadonlyArray<readonly (string | number)[]>;
  /**
   * Shapes the validated output: by default the fetch-ready wire body (a
   * `Validated` built via `toValidated`, with non-enumerable `toSdk(target)` and
   * `.request`). Omitted → the original params object is returned as-is.
   */
  finalize?: (params: P) => V;
}

/** Fraction of the context window above which a near_context warning fires. */
const NEAR_CONTEXT_RATIO = 0.9;

/** Walks one media path into the params; `undefined` when it names nothing. */
function resolvePath(root: unknown, path: readonly (string | number)[]): unknown {
  let cursor = root;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    if (Array.isArray(cursor)) {
      if (typeof segment !== "number") return undefined;
      cursor = cursor[segment];
      continue;
    }
    if (!Object.hasOwn(cursor, String(segment))) return undefined;
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }
  return cursor;
}

/**
 * Reports a `ValidateOptions.media` declaration that addresses nothing.
 *
 * This is the silent half of the media contract. `findMediaDeclaration` matches
 * a declaration to a part by deep-equal path, so a path with one segment wrong
 * — `["mesages", 0, …]`, a stale index after the array was edited, a canonical
 * spelling on a wire surface — simply never matches: the declared duration and
 * byte size are never applied, no check runs, and the caller is told the
 * request is fine. A 999 MB attachment declared at a typo'd path used to
 * return `{ ok: true, warnings: [] }`.
 *
 * A warning, not an error, and appealable per code like every other: a caller
 * may legitimately carry one options object across several calls, so a
 * declaration that is inert *here* is not necessarily a mistake. What it must
 * not be is invisible.
 *
 * `media_declaration_dropped` is the same code `unmodel/chat` reports when a
 * declaration does not survive compilation — the caller-facing fact is
 * identical (declared facts were not applied to anything), and the message
 * says which of the two happened.
 */
function reportUnresolvedMedia(
  params: unknown,
  extra: ReadonlyArray<readonly (string | number)[]>,
  ctx: PipelineContext,
): void {
  const declared = (candidate: readonly (string | number)[]): boolean =>
    extra.some((p) => p.length === candidate.length && p.every((s, i) => s === candidate[i]));
  for (const declaration of ctx.options.media ?? []) {
    const path = declaration.path as readonly (string | number)[];
    if (resolvePath(params, path) !== undefined || declared(path)) continue;
    ctx.report({
      code: "media_declaration_dropped",
      path: [...path],
      message:
        `the media declared at \`${formatIssuePath([...path])}\` does not exist in these params, so ` +
        "its declared facts were not applied and no media check ran for it. Media paths address " +
        `the ${ctx.endpoint} wire body — check the spelling and the indexes.`,
      meta: { declaredPath: [...path] },
    });
  }
}

export interface Validator<P, V = P> {
  (params: P, options?: ValidateOptions<P>): V;
  safe(params: P, options?: ValidateOptions<P>): ValidateResult<V>;
  /** All constraints that apply to a model id (model-specific + matching family rules). */
  constraintsFor(modelId: string): EndpointConstraints[];
  /**
   * The qualified endpoint this validator speaks for, e.g. `"groq.chat"` —
   * the same string that labels its thrown errors.
   *
   * Exposed because a registry keyed by provider id otherwise has no way to
   * check that a value agrees with the key it was filed under: every chat
   * validator has the same structural type, and two providers routinely serve
   * the same model ids, so a transposed entry produces a request addressed to
   * the wrong host with no error anywhere. `createChat` reads it.
   */
  readonly endpoint: string;
}

export function constraintsFor(
  spec: Pick<PipelineSpec<unknown>, "constraints" | "familyRules">,
  modelId: string,
): EndpointConstraints[] {
  const applicable: EndpointConstraints[] = [];
  const own = spec.constraints?.[modelId];
  if (own) applicable.push(own);
  for (const rule of spec.familyRules ?? []) {
    if (rule.match(modelId)) applicable.push(rule);
  }
  return applicable;
}

export function createValidator<P, V = P>(spec: PipelineSpec<P, V>): Validator<P, V> {
  function safe(params: P, options: ValidateOptions = {}): ValidateResult<V> {
    const sink = createIssueSink(options);
    const issues = sink.issues;
    const ctx: PipelineContext = {
      endpoint: spec.endpoint,
      options,
      tokenizer: options.tokenizer ?? heuristicTokenizer,
      report: (input) => sink.report(input),
    };

    // Layer 1: shape.
    const parsed = spec.schema.safeParse(params);
    if (!parsed.success) {
      for (const zodIssue of parsed.error.issues) {
        ctx.report({
          code: "invalid_shape",
          path: zodIssue.path.filter(
            (seg): seg is string | number => typeof seg === "string" || typeof seg === "number",
          ),
          message: zodIssue.message,
        });
      }
      return { ok: false, ...partition(issues) };
    }
    reportUnknownTopLevelKeys(spec.schema, params, ctx);
    reportUnresolvedMedia(params, spec.mediaPaths ?? [], ctx);

    // Layer 2: catalog.
    const modelId = spec.modelId(params);
    // Object.hasOwn: model ids like "constructor" must not resolve to
    // inherited Object.prototype members.
    const info =
      modelId !== undefined && Object.hasOwn(spec.catalog, modelId)
        ? spec.catalog[modelId]
        : undefined;
    if (modelId !== undefined && info === undefined) {
      ctx.report({
        code: "unknown_model",
        path: ["model"],
        model: modelId,
        message: `Model "${modelId}" is not in the ${providerOf(spec.endpoint)} catalog; model-dependent checks were skipped. If this model is new, catalog data may lag behind.`,
      });
    }
    if (info?.status === "deprecated") {
      ctx.report({
        code: "deprecated_model",
        path: ["model"],
        model: modelId,
        message: `Model "${modelId}" is marked deprecated by ${providerOf(spec.endpoint)}.`,
      });
    }

    // Layer 3: constraints (generic top-level deny/enum rules). Explicit
    // `null` means "use the provider default" on these APIs (params are
    // typed `| null`), so null is treated as unset here.
    if (modelId !== undefined) {
      const record = params as Record<string, unknown>;
      for (const constraints of constraintsFor(spec, modelId)) {
        for (const [param, rule] of Object.entries(constraints.deny ?? {})) {
          if (record[param] != null) {
            // `ignored` rules describe params the API accepts and drops on the
            // floor: worth surfacing, but they must not fail a request the API
            // fulfils, so they downgrade to a warning.
            const ignored = rule.ignored === true;
            ctx.report({
              code: "unsupported_param",
              ...(ignored && { severity: "warning" as const }),
              path: [param],
              model: modelId,
              message: ignored
                ? `\`${param}\` is silently ignored by the API for "${modelId}": ${rule.reason}`
                : `\`${param}\` is not supported by "${modelId}": ${rule.reason}`,
              meta: { source: rule.source, ...(ignored && { ignored: true }) },
            });
          }
        }
        for (const [param, allowed] of Object.entries(constraints.enums ?? {})) {
          const value = record[param];
          if (value != null && !allowed.includes(value as string | number)) {
            ctx.report({
              code: "invalid_enum_value",
              path: [param],
              model: modelId,
              message: `\`${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${modelId}"; got ${JSON.stringify(value)}.`,
              meta: { allowed: [...allowed], value },
            });
          }
        }
      }
    }

    // Endpoint-specific checks (capabilities, media, pairing, output limits).
    // safe() must never throw on malformed input, so a check that crashes is
    // reported as an issue and the remaining checks still run.
    for (const check of spec.checks ?? []) {
      try {
        check(params, info, ctx);
      } catch (err) {
        ctx.report({ code: "invalid_shape", message: inspectionFailureMessage(err) });
      }
    }

    // Estimation → context window + budget (layer 4).
    let estimate: ValidateEstimate = {};
    try {
      estimate = spec.estimate?.(params, info, ctx) ?? {};
    } catch (err) {
      ctx.report({ code: "invalid_shape", message: inspectionFailureMessage(err) });
    }
    const promptPath = spec.promptPath === undefined ? {} : { path: [...spec.promptPath] };
    if (estimate.inputTokens !== undefined && info !== undefined && info.limit.context > 0) {
      const context = info.limit.context;
      if (estimate.inputTokens > context) {
        ctx.report({
          code: "over_context",
          ...promptPath,
          model: modelId,
          message: `~${estimate.inputTokens} estimated prompt tokens exceed the ${context}-token context window of "${modelId}".`,
          meta: { estimated: estimate.inputTokens, limit: context },
        });
      } else if (estimate.inputTokens > context * NEAR_CONTEXT_RATIO) {
        ctx.report({
          code: "near_context",
          ...promptPath,
          model: modelId,
          message: `~${estimate.inputTokens} estimated prompt tokens are within 10% of the ${context}-token context window of "${modelId}"; the estimate is heuristic, so the request may not fit.`,
          meta: { estimated: estimate.inputTokens, limit: context },
        });
      }
    }
    if (
      options.maxCostUSD !== undefined &&
      estimate.costUSD !== undefined &&
      estimate.costUSD > options.maxCostUSD
    ) {
      ctx.report({
        code: "over_budget",
        // The price is a property of the model the caller chose, and the model
        // is the one param a budget failure can actually be fixed at.
        path: ["model"],
        model: modelId,
        message: `Estimated worst-case cost $${estimate.costUSD.toFixed(4)} exceeds maxCostUSD $${options.maxCostUSD}.`,
        meta: { estimated: estimate.costUSD, limit: options.maxCostUSD },
      });
    }

    const { errors, warnings } = partition(issues);
    if (errors.length > 0) return { ok: false, errors, warnings };
    const output = spec.finalize ? spec.finalize(params) : (params as unknown as V);
    return { ok: true, params: output, warnings, estimate };
  }

  function validator(params: P, options: ValidateOptions = {}): V {
    const result = safe(params, options);
    if (!result.ok) throw new UnmodelValidationError(spec.endpoint, result.errors, result.warnings);
    return result.params;
  }

  validator.safe = safe;
  validator.constraintsFor = (modelId: string) => constraintsFor(spec, modelId);
  Object.defineProperty(validator, "endpoint", {
    value: spec.endpoint,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return validator as Validator<P, V>;
}

function providerOf(endpoint: string): string {
  return endpoint.split(".")[0] ?? endpoint;
}

function inspectionFailureMessage(err: unknown): string {
  return `unmodel could not safely inspect these params (${String(err)}) — this is likely a malformed request; if the request is valid, please file a bug`;
}

/**
 * Warns about top-level keys the schema's shape does not declare.
 *
 * Every wire schema is deliberately loose (unknown keys pass through, because
 * providers ship params faster than unmodel tracks them), so this is what keeps
 * "loose" from meaning "silent": a typo'd key is still delivered to the API,
 * and the caller is told which one it was.
 *
 * The context parameter is structural rather than a full `PipelineContext` so
 * `unmodel/chat` — which reports into its own sink — can reuse the behaviour
 * verbatim instead of forking the message.
 */
export function reportUnknownTopLevelKeys(
  schema: z.ZodType,
  params: unknown,
  ctx: { readonly endpoint: string; report(issue: IssueInput): void },
): void {
  if (!(schema instanceof z.ZodObject)) return;
  if (typeof params !== "object" || params === null) return;
  const known = new Set(Object.keys(schema.shape));
  for (const key of Object.keys(params)) {
    if (!known.has(key)) {
      ctx.report({
        code: "unknown_param",
        path: [key],
        message: `\`${key}\` is not a param unmodel knows for ${ctx.endpoint}; it was passed through unvalidated. It may be new — or a typo.`,
      });
    }
  }
}
