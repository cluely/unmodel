export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "invalid_shape"
  | "unknown_param"
  | "unknown_model"
  | "deprecated_model"
  | "unsupported_param"
  | "unsupported_capability"
  | "invalid_enum_value"
  | "over_context"
  | "near_context"
  | "over_output_limit"
  | "over_budget"
  | "media_too_large"
  | "media_unsupported_format"
  | "media_dimensions_exceeded"
  | "media_duration_exceeded"
  | "media_duration_undeclared";

export interface Issue {
  severity: IssueSeverity;
  code: IssueCode;
  /** Location of the offending value inside the params object, e.g. ["messages", 3, "content", 0]. */
  path: Array<string | number>;
  /** Human-grade message; always names the model, param, and limit involved. */
  message: string;
  /** Model id the issue relates to, when model-dependent. */
  model?: string;
  /** Machine-readable details, e.g. { limit: 128000, estimated: 131072 }. */
  meta?: Record<string, unknown>;
}

export function formatIssuePath(path: Array<string | number>): string {
  if (path.length === 0) return "(root)";
  return path
    .map((segment, i) =>
      typeof segment === "number" ? `[${segment}]` : i === 0 ? segment : `.${segment}`,
    )
    .join("");
}

export function formatIssues(issues: Issue[]): string {
  return issues
    .map((issue) => `  - [${issue.code}] ${formatIssuePath(issue.path)}: ${issue.message}`)
    .join("\n");
}

export class UnmodelValidationError extends Error {
  override readonly name: string = "UnmodelValidationError";
  readonly issues: Issue[];
  readonly warnings: Issue[];

  constructor(endpoint: string, errors: Issue[], warnings: Issue[] = []) {
    super(`Invalid params for ${endpoint}:\n${formatIssues(errors)}`);
    this.issues = errors;
    this.warnings = warnings;
  }

  /** Cross-realm/cross-copy safe alternative to instanceof. */
  static isInstance(error: unknown): error is UnmodelValidationError {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "UnmodelValidationError" &&
      Array.isArray((error as { issues?: unknown }).issues)
    );
  }
}
