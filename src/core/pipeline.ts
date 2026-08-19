import { z } from "zod";
import type { Issue, IssueCode, IssueSeverity } from "./issues";
import { UnmodelValidationError } from "./issues";
import type { ValidateEstimate, ValidateResult } from "./result";
import type { ValidateOptions } from "./options";
import type { ModelInfo } from "./catalog-types";
import type { EndpointConstraints, FamilyRule } from "./constraint-types";
import { heuristicTokenizer, type Tokenizer } from "./tokens";

/**
 * Every issue code's severity when nothing overrides it.
 *
 * Exported (additively) so alternative pipelines — `unmodel/chat` runs its own
 * four layers over a compiled body rather than the caller's params — inherit
 * these semantics instead of re-deciding them. A second table that disagreed
 * about, say, whether `unknown_model` fails a request would be a difference
 * nobody would notice until it bit them.
 */
export const DEFAULT_SEVERITY: Record<IssueCode, IssueSeverity> = {
  invalid_shape: "error",
  unknown_param: "warning",
  unknown_model: "warning",
  deprecated_model: "warning",
  unsupported_param: "error",
  unsupported_capability: "error",
  invalid_enum_value: "error",
  over_context: "error",
  near_context: "warning",
  over_output_limit: "error",
  over_budget: "error",
  media_too_large: "error",
  media_unsupported_format: "error",
  media_dimensions_exceeded: "error",
  media_duration_exceeded: "error",
  media_duration_undeclared: "warning",
};

export interface IssueInput {
  code: IssueCode;
  message: string;
  path?: Array<string | number>;
  model?: string;
  meta?: Record<string, unknown>;
  /**
   * Overrides `DEFAULT_SEVERITY` for this one issue (used for deny rules
   * flagged `ignored`). A user-supplied `options.severity` still wins.
   */
  severity?: IssueSeverity;
}

export interface PipelineContext {
  readonly endpoint: string;
  readonly options: ValidateOptions;
  readonly tokenizer: Tokenizer;
  /** Records an issue; severity comes from defaults + the user's overrides. */
  report(issue: IssueInput): void;
}

/**
 * The severity-resolving collector every layer reports into: defaults, then
 * the rule's own override (deny rules flagged `ignored`), then the user's
 * `options.severity` — which wins, including `"off"`, which drops the issue.
 *
 * Extracted from `createValidator` so `unmodel/chat`'s pipeline shares the
 * exact resolution order rather than reimplementing it. `issues` is the live
 * array; pair it with {@link partition} at the end.
 */
export interface IssueSink {
  readonly issues: Issue[];
  report(input: IssueInput): void;
}

export function createIssueSink(options: ValidateOptions): IssueSink {
  const issues: Issue[] = [];
  return {
    issues,
    report(input) {
      const override = options.severity?.[input.code];
      if (override === "off") return;
      issues.push({
        severity: override ?? input.severity ?? DEFAULT_SEVERITY[input.code],
        code: input.code,
        path: input.path ?? [],
        message: input.message,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.meta !== undefined && { meta: input.meta }),
      });
    },
  };
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
   * Shapes the validated output: by default the fetch-ready wire body (a
   * `Validated` built via `toValidated`, with non-enumerable `toSdk(target)` and
   * `.request`). Omitted → the original params object is returned as-is.
   */
  finalize?: (params: P) => V;
}

/** Fraction of the context window above which a near_context warning fires. */
const NEAR_CONTEXT_RATIO = 0.9;

export interface Validator<P, V = P> {
  (params: P, options?: ValidateOptions): V;
  safe(params: P, options?: ValidateOptions): ValidateResult<V>;
  /** All constraints that apply to a model id (model-specific + matching family rules). */
  constraintsFor(modelId: string): EndpointConstraints[];
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
    if (estimate.inputTokens !== undefined && info !== undefined && info.limit.context > 0) {
      const context = info.limit.context;
      if (estimate.inputTokens > context) {
        ctx.report({
          code: "over_context",
          model: modelId,
          message: `~${estimate.inputTokens} estimated prompt tokens exceed the ${context}-token context window of "${modelId}".`,
          meta: { estimated: estimate.inputTokens, limit: context },
        });
      } else if (estimate.inputTokens > context * NEAR_CONTEXT_RATIO) {
        ctx.report({
          code: "near_context",
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
  return validator;
}

/** Splits a collected issue list into the two arrays `ValidateResult` carries. */
export function partition(issues: Issue[]): { errors: Issue[]; warnings: Issue[] } {
  return {
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
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
