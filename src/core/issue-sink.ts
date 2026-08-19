/**
 * Issue severity, and the collector that resolves it — as a leaf.
 *
 * Three pipelines report into this: `createValidator`'s four layers, the
 * `unmodel/chat` compiler, and the `unmodel/<media>` unified kernel. Only the
 * first of those wants the four-layer engine; the other two run their own
 * layers over a *compiled* body and need nothing from `pipeline.ts` except the
 * severity rules and the two-array partition at the end.
 *
 * So the rules live here, importing only `./issues` (types) and `./options`
 * (types). It is a leaf in the same sense and for the same reason as
 * `core/translate/errors.ts`: `pipeline.ts` pulls in zod, the tokenizer, the
 * catalog and constraint types, ~9 KiB of engine that a compile-then-delegate
 * pipeline never executes — and paying for it in six media entry points whose
 * whole design premise is that they are small would be silly.
 *
 * `pipeline.ts` re-exports everything below, so no call site had to move.
 */
import type { Issue, IssueCode, IssueSeverity } from "./issues";
import type { ValidateOptions } from "./options";

/**
 * Every issue code's severity when nothing overrides it.
 *
 * One table, shared, because a second table that disagreed about — say —
 * whether `unknown_model` fails a request would be a difference nobody would
 * notice until it bit them.
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

/**
 * The severity-resolving collector every layer reports into: defaults, then
 * the rule's own override (deny rules flagged `ignored`), then the user's
 * `options.severity` — which wins, including `"off"`, which drops the issue.
 *
 * `issues` is the live array; pair it with {@link partition} at the end.
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

/** Splits a collected issue list into the two arrays `ValidateResult` carries. */
export function partition(issues: Issue[]): { errors: Issue[]; warnings: Issue[] } {
  return {
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}
