import type { Issue } from "./issues";

export interface ValidateEstimate {
  /** ~estimated prompt tokens (heuristic unless a real tokenizer was supplied). */
  inputTokens?: number;
  /** Estimated worst-case cost in USD, priced from catalog rates. */
  costUSD?: number;
}

export type ValidateResult<P> =
  | { ok: true; params: P; warnings: Issue[]; estimate: ValidateEstimate }
  | { ok: false; errors: Issue[]; warnings: Issue[] };
